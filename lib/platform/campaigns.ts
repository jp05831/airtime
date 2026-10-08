import { db, transaction, type Queryable } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { refreshPrice } from "@/lib/server/price";
import {
  campaignInput,
  canTransition,
  type CreatorIdentity,
  type CampaignInput,
  type CreatorState,
  type CreatorCampaign,
  type CampaignStatus,
} from "./model";
import { platformConfig, platformAvailable } from "./config";
import { addCoin, coinView } from "./coins";
import { fixedInvoiceAmounts } from "@/lib/vibe/money";
import { assertCreativeApproved } from "@/lib/vibe/review";
export async function logOperation(
  actor: string,
  action: string,
  entity: string,
  details: unknown,
  c: Queryable = db(),
) {
  await c.query(
    "INSERT INTO operations_audit(actor,action,entity_id,details) VALUES($1,$2,$3,$4)",
    [actor, action, entity, JSON.stringify(details)],
  );
}
export async function ownedCampaign(
  identity: CreatorIdentity,
  id: string,
  c: Queryable = db(),
  lock = false,
) {
  const { rows } = await c.query(
    `SELECT * FROM ad_campaigns WHERE id=$1 AND user_id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [id, identity.userId],
  );
  if (!rows[0]) throw new HttpError(404, "Campaign not found");
  return rows[0];
}
export async function transition(
  c: Queryable,
  id: string,
  from: CampaignStatus,
  to: CampaignStatus,
  actor: string,
  note: string,
) {
  if (!canTransition(from, to))
    throw new HttpError(409, "This status change is not available");
  if (["PAID", "ACTIVATING"].includes(to)) {
    const receipt = await c.query(
      "SELECT p.signature FROM campaign_payments p JOIN campaign_invoices i ON i.id=p.invoice_id WHERE i.campaign_id=$1 AND i.status='PAID' AND i.refund_status='NONE' AND p.status='FINALIZED'",
      [id],
    );
    if (!receipt.rowCount)
      throw new HttpError(409, "Finalized payment required for this status");
  }
  const updated = await c.query(
    "UPDATE ad_campaigns SET status=$2,updated_at=now() WHERE id=$1 AND status=$3",
    [id, to, from],
  );
  if (!updated.rowCount)
    throw new HttpError(
      409,
      "Campaign status changed; refresh before retrying",
    );
  await c.query(
    "INSERT INTO campaign_status_history(campaign_id,from_status,to_status,actor,note) VALUES($1,$2,$3,$4,$5)",
    [id, from, to, actor, note],
  );
  await logOperation(actor, "CAMPAIGN_STATUS", id, { from, to, note }, c);
}
export async function saveCampaign(
  identity: CreatorIdentity,
  payload: unknown,
) {
  await platformAvailable();
  const v = campaignInput.parse(payload),
    config = platformConfig();
  if (BigInt(v.mediaBudgetCents) !== config.mediaCents || v.durationDays !== 7)
    throw new HttpError(
      400,
      "Version one is a fixed $50 media campaign with a seven-day window",
    );
  const today = new Date().toISOString().slice(0, 10);
  if (v.proposedStart < today)
    throw new HttpError(400, "Choose a future proposed start date");
  await addCoin(identity, v.mint);
  return transaction(async (c) => {
    let prior: any = null;
    if (v.id) {
      prior = await ownedCampaign(identity, v.id, c, true);
      if (
        prior.product_version !== 2 ||
        !["DRAFT", "CHANGES_REQUESTED", "CREATIVE_REJECTED"].includes(
          prior.status,
        )
      )
        throw new HttpError(
          409,
          "This campaign is locked for payment or review",
        );
      if (prior.mint !== v.mint)
        throw new HttpError(409, "A submitted coin cannot be replaced");
      if (
        prior.status === "CHANGES_REQUESTED" &&
        (prior.media_budget_cents !== v.mediaBudgetCents ||
          prior.duration_days !== v.durationDays)
      )
        throw new HttpError(
          409,
          "Paid budget/duration are fixed. Contact AIRTIME for a revised order.",
        );
    }
    const upload = (
      await c.query(
        "SELECT * FROM campaign_creatives WHERE id=$1 AND user_id=$2 AND validation_status='TECHNICALLY_VALID' FOR UPDATE",
        [v.creativeId, identity.userId],
      )
    ).rows[0];
    if (!upload || (upload.campaign_id && upload.campaign_id !== v.id))
      throw new HttpError(
        403,
        "Upload a valid commercial belonging to this account",
      );
    const { rows } = v.id
      ? await c.query(
          "UPDATE ad_campaigns SET title=$3,brief=$4,media_budget_cents=$5,duration_days=$6,proposed_start=$7,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id",
          [
            v.id,
            identity.userId,
            v.title,
            JSON.stringify(v),
            v.mediaBudgetCents,
            v.durationDays,
            v.proposedStart,
          ],
        )
      : await c.query(
          "INSERT INTO ad_campaigns(user_id,mint,title,brief,media_budget_cents,duration_days,proposed_start) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [
            identity.userId,
            v.mint,
            v.title,
            JSON.stringify(v),
            v.mediaBudgetCents,
            v.durationDays,
            v.proposedStart,
          ],
        );
    const id = rows[0].id;
    await c.query("UPDATE campaign_creatives SET campaign_id=$2 WHERE id=$1", [
      v.creativeId,
      id,
    ]);
    await c.query(
      "INSERT INTO campaign_targeting(campaign_id,selection) VALUES($1,$2) ON CONFLICT(campaign_id) DO UPDATE SET selection=EXCLUDED.selection,updated_at=now()",
      [id, JSON.stringify(v.targeting)],
    );
    await logOperation(
      identity.wallet,
      "CREATOR_SAVE",
      id,
      { mint: v.mint },
      c,
    );
    if (prior && prior.status !== "DRAFT")
      await transition(
        c,
        id,
        prior.status,
        "DRAFT",
        identity.wallet,
        "Replacement creative saved; new approval required",
      );
    if (!prior)
      await c.query(
        "INSERT INTO campaign_status_history(campaign_id,to_status,actor,note) VALUES($1,'DRAFT',$2,'Creator draft')",
        [id, identity.wallet],
      );
    return { id };
  });
}
export async function quoteCampaign(identity: CreatorIdentity, id: string) {
  await platformAvailable();
  const config = platformConfig();
  if (!config.paymentWallet)
    throw new HttpError(503, "Campaign payments are not configured yet");
  if (config.paymentWallet === identity.wallet)
    throw new HttpError(403, "Payment wallet cannot submit creator orders");
  const initial = await ownedCampaign(identity, id);
  if (initial.product_version !== 2)
    throw new HttpError(409, "Historical orders cannot use the fixed product");
  await addCoin(identity, initial.mint);
  const approval = await assertCreativeApproved(id, identity.userId);
  const price = await refreshPrice();
  if (!price)
    throw new HttpError(
      503,
      "SOL/USD pricing is unavailable. No invoice has been issued.",
    );
  return transaction(async (c) => {
    const campaign = await ownedCampaign(identity, id, c, true);
    const { rows } = await c.query(
      "SELECT * FROM campaign_invoices WHERE campaign_id=$1 AND status IN ('OPEN','VERIFYING','PAID') FOR UPDATE",
      [id],
    );
    if (rows[0]) {
      if (
        new Date(rows[0].expires_at).getTime() > Date.now() ||
        rows[0].status !== "OPEN"
      )
        return { invoice: rows[0] };
      if (rows[0].prepared_message)
        throw new HttpError(
          409,
          "Expired prepared payment needs reconciliation before a new quote. Contact support.",
        );
      await c.query(
        "UPDATE campaign_invoices SET status='EXPIRED' WHERE id=$1",
        [rows[0].id],
      );
    }
    if (
      !["APPROVED_AWAITING_PAYMENT", "QUOTE_ACTIVE"].includes(campaign.status)
    )
      throw new HttpError(409, "This campaign cannot be quoted");
    const v = campaignInput.parse(campaign.brief);
    if (
      BigInt(v.mediaBudgetCents) !== config.mediaCents ||
      v.durationDays !== 7
    )
      throw new HttpError(400, "Budget below minimum");
    if (BigInt(v.mediaBudgetCents) !== 5000n)
      throw new HttpError(409, "Fixed media budget mismatch");
    const amounts = fixedInvoiceAmounts(BigInt(price.price_usd_micros));
    const result = await c.query(
      `INSERT INTO campaign_invoices(campaign_id,user_id,creator_wallet,mint,recipient_wallet,media_budget_cents,platform_fee_bps,platform_fee_cents,total_usd_cents,price_usd_micros,price_source,price_fetched_at,required_lamports,expires_at,approval_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()+interval '5 minutes',$14) RETURNING *`,
      [
        id,
        identity.userId,
        identity.wallet,
        campaign.mint,
        config.paymentWallet,
        amounts.media.toString(),
        config.feeBps,
        amounts.fee.toString(),
        amounts.total.toString(),
        String(price.price_usd_micros),
        price.source,
        price.fetched_at,
        amounts.lamports.toString(),
        JSON.stringify({
          creative_id: approval.creative.id,
          vibe_creative_id: approval.live.id,
          status: approval.live.approval_status,
          verified_at: new Date().toISOString(),
        }),
      ],
    );
    if (campaign.status === "APPROVED_AWAITING_PAYMENT")
      await transition(
        c,
        id,
        "APPROVED_AWAITING_PAYMENT",
        "QUOTE_ACTIVE",
        identity.wallet,
        "Fixed campaign quote issued",
      );
    await logOperation(
      identity.wallet,
      "INVOICE_ISSUED",
      result.rows[0].id,
      { requiredLamports: amounts.lamports.toString() },
      c,
    );
    return { invoice: result.rows[0] };
  });
}
export async function creatorState(
  identity: CreatorIdentity,
  withFees = false,
): Promise<CreatorState> {
  const config = platformConfig();
  const { rows: coinRows } = await db().query(
    "SELECT p.*,a.role FROM coin_authorities a JOIN platform_coins p ON p.mint=a.mint WHERE a.user_id=$1 ORDER BY a.verified_at DESC",
    [identity.userId],
  );
  const coins = [];
  for (const row of coinRows) {
    coins.push(
      withFees
        ? await coinView(row, identity.wallet)
        : {
            ...row,
            authorityCurrent: null,
            claimableLamports: null,
            curveLamports: null,
            ammLamports: null,
            claimedLamports: null,
            feeNotice: "Refresh fee balances to reverify current authority.",
            sharing: false,
            claimable: false,
          },
    );
  }
  const { rows: rawCampaigns } = await db().query(
    "SELECT c.*,coalesce(m.impressions,0)::text impressions,coalesce(m.reach,0)::text reach,m.cpm_cents FROM ad_campaigns c LEFT JOIN campaign_metrics m ON m.campaign_id=c.id WHERE c.user_id=$1 ORDER BY c.created_at DESC",
    [identity.userId],
  );
  const { rows: invoices } = await db().query(
    "SELECT i.*,p.signature,r.signature refund_signature FROM campaign_invoices i LEFT JOIN campaign_payments p ON p.invoice_id=i.id LEFT JOIN campaign_refunds r ON r.invoice_id=i.id WHERE i.user_id=$1 ORDER BY i.created_at DESC",
    [identity.userId],
  );
  const { rows: messages } = await db().query(
    "SELECT m.* FROM creator_messages m JOIN ad_campaigns c ON c.id=m.campaign_id WHERE c.user_id=$1 ORDER BY m.created_at",
    [identity.userId],
  );
  const { rows: vibeRows } = await db().query(
    `SELECT vc.campaign_id,vc.delivery_status,vc.last_synced_at,vc.last_error,cr.approval_status review_status,cr.approval_details review_reason,to_jsonb(m) metrics FROM vibe_campaigns vc JOIN ad_campaigns a ON a.id=vc.campaign_id LEFT JOIN vibe_creatives cr ON cr.campaign_id=vc.campaign_id AND cr.creative_id=(a.brief->>'creativeId')::uuid LEFT JOIN vibe_campaign_metrics m ON m.campaign_id=vc.campaign_id WHERE vc.user_id=$1`,
    [identity.userId],
  );
  const { rows: channels } = await db().query(
    "SELECT r.* FROM vibe_channel_reports r JOIN ad_campaigns a ON a.id=r.campaign_id WHERE a.user_id=$1",
    [identity.userId],
  );
  const campaigns = rawCampaigns.map((c) => ({
    vibe: vibeRows.find((v) => v.campaign_id === c.id)
      ? {
          ...vibeRows.find((v) => v.campaign_id === c.id),
          channels: channels.filter((v) => v.campaign_id === c.id),
        }
      : undefined,
    ...c,
    impressions:
      c.product_version === 2
        ? (vibeRows.find((v) => v.campaign_id === c.id)?.metrics?.impressions ??
          null)
        : c.impressions,
    reach:
      c.product_version === 2
        ? (vibeRows.find((v) => v.campaign_id === c.id)?.metrics?.households ??
          null)
        : c.reach,
    messages: messages.filter((m) => m.campaign_id === c.id),
    invoices: invoices.filter((i) => i.campaign_id === c.id),
  })) as CreatorCampaign[];
  const { rows: uploads } = await db().query(
    "SELECT id,original_name,metadata FROM campaign_creatives WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
    [identity.userId],
  );
  const { rows: settings } = await db().query(
    "SELECT config FROM settings WHERE id=true",
  );
  return {
    identity,
    coins,
    campaigns,
    invoices,
    uploads,
    config: {
      minimumCents: config.minimumCents.toString(),
      feeBps: config.feeBps,
      serviceFeeCents: config.serviceFeeCents.toString(),
      totalCents: config.totalCents.toString(),
      paymentConfigured: !!config.paymentWallet,
      uploadsConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      maintenance: !!settings[0]?.config.maintenance,
    },
    notice: !config.paymentWallet
      ? "Campaign checkout is awaiting payment-wallet configuration."
      : null,
  };
}
export async function submitForReview(identity: CreatorIdentity, id: string) {
  await platformAvailable();
  const initial = await ownedCampaign(identity, id);
  if (initial.product_version !== 2)
    throw new HttpError(409, "Historical manual orders are read-only");
  await addCoin(identity, initial.mint);
  campaignInput.parse(initial.brief);
  return transaction(async (c) => {
    const campaign = await ownedCampaign(identity, id, c, true);
    if (
      !["DRAFT", "CHANGES_REQUESTED", "CREATIVE_REJECTED"].includes(
        campaign.status,
      )
    )
      throw new HttpError(409, "This campaign is already submitted");
    await transition(
      c,
      id,
      campaign.status,
      "SUBMITTED_FOR_REVIEW",
      identity.wallet,
      "Queued for Vibe creative registration and review; no payment requested",
    );
    await c.query("UPDATE ad_campaigns SET submitted_at=now() WHERE id=$1", [
      id,
    ]);
    return {
      submitted: true,
      notice: "Commercial submitted. Payment remains locked until approval.",
    };
  });
}
