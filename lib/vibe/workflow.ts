import { createHash } from "node:crypto";
import { db, transaction } from "@/lib/server/db";
import { storage } from "@/lib/server/uploads";
import { redact } from "@/lib/server/http";
import { transition } from "@/lib/platform/campaigns";
import { verifyCoinAuthority } from "@/lib/platform/coins";
import {
  campaignInput,
  canTransition,
  type CampaignStatus,
} from "@/lib/platform/model";
import { VibeClient } from "./client";
import { resolveSoleAdvertiser } from "./advertisers";
import { activationGate, vibeConfig } from "./config";
import { VibeStatusMapper } from "./status";
import { assertCreativeApproved } from "./review";
import { VibeReportingSync } from "./reporting";
export async function alert(
  key: string,
  campaign: string | null,
  kind: string,
  message: string,
  severity = "ERROR",
) {
  await db().query(
    `INSERT INTO vibe_alerts(dedupe_key,campaign_id,kind,severity,message) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO UPDATE SET message=EXCLUDED.message,resolved_at=NULL,updated_at=now()`,
    [key, campaign, kind, severity, message],
  );
}
async function state(id: string, to: CampaignStatus, note: string) {
  await transaction(async (c) => {
    const row = (
      await c.query("SELECT status FROM ad_campaigns WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    if (row.status === to) return;
    if (!canTransition(row.status, to))
      throw Error("Provider state transition requires reconciliation");
    await transition(c, id, row.status, to, "VIBE_WORKER", note);
  });
}
// A timed-out create is never blindly replayed. Only the provider's exact deterministic identity can recover it.
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export async function durableCreate<T extends { id: string }>(
  campaign: string,
  key: string,
  payload: unknown,
  find: () => Promise<T | undefined>,
  create: () => Promise<T>,
): Promise<T> {
  const hash = createHash("sha256")
    .update(JSON.stringify(canonical(payload)))
    .digest("hex");
  await db().query(
    `INSERT INTO vibe_operations(operation_key,campaign_id,kind,request_payload,request_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [key, campaign, key.split(":")[0], JSON.stringify(payload), hash],
  );
  const op = (
    await db().query("SELECT * FROM vibe_operations WHERE operation_key=$1", [
      key,
    ])
  ).rows[0];
  if (op.request_hash !== hash)
    throw Error("Provider create payload changed; reconciliation required");
  const recovered = await find();
  if (recovered) {
    await db().query(
      "UPDATE vibe_operations SET status='COMPLETE',external_id=$2,response_payload=$3,error=NULL,updated_at=now() WHERE operation_key=$1",
      [key, recovered.id, JSON.stringify(recovered)],
    );
    return recovered;
  }
  if (op.status !== "READY")
    throw Error(
      "Uncertain provider create: no second create will be sent. Reconcile this operation.",
    );
  const claimed = await db().query(
    "UPDATE vibe_operations SET status='IN_FLIGHT',retry_count=retry_count+1 WHERE operation_key=$1 AND status='READY' RETURNING operation_key",
    [key],
  );
  if (!claimed.rowCount) throw Error("Provider operation already in flight");
  try {
    const result = await create();
    await db().query(
      "UPDATE vibe_operations SET status='COMPLETE',external_id=$2,response_payload=$3,updated_at=now() WHERE operation_key=$1",
      [key, result.id, JSON.stringify(result)],
    );
    return result;
  } catch (error) {
    await db().query(
      "UPDATE vibe_operations SET status='UNKNOWN',error=$2,updated_at=now() WHERE operation_key=$1",
      [key, redact(error)],
    );
    throw error;
  }
}
const adultAges = [
  "RANGE_21_24",
  "RANGE_25_34",
  "RANGE_35_44",
  "RANGE_45_54",
  "RANGE_55_64",
  "RANGE_65_MORE",
];
export async function targeting(
  brief: ReturnType<typeof campaignInput.parse>,
  client: VibeClient,
) {
  const value: Record<string, unknown> = { age_ranges: adultAges };
  if (brief.targeting.geography === "United States") return value;
  const type =
    brief.targeting.geography === "State" ? "REGION" : brief.targeting.geoType;
  if (!type || !["REGION", "CITY", "METRO"].includes(type))
    throw Error("Select an official Vibe geography");
  const data = await client.geo(type, brief.targeting.location);
  const items = Array.isArray(data) ? data : data.data;
  if (
    !Array.isArray(items) ||
    !items.some((r: any) => String(r.id) === brief.targeting.location)
  )
    throw Error("Location not verified in Vibe catalog");
  value.geo = {
    [type === "REGION"
      ? "regions"
      : type === "CITY"
        ? "cities"
        : "metro_codes"]: { include: [brief.targeting.location], exclude: [] },
  };
  return value;
}
async function requireActivationGate() {
  const settings = (
    await db().query("SELECT config FROM settings WHERE id=true")
  ).rows[0]?.config;
  const reason = activationGate();
  if (reason || settings?.maintenance || settings?.paused)
    throw Error(reason || "Activation paused");
}
export async function syncCampaign(id: string, client = new VibeClient()) {
  const lock = await db().connect();
  try {
    if (
      !(
        await lock.query("SELECT pg_try_advisory_lock(hashtext($1)) acquired", [
          "vibe:" + id,
        ])
      ).rows[0].acquired
    )
      return;
    const campaign = (
      await db().query(
        "SELECT c.*,w.wallet FROM ad_campaigns c JOIN platform_wallets w ON w.user_id=c.user_id WHERE c.id=$1 AND c.product_version=2",
        [id],
      )
    ).rows[0];
    if (!campaign) throw Error("Automated campaign not found");
    const brief = campaignInput.parse(campaign.brief),
      config = vibeConfig();
    await verifyCoinAuthority(campaign.wallet, campaign.mint);
    const authorizedAdvertiser = resolveSoleAdvertiser(
      await client.advertisers(),
    );
    const adName = "AIRTIME " + campaign.mint;
    await db().query(
      `INSERT INTO vibe_advertisers(user_id,mint,account_id,name,website) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,mint) DO NOTHING`,
      [
        campaign.user_id,
        campaign.mint,
        config.accountId || null,
        adName,
        brief.website,
      ],
    );
    let advertiser = (
      await db().query(
        "SELECT * FROM vibe_advertisers WHERE user_id=$1 AND mint=$2",
        [campaign.user_id, campaign.mint],
      )
    ).rows[0];
    if (
      config.accountId &&
      advertiser.account_id != null &&
      String(advertiser.account_id) !== config.accountId
    )
      throw Error(
        "Configured Vibe account ID does not match the private integration",
      );
    if (
      advertiser.external_id &&
      advertiser.external_id !== authorizedAdvertiser.id
    )
      throw Error(
        "Stored Vibe advertiser differs from the sole authorized advertiser; administrator reconciliation required",
      );
    await db().query(
      "UPDATE vibe_advertisers SET external_id=$2,account_id=$3,name=$4,last_synced_at=now() WHERE id=$1",
      [
        advertiser.id,
        authorizedAdvertiser.id,
        config.accountId || null,
        authorizedAdvertiser.name,
      ],
    );
    advertiser = {
      ...advertiser,
      external_id: authorizedAdvertiser.id,
      account_id: config.accountId || null,
      name: authorizedAdvertiser.name,
    };
    const name = "AIRTIME campaign " + id;
    await db().query(
      `INSERT INTO vibe_campaigns(campaign_id,user_id,advertiser_id,account_id,name,advertiser_external_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [
        id,
        campaign.user_id,
        advertiser.id,
        config.accountId || null,
        name,
        authorizedAdvertiser.id,
      ],
    );
    let provider = (
      await db().query("SELECT * FROM vibe_campaigns WHERE campaign_id=$1", [
        id,
      ])
    ).rows[0];
    if (
      provider.advertiser_external_id &&
      provider.advertiser_external_id !== authorizedAdvertiser.id
    )
      throw Error(
        "Campaign is bound to a different Vibe advertiser; administrator reconciliation required",
      );
    if (!provider.advertiser_external_id) {
      await db().query(
        "UPDATE vibe_campaigns SET advertiser_external_id=$2 WHERE campaign_id=$1",
        [id, authorizedAdvertiser.id],
      );
      provider.advertiser_external_id = authorizedAdvertiser.id;
    }
    const creativeName = "AIRTIME creative " + brief.creativeId;
    await db().query(
      `INSERT INTO vibe_creatives(campaign_id,user_id,creative_id,name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [id, campaign.user_id, brief.creativeId, creativeName],
    );
    let creative = (
      await db().query(
        "SELECT * FROM vibe_creatives WHERE campaign_id=$1 AND creative_id=$2",
        [id, brief.creativeId],
      )
    ).rows[0];
    if (!creative.external_id) {
      const matches = (await client.creatives(advertiser.external_id)).filter(
        (c) =>
          c.name === creativeName && c.advertiser_id === advertiser.external_id,
      );
      if (matches.length > 1)
        throw Error("Duplicate provider creatives require review");
      let remote = matches[0];
      if (!remote) {
        if (!creative.upload_id) {
          const object = (
            await db().query(
              "SELECT object_path FROM campaign_creatives WHERE id=$1 AND user_id=$2 AND validation_status='TECHNICALLY_VALID'",
              [brief.creativeId, campaign.user_id],
            )
          ).rows[0];
          if (!object) throw Error("Validated private commercial required");
          const download = await storage().download(object.object_path);
          if (download.error || !download.data)
            throw Error("Private commercial unavailable");
          const upload = await client.upload(
            advertiser.external_id,
            Buffer.from(await download.data.arrayBuffer()),
          );
          await db().query(
            "UPDATE vibe_creatives SET upload_id=$2 WHERE id=$1",
            [creative.id, upload],
          );
          creative.upload_id = upload;
        }
        // Official API permits repeating registration with the SAME upload_id after a processing response.
        const result = await client.createCreative(
          advertiser.external_id,
          creativeName,
          creative.upload_id,
        );
        if ("approval_status" in result) remote = result;
        else {
          await state(id, "CREATIVE_UPLOADING", "Vibe video processing");
          return;
        }
      }
      await db().query("UPDATE vibe_creatives SET external_id=$2 WHERE id=$1", [
        creative.id,
        remote.id,
      ]);
      creative.external_id = remote.id;
    }
    const live = (await client.creatives(advertiser.external_id)).find(
      (c) => c.id === creative.external_id,
    );
    if (!live) throw Error("Owned Vibe creative unavailable");
    await db().query(
      "UPDATE vibe_creatives SET approval_status=$2,approval_details=$3,provider_review_snapshot=$4,last_synced_at=now() WHERE id=$1",
      [
        creative.id,
        live.approval_status,
        live.approval_details ? redact(new Error(live.approval_details)) : null,
        JSON.stringify({
          id: live.id,
          approval_status: live.approval_status,
          approval_details: live.approval_details
            ? redact(new Error(live.approval_details))
            : null,
        }),
      ],
    );
    const paid = (
      await db().query(
        "SELECT i.id FROM campaign_invoices i JOIN campaign_payments p ON p.invoice_id=i.id AND p.status='FINALIZED' WHERE i.campaign_id=$1 AND i.status='PAID' AND i.refund_status='NONE'",
        [id],
      )
    ).rowCount;
    if (!paid) {
      if (
        [
          "SUBMITTED_FOR_REVIEW",
          "CREATIVE_UPLOADING",
          "CREATIVE_PENDING",
          "APPROVED_AWAITING_PAYMENT",
          "QUOTE_ACTIVE",
          "PAYMENT_VERIFYING",
        ].includes(campaign.status)
      )
        if (!(
          ["QUOTE_ACTIVE", "PAYMENT_VERIFYING"].includes(campaign.status) &&
          live.approval_status === "AUTHORIZED"
        ))
          await state(
            id,
            VibeStatusMapper.creative(live.approval_status),
            "Vibe creative review status synchronized",
          );
      await db().query(
        "UPDATE vibe_campaigns SET last_synced_at=now(),last_error=NULL WHERE campaign_id=$1",
        [id],
      );
      return;
    }
    const receipt = (
      await db().query(
        "SELECT j.* FROM campaign_provisioning j JOIN campaign_payments p ON p.invoice_id=j.invoice_id AND p.status='FINALIZED' JOIN campaign_invoices i ON i.id=p.invoice_id WHERE j.campaign_id=$1 AND i.status='PAID' AND i.refund_status='NONE'",
        [id],
      )
    ).rows[0];
    if (!receipt)
      throw Error("Finalized payment and durable provisioning job required");
    if (["REFUND_REVIEW", "REFUNDED"].includes(campaign.status)) return;
    if (
      [
        "PAID",
        "READY_TO_ACTIVATE",
        "ACTIVATING",
        "ACTIVATION_FAILED",
        "PROVISIONING_FAILED",
      ].includes(campaign.status)
    )
      await assertCreativeApproved(id, campaign.user_id, client);
    if (
      activationGate() &&
      (!provider.external_id ||
        [
          "PAID",
          "READY_TO_ACTIVATE",
          "ACTIVATING",
          "ACTIVATION_FAILED",
          "PROVISIONING_FAILED",
        ].includes(campaign.status))
    ) {
      if (campaign.status === "PAID")
        await state(
          id,
          "READY_TO_ACTIVATE",
          "Payment confirmed; prelaunch/test mode holds provider provisioning",
        );
      await db().query(
        "UPDATE campaign_provisioning SET status='READY',updated_at=now() WHERE campaign_id=$1",
        [id],
      );
      return;
    }
    if (
      [
        "PAID",
        "READY_TO_ACTIVATE",
        "ACTIVATION_FAILED",
        "PROVISIONING_FAILED",
      ].includes(campaign.status)
    )
      await state(
        id,
        "ACTIVATING",
        "Payment confirmed; provisioning the paid campaign",
      );
    await db().query(
      "UPDATE campaign_provisioning SET status='RUNNING',updated_at=now() WHERE campaign_id=$1 AND status<>'COMPLETE'",
      [id],
    );
    if (!provider.external_id) {
      const p = await durableCreate(
        id,
        "campaign:" + id,
        { name, advertiser_id: advertiser.external_id },
        async () => {
          const matches = (
            await client.campaigns(advertiser.external_id)
          ).filter(
            (p) =>
              p.name === name && p.advertiser_id === advertiser.external_id,
          );
          if (matches.length > 1)
            throw Error("Duplicate provider campaigns require review");
          return matches[0];
        },
        () => client.createCampaign(advertiser.external_id, name),
      );
      await db().query(
        "UPDATE vibe_campaigns SET external_id=$2 WHERE campaign_id=$1",
        [id, p.id],
      );
      provider.external_id = p.id;
    }
    let strategy = (
      await db().query("SELECT * FROM vibe_strategies WHERE campaign_id=$1", [
        id,
      ])
    ).rows[0];
    const externalStrategies = await client.strategies(provider.external_id);
    if (externalStrategies.length > 1)
      throw Error("Exactly one strategy per campaign is required");
    if (!strategy?.external_id) {
      const start = new Date(
          Math.max(
            Date.parse(brief.proposedStart + "T00:00:00Z"),
            Date.now() + 86400000,
          ),
        ).toISOString(),
        end = new Date(Date.parse(start) + 7 * 86400000).toISOString();
      const order = {
        campaign_id: provider.external_id,
        name: "AIRTIME strategy " + id,
        budget: 50 as const,
        budget_type: "GLOBAL" as const,
        starts_at: start,
        ends_at: end,
        active: false,
        creative_ids: [creative.external_id],
        targeting: await targeting(brief, client),
      };
      const frozen =
        (
          await db().query(
            "SELECT request_payload FROM vibe_operations WHERE operation_key=$1",
            ["strategy:" + id],
          )
        ).rows[0]?.request_payload || order;
      const p = await durableCreate(
        id,
        "strategy:" + id,
        frozen,
        async () =>
          externalStrategies.find(
            (s) =>
              s.name === order.name && s.campaign_id === provider.external_id,
          ),
        () => client.createStrategy(frozen),
      );
      client.assertBudget({ ...p, ends_at: p.ends_at || "" });
      await db().query(
        `INSERT INTO vibe_strategies(campaign_id,external_id,name,targeting,starts_at,ends_at,active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(campaign_id) DO UPDATE SET external_id=EXCLUDED.external_id`,
        [
          id,
          p.id,
          p.name,
          JSON.stringify(p.targeting),
          p.starts_at,
          p.ends_at,
          p.active,
        ],
      );
      strategy = (
        await db().query("SELECT * FROM vibe_strategies WHERE campaign_id=$1", [
          id,
        ])
      ).rows[0];
    }
    const strategyLive = await client.strategy(strategy.external_id);
    if (
      strategyLive.active &&
      (strategyLive.budget !== 50 ||
        strategyLive.budget_type !== "GLOBAL" ||
        !strategyLive.ends_at)
    ) {
      await client.action(strategyLive.id, "PAUSE");
      throw Error("Unsafe provider budget paused; reconciliation required");
    }
    client.assertBudget({
      ...strategyLive,
      ends_at: strategyLive.ends_at || "",
    });
    if (strategyLive.campaign_id !== provider.external_id)
      throw Error("Strategy ownership mismatch");
    if (
      strategyLive.creative_ids.length !== 1 ||
      strategyLive.creative_ids[0] !== creative.external_id
    ) {
      if (
        strategyLive.active ||
        ![
          "SUBMITTED_FOR_REVIEW",
          "CREATIVE_UPLOADING",
          "CREATIVE_PENDING",
        ].includes(campaign.status)
      )
        throw Error("Cannot replace creative on an active or paid strategy");
      await client.updateStrategy(strategy.external_id, {
        budget: 50,
        budget_type: "GLOBAL",
        starts_at: strategyLive.starts_at,
        ends_at: strategyLive.ends_at!,
        active: false,
        creative_ids: [creative.external_id],
        targeting: strategyLive.targeting,
      });
    }
    if (
      [
        "PAID",
        "READY_TO_ACTIVATE",
        "ACTIVATING",
        "ACTIVATION_FAILED",
        "PROVISIONING_FAILED",
      ].includes(campaign.status)
    ) {
      const settings = (
        await db().query("SELECT config FROM settings WHERE id=true")
      ).rows[0]?.config;
      const blocked = activationGate();
      if (settings?.maintenance || settings?.paused || blocked)
        throw Error(blocked || "Activation paused");
      await assertCreativeApproved(id, campaign.user_id, client);
      const current = await client.strategy(strategy.external_id);
      if (
        current.campaign_id !== provider.external_id ||
        current.creative_ids.length !== 1 ||
        current.creative_ids[0] !== creative.external_id
      )
        throw Error("Strategy ownership/creative mismatch");
      client.assertBudget({ ...current, ends_at: current.ends_at || "" });
      if (Date.parse(current.ends_at!) <= Date.now() && current.active)
        throw Error(
          "Campaign window expired; operator reconciliation required",
        );
      await state(
        id,
        "ACTIVATING",
        "Finalized payment verified; activating existing strategy",
      );
      const before = await client.campaign(provider.external_id);
      if (before.status === "DRAFT") {
        const dates = (
          await db().query(
            "UPDATE vibe_strategies SET activation_starts_at=coalesce(activation_starts_at,greatest(now()+interval '1 hour',$2::timestamptz)),activation_ends_at=coalesce(activation_ends_at,greatest(now()+interval '1 hour',$2::timestamptz)+interval '7 days') WHERE campaign_id=$1 RETURNING activation_starts_at,activation_ends_at",
            [id, brief.proposedStart + "T00:00:00Z"],
          )
        ).rows[0];
        await client.updateStrategy(current.id, {
          budget: 50,
          budget_type: "GLOBAL",
          starts_at: dates.activation_starts_at.toISOString(),
          ends_at: dates.activation_ends_at.toISOString(),
          active: false,
          creative_ids: [creative.external_id],
          targeting: current.targeting,
        });
      }
      if (before.status === "DRAFT") {
        await requireActivationGate();
        await client.publish(provider.external_id);
      } else if (before.status !== "PUBLISHED")
        throw Error("Provider campaign cannot be activated");
      if (!current.active) {
        await requireActivationGate();
        await client.action(current.id, "ACTIVATE");
      }
    }
    const remote = await client.campaign(provider.external_id);
    if (remote.advertiser_id !== advertiser.external_id)
      throw Error("Provider advertiser mismatch");
    await db().query(
      "UPDATE vibe_campaigns SET provider_status=$2,delivery_status=$3,last_synced_at=now(),last_error=NULL,updated_at=now() WHERE campaign_id=$1",
      [id, remote.status, remote.state],
    );
    await db().query(
      "UPDATE vibe_campaigns SET retry_count=0,next_attempt_at=now() WHERE campaign_id=$1",
      [id],
    );
    if (paid && ["PAYMENT_ISSUE", "BLOCKED"].includes(remote.state || ""))
      await alert(
        "provider-delivery:" + id,
        id,
        "PROVIDER_DELIVERY_BLOCKED",
        "Vibe reports " +
          remote.state +
          ". Review billing/approval before retrying activation.",
      );
    if (paid && remote.status === "PUBLISHED") {
      await db().query(
        "UPDATE campaign_provisioning SET status='COMPLETE',error=NULL,updated_at=now() WHERE campaign_id=$1",
        [id],
      );
      if (campaign.status !== "COMPLETED")
        await state(
          id,
          VibeStatusMapper.delivery(remote),
          "Vibe delivery synchronized",
        );
      await new VibeReportingSync(client).sync(id);
    }
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext($1))", ["vibe:" + id]);
    lock.release();
  }
}
export async function runVibeSync(client = new VibeClient()) {
  const run = (
    await db().query(
      "INSERT INTO vibe_reconciliation_runs DEFAULT VALUES RETURNING id",
    )
  ).rows[0].id;
  let processed = 0,
    errors = 0;
  const config = vibeConfig();
  const settings = (
    await db().query("SELECT config FROM settings WHERE id=true")
  ).rows[0]?.config;
  if (settings?.maintenance || settings?.paused) {
    await db().query(
      "UPDATE vibe_reconciliation_runs SET status='PAUSED',completed_at=now() WHERE id=$1",
      [run],
    );
    return { paused: true };
  }
  const rows = (
    await db().query(
      "SELECT a.id FROM ad_campaigns a LEFT JOIN vibe_campaigns v ON v.campaign_id=a.id WHERE a.product_version=2 AND a.status NOT IN ('DRAFT','REFUNDED','REFUND_REVIEW','CREATIVE_REJECTED') AND (v.retry_count IS NULL OR v.retry_count<12) AND (v.next_attempt_at IS NULL OR v.next_attempt_at<=now()) ORDER BY greatest(a.updated_at,coalesce(v.last_synced_at,a.updated_at)) LIMIT 3",
    )
  ).rows;
  for (const row of rows) {
    await db().query("UPDATE ad_campaigns SET updated_at=now() WHERE id=$1", [
      row.id,
    ]);
    try {
      await syncCampaign(row.id, client);
      processed++;
    } catch (e) {
      errors++;
      const message = redact(e);
      await db().query(
        "UPDATE vibe_campaigns SET last_error=$2,updated_at=now() WHERE campaign_id=$1",
        [row.id, message],
      );
      await db().query(
        "UPDATE campaign_provisioning SET status='FAILED',attempts=least(attempts+1,12),error=$2,updated_at=now() WHERE campaign_id=$1 AND status<>'COMPLETE'",
        [row.id, message],
      );
      await alert("sync:" + row.id, row.id, "SYNC_FAILED", message);
      const current = (
        await db().query("SELECT status FROM ad_campaigns WHERE id=$1", [
          row.id,
        ])
      ).rows[0];
      if (
        [
          "PAID",
          "READY_TO_ACTIVATE",
          "ACTIVATING",
          "ACTIVATION_FAILED",
          "PROVISIONING_FAILED",
        ].includes(current.status) &&
        !activationGate()
      ) {
        if (current.status !== "PROVISIONING_FAILED")
          await state(
            row.id,
            "PROVISIONING_FAILED",
            "Activation failed; payment retained, bounded retry uses original provider IDs",
          );
        await db().query(
          "UPDATE vibe_campaigns SET retry_count=least(retry_count+1,12),next_attempt_at=now()+interval '5 minutes'*power(2,least(retry_count,6)) WHERE campaign_id=$1",
          [row.id],
        );
      }
    }
  }
  try {
    const balance = await client.balance();
    if (
      !/^\d{1,15}$/.test(String(balance.account_id)) ||
      (config.accountId && String(balance.account_id) !== config.accountId) ||
      balance.currency.toUpperCase() !== "USD" ||
      !/^[-]?\d+$/.test(String(balance.balance_cents))
    )
      throw Error("Unsupported provider billing response");
    await db().query(
      "INSERT INTO vibe_account_snapshots(account_id,balance_cents,currency,last_synced_at) VALUES($1,$2,'USD',now()) ON CONFLICT(account_id) DO UPDATE SET balance_cents=EXCLUDED.balance_cents,last_synced_at=now(),last_error=NULL",
      [String(balance.account_id), String(balance.balance_cents)],
    );
    if (BigInt(balance.balance_cents) > 0n)
      await alert(
        "billing:" + balance.account_id,
        null,
        "OUTSTANDING_BILLING",
        "Vibe reports an outstanding account billing amount. Verify the billing card and threshold in Vibe.",
        "WARNING",
      );
  } catch (e) {
    await alert("billing-health", null, "VIBE_AUTH_OR_BILLING", redact(e));
  }
  await db().query(
    "UPDATE vibe_reconciliation_runs SET completed_at=now(),status=$2,processed=$3,error=$4 WHERE id=$1",
    [
      run,
      errors ? "FAILED" : "COMPLETED",
      processed,
      errors ? `${errors} campaigns need reconciliation` : null,
    ],
  );
  return { processed, errors };
}
