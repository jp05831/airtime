import { db, transaction } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { z } from "zod";
import { signature, optionalUrl } from "@/lib/validation";
import { origin } from "@/lib/server/config";
import {
  finalizedTransaction,
  verifyPaymentStructure,
  confirmPayment,
  invoiceMemo,
} from "./payments";
import { logOperation, transition } from "./campaigns";
import { verifyCoinAuthority } from "./coins";
export async function operationsState(page = 1) {
  const { rows: campaigns } = await db().query(
    `SELECT c.*,p.name coin_name,p.ticker,w.wallet creator_wallet,coalesce(m.impressions,0)::text impressions,coalesce(m.reach,0)::text reach,m.cpm_cents FROM ad_campaigns c JOIN platform_coins p ON p.mint=c.mint JOIN platform_wallets w ON w.user_id=c.user_id LEFT JOIN campaign_metrics m ON m.campaign_id=c.id ORDER BY c.updated_at DESC LIMIT 50 OFFSET $1`,
    [(page - 1) * 50],
  );
  const { rows: invoices } = await db().query(
    "SELECT i.*,p.signature,r.signature refund_signature,r.status refund_state,r.reason refund_reason,r.id refund_id,r.amount_lamports refund_lamports FROM campaign_invoices i LEFT JOIN campaign_payments p ON p.invoice_id=i.id LEFT JOIN campaign_refunds r ON r.invoice_id=i.id WHERE i.campaign_id=ANY($1::uuid[]) ORDER BY i.created_at DESC",
    [campaigns.map((c) => c.id)],
  );
  const { rows: messages } = await db().query(
    "SELECT * FROM creator_messages WHERE campaign_id=ANY($1::uuid[]) ORDER BY created_at",
    [campaigns.map((c) => c.id)],
  );
  const { rows: sync } = await db().query(
    "SELECT * FROM sync_state WHERE id=true",
  );
  const { rows: failures } = await db().query(
    "SELECT signature,status,attempts,error FROM webhook_events WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 30",
  );
  const { rows: audit } = await db().query(
    "SELECT * FROM operations_audit ORDER BY created_at DESC LIMIT 100",
  );
  const { rows: s } = await db().query(
    "SELECT config FROM settings WHERE id=true",
  );
  const financials = (
    await db().query(
      "SELECT (SELECT coalesce(sum(media_spend_cents),0)::text FROM ad_campaigns) media_spend_cents,(SELECT coalesce(sum(platform_cost_cents),0)::text FROM ad_campaigns) partner_cost_cents,(SELECT coalesce(sum(platform_fee_cents),0)::text FROM campaign_invoices WHERE status='PAID' AND refund_status='NONE') service_fee_cents",
    )
  ).rows[0];
  return {
    financials,
    campaigns: campaigns.map((c) => ({
      ...c,
      invoices: invoices.filter((i) => i.campaign_id === c.id),
      messages: messages.filter((m) => m.campaign_id === c.id),
    })),
    sync: sync[0],
    failures,
    audit,
    maintenance: !!s[0].config.maintenance,
    page,
  };
}
const checklistInput = z.object({
  authority: z.literal(true),
  payment: z.literal(true),
  creativeRights: z.literal(true),
  riskDisclosure: z.literal(true),
  legalReview: z.literal(true),
  platformApproval: z.literal(true),
});
export const operationInput = z.object({
  action: z.enum([
    "REVIEW",
    "MESSAGE",
    "REPORT",
    "REFUND_REQUEST",
    "REFUND_VERIFY",
    "VERIFY_PAYMENT",
    "MAINTENANCE",
  ]),
  id: z.string().uuid().optional(),
  status: z.string().optional(),
  note: z.string().max(3000).default(""),
  checklist: checklistInput.optional(),
  approvalProofUrl: optionalUrl.optional(),
  placementProofUrl: optionalUrl.optional(),
  proofId: z.string().uuid().optional(),
  platform: z.string().max(150).optional(),
  externalId: z.string().max(200).optional(),
  actualStart: z.string().datetime().optional(),
  actualEnd: z.string().datetime().optional(),
  mediaSpendCents: z
    .string()
    .regex(/^\d{1,12}$/)
    .optional(),
  platformCostCents: z
    .string()
    .regex(/^\d{1,12}$/)
    .optional(),
  impressions: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
  reach: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
  cpmCents: z
    .string()
    .regex(/^\d{1,12}$/)
    .optional(),
  signature: signature.optional(),
  enabled: z.boolean().optional(),
  publicProof: z.boolean().optional(),
});
export async function adminOperation(adminId: string, payload: unknown) {
  const v = operationInput.parse(payload);
  if (v.action === "MAINTENANCE") {
    if (v.enabled === undefined)
      throw new HttpError(400, "Maintenance state required");
    return transaction(async (c) => {
      await c.query(
        "UPDATE settings SET config=jsonb_set(config,'{maintenance}',$1::jsonb),updated_at=now() WHERE id=true",
        [JSON.stringify(v.enabled)],
      );
      await logOperation(
        adminId,
        "MAINTENANCE",
        "platform",
        { enabled: v.enabled },
        c,
      );
      return { saved: true };
    });
  }
  if (!v.id) throw new HttpError(400, "Campaign required");
  const initial = (
    await db().query(
      "SELECT c.*,w.wallet FROM ad_campaigns c JOIN platform_wallets w ON w.user_id=c.user_id WHERE c.id=$1",
      [v.id],
    )
  ).rows[0];
  if (!initial) throw new HttpError(404, "Campaign not found");
  if (initial.product_version === 2 && ["REVIEW", "REPORT"].includes(v.action))
    throw new HttpError(
      409,
      "Vibe owns creative review and reporting for automated campaigns",
    );
  if (v.action === "VERIFY_PAYMENT") {
    if (!v.signature) throw new HttpError(400, "Signature required");
    const invoice = (
      await db().query(
        "SELECT id FROM campaign_invoices WHERE campaign_id=$1 AND status IN ('OPEN','VERIFYING') ORDER BY created_at DESC LIMIT 1",
        [v.id],
      )
    ).rows[0];
    if (!invoice) throw new HttpError(409, "No verifiable invoice");
    const result = await confirmPayment(invoice.id, v.signature);
    await logOperation(adminId, "ADMIN_PAYMENT_VERIFY", v.id, {
      signature: v.signature,
    });
    return result;
  }
  if (v.action === "REVIEW" && v.status === "APPROVED")
    await verifyCoinAuthority(initial.wallet, initial.mint);
  let refundProof: any = null;
  if (v.action === "REFUND_VERIFY") {
    if (!v.signature) throw new HttpError(400, "Refund signature required");
    const row = (
      await db().query(
        "SELECT r.*,i.recipient_wallet,i.creator_wallet FROM campaign_refunds r JOIN campaign_invoices i ON i.id=r.invoice_id WHERE r.campaign_id=$1",
        [v.id],
      )
    ).rows[0];
    if (!row || row.status === "VERIFIED")
      throw new HttpError(409, "No pending refund");
    const tx = await finalizedTransaction(v.signature);
    refundProof = verifyPaymentStructure(
      tx,
      {
        id: "REFUND:" + row.id,
        creator_wallet: row.recipient_wallet,
        recipient_wallet: row.creator_wallet,
        required_lamports: row.amount_lamports,
        created_at: row.created_at,
        expires_at: "2999-01-01T00:00:00Z",
      },
      true,
    );
    refundProof.transaction = tx;
    refundProof.signature = v.signature;
    refundProof.id = row.id;
  }
  return transaction(async (c) => {
    const campaign = (
      await c.query("SELECT * FROM ad_campaigns WHERE id=$1 FOR UPDATE", [v.id])
    ).rows[0];
    if (v.action === "MESSAGE") {
      if (!v.note.trim()) throw new HttpError(400, "Message required");
      await c.query(
        "INSERT INTO creator_messages(campaign_id,sender,body) VALUES($1,$2,$3)",
        [v.id, "AIRTIME", v.note],
      );
    }
    if (v.action === "REVIEW") {
      if (
        ["CHANGES_REQUESTED", "REJECTED"].includes(v.status || "") &&
        !v.note.trim()
      )
        throw new HttpError(
          400,
          "A creator-facing review explanation is required",
        );
      if (!v.status) throw new HttpError(400, "Status required");
      let approval = v.approvalProofUrl || campaign.approval_proof_url;
      if (v.proofId) {
        const proof = (
          await c.query(
            "SELECT id FROM platform_proofs WHERE id=$1 AND campaign_id=$2 AND kind='APPROVAL'",
            [v.proofId, v.id],
          )
        ).rows[0];
        if (!proof) throw new HttpError(400, "Approval proof not found");
        approval = origin() + "/api/creator/proof?id=" + proof.id;
      }
      if (v.status === "APPROVED" && (!v.checklist || !approval))
        throw new HttpError(
          400,
          "Complete compliance checklist and actual platform approval evidence are required",
        );
      if (
        ["SCHEDULING", "SCHEDULED", "LIVE", "COMPLETED"].includes(v.status) &&
        !campaign.approval_proof_url
      )
        throw new HttpError(409, "Recorded approval required");
      if (
        v.status === "SCHEDULED" &&
        (!v.platform ||
          !v.externalId ||
          !v.actualStart ||
          !v.actualEnd ||
          new Date(v.actualEnd).getTime() <= new Date(v.actualStart).getTime())
      )
        throw new HttpError(
          400,
          "External campaign ID, platform and valid run dates required",
        );
      if (
        v.status === "COMPLETED" &&
        (!campaign.placement_proof_url || !campaign.actual_end)
      )
        throw new HttpError(
          409,
          "Run dates and placement proof required before completion",
        );
      await transition(
        c,
        v.id!,
        campaign.status,
        v.status as any,
        adminId,
        v.note,
      );
      await c.query(
        "UPDATE ad_campaigns SET approval_proof_url=coalesce($2,approval_proof_url),external_platform=coalesce($3,external_platform),external_campaign_id=coalesce($4,external_campaign_id),actual_start=coalesce($5,actual_start),actual_end=coalesce($6,actual_end),updated_at=now() WHERE id=$1",
        [v.id, approval, v.platform, v.externalId, v.actualStart, v.actualEnd],
      );
      await c.query(
        "INSERT INTO campaign_reviews(campaign_id,admin_id,decision,checklist,note) VALUES($1,$2,$3,$4,$5)",
        [v.id, adminId, v.status, JSON.stringify(v.checklist || {}), v.note],
      );
      if (v.note.trim())
        await c.query(
          "INSERT INTO creator_messages(campaign_id,sender,body) VALUES($1,$2,$3)",
          [v.id, "AIRTIME", v.note],
        );
    }
    if (v.action === "REPORT") {
      if (v.publicProof && !campaign.brief.publicProofConsent)
        throw new HttpError(
          403,
          "Creator permission is required to publish placement proof",
        );
      if (!["SCHEDULED", "LIVE", "COMPLETED"].includes(campaign.status))
        throw new HttpError(
          409,
          "Only fulfilled campaigns can report delivery",
        );
      if (
        v.mediaSpendCents &&
        BigInt(v.mediaSpendCents) > BigInt(campaign.media_budget_cents)
      )
        throw new HttpError(400, "Spend exceeds the paid media budget");
      let proof = v.placementProofUrl;
      if (v.proofId) {
        const p = (
          await c.query(
            "SELECT id FROM platform_proofs WHERE id=$1 AND campaign_id=$2 AND kind IN ('PLACEMENT','RECEIPT')",
            [v.proofId, v.id],
          )
        ).rows[0];
        if (!p) throw new HttpError(400, "Placement proof not found");
        proof = origin() + "/api/creator/proof?id=" + p.id;
      }
      await c.query(
        "UPDATE ad_campaigns SET media_spend_cents=coalesce($2,media_spend_cents),platform_cost_cents=coalesce($3,platform_cost_cents),placement_proof_url=coalesce($4,placement_proof_url),public_proof=coalesce($5,public_proof),updated_at=now() WHERE id=$1",
        [v.id, v.mediaSpendCents, v.platformCostCents, proof, v.publicProof],
      );
      await c.query(
        "INSERT INTO campaign_metrics(campaign_id,impressions,reach,cpm_cents) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id) DO UPDATE SET impressions=EXCLUDED.impressions,reach=EXCLUDED.reach,cpm_cents=EXCLUDED.cpm_cents,updated_at=now()",
        [v.id, v.impressions || "0", v.reach || "0", v.cpmCents || null],
      );
    }
    if (v.action === "REFUND_REQUEST") {
      if (
        !(
          [
            "PAID",
            "READY_TO_ACTIVATE",
            "ACTIVATION_FAILED",
            "PROVISIONING_FAILED",
          ].includes(campaign.status) && campaign.product_version === 2
        ) ||
        BigInt(campaign.media_spend_cents) > 0n ||
        BigInt(campaign.platform_cost_cents) > 0n
      )
        throw new HttpError(
          409,
          "Full pre-placement refund requires a rejected, unspent order",
        );
      if (!v.note.trim()) throw new HttpError(400, "Refund reason required");
      const provider = (
        await c.query(
          "SELECT provider_status,external_id FROM vibe_campaigns WHERE campaign_id=$1",
          [v.id],
        )
      ).rows[0];
      if (provider?.external_id && provider.provider_status !== "DRAFT")
        throw new HttpError(
          409,
          "Provider spend must be reconciled before a refund can be reviewed",
        );
      const invoice = (
        await c.query(
          "SELECT i.id,p.amount_lamports FROM campaign_invoices i JOIN campaign_payments p ON p.invoice_id=i.id WHERE i.campaign_id=$1 AND i.status='PAID' FOR UPDATE OF i",
          [v.id],
        )
      ).rows[0];
      if (!invoice) throw new HttpError(409, "Finalized payment required");
      await c.query(
        "INSERT INTO campaign_refunds(invoice_id,campaign_id,amount_lamports,reason) VALUES($1,$2,$3,$4)",
        [invoice.id, v.id, invoice.amount_lamports, v.note],
      );
      await c.query(
        "UPDATE campaign_invoices SET refund_status='PENDING' WHERE id=$1",
        [invoice.id],
      );
      await transition(
        c,
        v.id!,
        campaign.status,
        "REFUND_REVIEW",
        adminId,
        v.note,
      );
    }
    if (v.action === "REFUND_VERIFY") {
      // Only a real, exact finalized payment-wallet transfer can close a refund.
      const used = await c.query(
        "SELECT signature FROM campaign_payments WHERE signature=$1 UNION ALL SELECT signature FROM campaign_refunds WHERE signature=$1",
        [refundProof.signature],
      );
      if (used.rowCount)
        throw new HttpError(409, "Transaction already recorded");
      await c.query(
        "UPDATE campaign_refunds SET signature=$2,status='VERIFIED',evidence=$3,confirmed_at=now() WHERE id=$1",
        [
          refundProof.id,
          refundProof.signature,
          JSON.stringify(refundProof, (_, value) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        ],
      );
      await c.query(
        "UPDATE campaign_invoices SET refund_status='VERIFIED' WHERE id=(SELECT invoice_id FROM campaign_refunds WHERE id=$1)",
        [refundProof.id],
      );
      await transition(
        c,
        v.id!,
        campaign.status,
        "REFUNDED",
        adminId,
        "Exact finalized refund verified",
      );
    }
    await logOperation(adminId, "ADMIN_" + v.action, v.id!, v, c);
    return { saved: true };
  });
}
export { invoiceMemo };
