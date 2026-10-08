import { adminHandler } from "@/lib/server/admin";
import { body, HttpError, redact } from "@/lib/server/http";
import { db, transaction } from "@/lib/server/db";
import { logOperation } from "@/lib/platform/campaigns";
import { VibeClient } from "@/lib/vibe/client";
import { resolveSoleAdvertiser } from "@/lib/vibe/advertisers";
import { vibeConfig, activationGate } from "@/lib/vibe/config";
import { runVibeSync } from "@/lib/vibe/workflow";
import { z } from "zod";
export const GET = adminHandler(async () => {
  const config = vibeConfig(),
    settings = (await db().query("SELECT config FROM settings WHERE id=true"))
      .rows[0]?.config;
  const [counts, settlements, alerts, runs, balance] = await Promise.all([
    db().query(
      "SELECT status,count(*)::text count FROM ad_campaigns WHERE product_version=2 GROUP BY status",
    ),
    db().query(
      "SELECT s.status,sum(s.customer_lamports)::text sol_collected_lamports,sum(CASE WHEN i.refund_status='VERIFIED' THEN 0 ELSE s.media_cents END)::text media_allocation_cents,sum(CASE WHEN i.refund_status='VERIFIED' THEN 0 ELSE greatest(s.media_cents*10000-coalesce(s.vibe_spend_microusd,0),0) END)::text media_liability_microusd,sum(CASE WHEN i.refund_status='VERIFIED' THEN 0 ELSE s.service_fee_cents END)::text service_fee_cents,sum(CASE WHEN r.status='VERIFIED' THEN r.amount_lamports ELSE 0 END)::text refunded_lamports FROM campaign_settlements s JOIN campaign_invoices i ON i.id=s.invoice_id LEFT JOIN campaign_refunds r ON r.invoice_id=i.id GROUP BY s.status",
    ),
    db().query(
      "SELECT * FROM vibe_alerts WHERE resolved_at IS NULL ORDER BY updated_at DESC LIMIT 50",
    ),
    db().query(
      "SELECT * FROM vibe_reconciliation_runs ORDER BY started_at DESC LIMIT 10",
    ),
    db().query("SELECT * FROM vibe_account_snapshots"),
  ]);
  return {
    gates: {
      live: config.live,

      blocked: activationGate(),
    },
    counts: counts.rows,
    settlements: settlements.rows,
    alerts: alerts.rows,
    runs: runs.rows,
    balance: balance.rows,
    orders: (
      await db().query(
        `SELECT a.id,a.status,w.wallet,a.mint,c.name coin_name,c.ticker coin_symbol,vc.external_id creative_id,vc.approval_status,vc.approval_details rejection_reason,i.id invoice_id,i.expires_at quote_expires_at,i.required_lamports amount_lamports,i.total_usd_cents total_cents,i.payment_reference,p.signature payment_signature,v.external_id vibe_campaign_id,v.advertiser_external_id,vs.external_id strategy_id,j.attempts provisioning_attempts,j.status job_status,j.error job_error,m.spend_microusd,m.impressions,m.completed_views,greatest(50000000-coalesce(m.spend_microusd,0),0)::text remaining_media_microusd FROM ad_campaigns a JOIN platform_wallets w ON w.user_id=a.user_id JOIN platform_coins c ON c.mint=a.mint LEFT JOIN vibe_creatives vc ON vc.campaign_id=a.id AND vc.creative_id=(a.brief->>'creativeId')::uuid LEFT JOIN campaign_invoices i ON i.id=(SELECT id FROM campaign_invoices WHERE campaign_id=a.id ORDER BY created_at DESC LIMIT 1) LEFT JOIN campaign_payments p ON p.invoice_id=i.id AND p.status='FINALIZED' LEFT JOIN vibe_campaigns v ON v.campaign_id=a.id LEFT JOIN vibe_strategies vs ON vs.campaign_id=a.id LEFT JOIN campaign_provisioning j ON j.campaign_id=a.id LEFT JOIN vibe_campaign_metrics m ON m.campaign_id=a.id WHERE a.product_version=2 ORDER BY a.updated_at DESC LIMIT 100`,
      )
    ).rows,
  };
}, false);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CONNECTIVITY") }),
  z.object({ action: z.literal("SYNC") }),
  z.object({
    action: z.literal("SETTLEMENT"),
    invoiceId: z.string().uuid(),
    status: z.enum(["CONVERTED", "VIBE_FUNDED", "RECONCILED", "FAILED"]),
    reference: z.string().min(3).max(500),
  }),
  z.object({ action: z.literal("PAUSE"), campaignId: z.string().uuid() }),
]);
export const POST = adminHandler(async (r, admin) => {
  const v = input.parse(await body(r)),
    client = new VibeClient();
  if (v.action === "CONNECTIVITY") {
    let advertiser;
    try {
      advertiser = resolveSoleAdvertiser(await client.advertisers());
    } catch (error) {
      throw new HttpError(503, redact(error));
    }
    await logOperation(
      admin.id,
      "VIBE_READ_ONLY_ADVERTISER_CHECK",
      advertiser.id,
      {},
    );
    return {
      connected: true,
      advertisers: [{ id: advertiser.id, name: advertiser.name }],
    };
  }
  if (v.action === "SETTLEMENT")
    return transaction(async (c) => {
      const row = (
        await c.query(
          "SELECT * FROM campaign_settlements WHERE invoice_id=$1 FOR UPDATE",
          [v.invoiceId],
        )
      ).rows[0];
      if (row?.status === v.status && row.conversion_reference === v.reference)
        return { saved: true, alreadyRecorded: true };
      const next: Record<string, string[]> = {
        PENDING_CONVERSION: ["CONVERTED", "FAILED"],
        CONVERTED: ["VIBE_FUNDED", "FAILED"],
        VIBE_FUNDED: ["RECONCILED", "FAILED"],
        FAILED: ["CONVERTED"],
        RECONCILED: [],
      };
      if (!row || !next[row.status]?.includes(v.status))
        throw new HttpError(409, "Invalid settlement transition");
      await c.query(
        "UPDATE campaign_settlements SET status=$2,conversion_reference=$3,updated_at=now() WHERE invoice_id=$1",
        [v.invoiceId, v.status, v.reference],
      );
      await logOperation(
        admin.id,
        "SETTLEMENT",
        v.invoiceId,
        { status: v.status, reference: v.reference },
        c,
      );
      return { saved: true };
    });
  if (v.action === "PAUSE") {
    const row = (
      await db().query(
        "SELECT external_id FROM vibe_strategies WHERE campaign_id=$1",
        [v.campaignId],
      )
    ).rows[0];
    if (!row?.external_id) throw new HttpError(404, "Strategy unavailable");
    await client.action(row.external_id, "PAUSE");
    await logOperation(admin.id, "VIBE_PAUSE", v.campaignId, {});
    return { paused: true };
  }
  await logOperation(admin.id, "VIBE_SYNC", "platform", {});
  return runVibeSync(client);
});
