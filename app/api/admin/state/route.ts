import { adminHandler } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { z } from "zod";
import { dashboard, ledger } from "@/lib/server/queries";
export const GET = adminHandler(async (r) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(r.nextUrl.searchParams.get("page") || 1);
  const [data, sync, alerts, pending, expenses, review, failures] =
    await Promise.all([
      dashboard(),
      db().query("SELECT * FROM sync_state"),
      db().query("SELECT * FROM alerts ORDER BY created_at DESC LIMIT 20"),
      db().query(
        "SELECT id,signature,kind,amount_lamports::text,venue FROM creator_fee_events WHERE kind='COLLECTION' AND verification_status='VERIFIED' ORDER BY created_at DESC LIMIT 50",
      ),
      db().query(
        "SELECT id,campaign_id,amount_lamports::text FROM campaign_expenses ORDER BY created_at DESC LIMIT 50",
      ),
      ledger(page),
      db().query(
        "SELECT signature,status,attempts,error FROM webhook_events WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 30",
      ),
    ]);
  return {
    data: { ...data, activity: review.rows },
    ledgerPage: page,
    ledgerTotal: review.total,
    sync: sync.rows[0],
    alerts: alerts.rows,
    collections: pending.rows,
    expenses: expenses.rows,
    failures: failures.rows,
  };
}, false);
