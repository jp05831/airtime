import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/http";
import { db } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await rateLimit("public:health", 120);
    const { rows } = await db().query(
      "SELECT last_success_at,last_webhook_at,error,last_success_at>now()-interval '10 minutes' fresh FROM sync_state WHERE id=true",
    );
    const vibe = (
      await db().query(
        "SELECT completed_at,status FROM vibe_reconciliation_runs ORDER BY started_at DESC LIMIT 1",
      )
    ).rows[0];
    const vibeEnabled = process.env.VIBE_LIVE_MODE === "true";
    const vibeFresh =
      !vibeEnabled ||
      (vibe?.status === "COMPLETED" &&
        new Date(vibe.completed_at).getTime() > Date.now() - 10 * 60000);
    const healthy = rows[0]?.fresh && !rows[0].error && vibeFresh;
    return NextResponse.json(
      {
        status: healthy ? "ok" : "degraded",
        database: "ok",
        vibe: !vibeEnabled
          ? "disabled"
          : vibeFresh
            ? "fresh"
            : "stale_or_failed",
        sync: healthy ? "fresh" : "stale_or_failed",
        lastSync: rows[0]?.last_success_at ?? null,
        lastWebhook: rows[0]?.last_webhook_at ?? null,
      },
      { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "unavailable" },
      { status: 503 },
    );
  }
}
