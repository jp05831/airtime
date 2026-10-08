import { transition } from "@/lib/platform/campaigns";
import { transaction } from "@/lib/server/db";
import { db } from "@/lib/server/db";
import { decimalUnits } from "./money";
import { VibeClient } from "./client";
import { alert } from "./workflow";
export function verifiedSummary(
  rows: any[],
  campaign: string,
  advertiser: string,
) {
  if (
    rows.length !== 1 ||
    rows[0].campaign_id !== campaign ||
    rows[0].advertiser_id !== advertiser
  )
    throw Error("Unsupported or unscoped report; no metrics credited");
  const row = rows[0],
    count = (key: string) => {
      if (row[key] == null) return null;
      const n = decimalUnits(String(row[key]), 0);
      if (n < 0n) throw Error("Negative report count");
      return n.toString();
    };
  const spend = row.spend == null ? null : decimalUnits(String(row.spend), 6);
  if (spend !== null && spend < 0n) throw Error("Negative spend rejected");
  return {
    spend,
    impressions: count("impressions"),
    views: count("completed_views"),
    households: count("households"),
    vtr: row.view_through_rate == null ? null : String(row.view_through_rate),
    cpm: row.cpm == null ? null : String(row.cpm),
    frequency: row.frequency == null ? null : String(row.frequency),
    raw: row,
  };
}
export class VibeReportingSync {
  constructor(private client = new VibeClient()) {}
  async sync(id: string) {
    const row = (
      await db().query(
        `SELECT c.*,a.external_id advertiser_external,s.external_id strategy_id FROM vibe_campaigns c JOIN vibe_advertisers a ON a.id=c.advertiser_id JOIN vibe_strategies s ON s.campaign_id=c.campaign_id WHERE c.campaign_id=$1`,
        [id],
      )
    ).rows[0];
    if (!row?.external_id)
      throw Error("Owned reporting identifiers unavailable");
    if (row.breakdown_report_id) {
      const report = await this.client.report(row.breakdown_report_id);
      if (report.status === "FAILED") {
        await db().query(
          "UPDATE vibe_campaigns SET breakdown_report_id=NULL WHERE campaign_id=$1",
          [id],
        );
        throw Error("Breakdown report failed");
      }
      if (report.status !== "READY") return { pending: true };
      const rows = await this.client.reportRows(report.download_url);
      for (const item of rows) {
        const label = item[row.breakdown_dimension];
        if (
          item.campaign_id !== row.external_id ||
          item.advertiser_id !== row.advertiser_external ||
          typeof label !== "string" ||
          label.length > 200
        )
          throw Error("Unsupported or foreign breakdown row");
      }
      // Validate the entire file before persisting any row. No breakdown values are added to aggregate totals.
      for (const item of rows)
        await db().query(
          `INSERT INTO vibe_channel_reports(campaign_id,dimension,label,metrics,synced_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(campaign_id,dimension,label) DO UPDATE SET metrics=EXCLUDED.metrics,synced_at=now()`,
          [
            id,
            row.breakdown_dimension,
            item[row.breakdown_dimension],
            JSON.stringify(item),
          ],
        );
      await db().query(
        "UPDATE vibe_campaigns SET breakdown_report_id=NULL,breakdown_dimension=CASE breakdown_dimension WHEN 'channel_name' THEN 'geo_region' ELSE 'channel_name' END WHERE campaign_id=$1",
        [id],
      );
      return { breakdownSynced: true };
    }
    if (!row.report_id) {
      const report = await this.client.createReport({
        start_date: row.created_at.toISOString().slice(0, 10),
        end_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        timezone: "UTC",
        advertiser_ids: [row.advertiser_external],
        dimensions: ["campaign_id", "advertiser_id"],
        metrics: [
          "spend",
          "impressions",
          "completed_views",
          "view_through_rate",
          "cpm",
          "households",
          "frequency",
        ],
        filters: [{ dimension: "campaign_id", values: [row.external_id] }],
        format: "JSON",
      });
      if (typeof report.id !== "string")
        throw Error("Provider report identifier unavailable");
      await db().query(
        "UPDATE vibe_campaigns SET report_id=$2,report_requested_at=now() WHERE campaign_id=$1",
        [id, report.id],
      );
      return { pending: true };
    }
    const report = await this.client.report(row.report_id);
    if (report.status === "FAILED") {
      await db().query(
        "UPDATE vibe_campaigns SET report_id=NULL WHERE campaign_id=$1",
        [id],
      );
      throw Error("Provider reporting failed");
    }
    if (report.status !== "READY") return { pending: true };
    const metrics = verifiedSummary(
      await this.client.reportRows(report.download_url),
      row.external_id,
      row.advertiser_external,
    );
    await db().query(
      `INSERT INTO vibe_campaign_metrics(campaign_id,spend_microusd,impressions,completed_views,households,view_through_rate,cpm,frequency,last_synced_at,raw_summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) ON CONFLICT(campaign_id) DO UPDATE SET spend_microusd=EXCLUDED.spend_microusd,impressions=EXCLUDED.impressions,completed_views=EXCLUDED.completed_views,households=EXCLUDED.households,view_through_rate=EXCLUDED.view_through_rate,cpm=EXCLUDED.cpm,frequency=EXCLUDED.frequency,last_synced_at=now(),raw_summary=EXCLUDED.raw_summary`,
      [
        id,
        metrics.spend?.toString() ?? null,
        metrics.impressions,
        metrics.views,
        metrics.households,
        metrics.vtr,
        metrics.cpm,
        metrics.frequency,
        JSON.stringify(metrics.raw),
      ],
    );
    await db().query(
      "UPDATE campaign_settlements SET vibe_spend_microusd=$2,updated_at=now() WHERE campaign_id=$1",
      [id, metrics.spend?.toString() ?? null],
    );
    if (metrics.spend !== null && metrics.spend >= 45000000n)
      await alert(
        "spend:" + id,
        id,
        "MEDIA_LIMIT",
        metrics.spend > 50000000n
          ? "Provider reports spend exceeding $50. Reconciliation required."
          : "Campaign approaching or reaching its $50 lifetime allocation.",
        "WARNING",
      );
    if (metrics.spend !== null && metrics.spend >= 50000000n) {
      await this.client.action(row.strategy_id, "PAUSE");
      await transaction(async (c) => {
        const order = (
          await c.query(
            "SELECT status FROM ad_campaigns WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (
          ["ACTIVATING", "UPCOMING", "DELIVERING", "PAUSED"].includes(
            order.status,
          )
        )
          await transition(
            c,
            id,
            order.status,
            "COMPLETED",
            "SYSTEM",
            "Verified provider spend reached the $50 lifetime cap; strategy paused",
          );
      });
      await db().query(
        "UPDATE vibe_strategies SET active=false,last_synced_at=now() WHERE campaign_id=$1",
        [id],
      );
    }
    const breakdown = await this.client.createReport({
      start_date: row.created_at.toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      timezone: "UTC",
      advertiser_ids: [row.advertiser_external],
      dimensions: ["campaign_id", "advertiser_id", row.breakdown_dimension],
      metrics: ["spend", "impressions", "completed_views"],
      filters: [{ dimension: "campaign_id", values: [row.external_id] }],
      format: "JSON",
    });
    await db().query(
      "UPDATE vibe_campaigns SET report_id=NULL,breakdown_report_id=$2 WHERE campaign_id=$1",
      [id, breakdown.id],
    );
    return { synced: true };
  }
}
