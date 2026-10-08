import type { Dashboard, Campaign, Settings } from "@/lib/types";
import { db, type Queryable } from "./db";
import { settings, demoEnabled, envSettings } from "./config";
import { availableFunds } from "@/lib/accounting";
export async function campaigns() {
  const { rows } = await db().query(
    `SELECT c.*,coalesce((SELECT sum(e.amount_lamports) FROM campaign_expenses e WHERE e.campaign_id=c.id),0)::text spent_lamports,c.target_usd_cents::text,c.committed_lamports::text FROM campaigns c ORDER BY c.created_at`,
  );
  return rows as Campaign[];
}
export async function campaign(slug: string) {
  const rows = await campaigns(),
    c = rows.find((row) => row.slug === slug);
  if (!c) return null;
  const [proofs, expenses] = await Promise.all([
    db().query(
      "SELECT * FROM campaign_proof WHERE campaign_id=$1 ORDER BY created_at",
      [c.id],
    ),
    db().query(
      "SELECT e.*,e.amount_lamports::text,e.usd_cents::text,t.signature FROM campaign_expenses e LEFT JOIN treasury_transactions t ON t.id=e.treasury_transaction_id WHERE e.campaign_id=$1 ORDER BY e.created_at",
      [c.id],
    ),
  ]);
  return { ...c, proofs: proofs.rows, expenses: expenses.rows } as Campaign;
}
export async function ledger(page = 1) {
  const { rows } = await db().query(
    "SELECT id,signature,kind,amount_lamports::text,usd_cents::text,direction,status,classification_source,recorded_at,block_time,note FROM treasury_transactions ORDER BY block_time DESC LIMIT 20 OFFSET $1",
    [(page - 1) * 20],
  );
  const { rows: count } = await db().query(
    "SELECT count(*)::int total FROM treasury_transactions",
  );
  return { rows, total: count[0].total, page };
}
export async function funding(s: Settings, c: Queryable = db()) {
  const { rows } = await c.query(
    `SELECT
 (SELECT coalesce(sum(amount_lamports),0)::text FROM treasury_transactions WHERE direction='IN' AND status='VERIFIED' AND kind<>'INTERNAL_TRANSFER') inflows,
 (SELECT coalesce(sum(advertising_lamports),0)::text FROM treasury_transactions WHERE kind='CREATOR_FEE_COLLECTION' AND status='VERIFIED') allocation,
 (SELECT coalesce(sum(amount_lamports),0)::text FROM creator_fee_events WHERE kind='ACCRUAL' AND mint=$1 AND verification_status='VERIFIED') accrued,
 (SELECT coalesce(sum(amount_lamports),0)::text FROM creator_fee_events WHERE kind='COLLECTION' AND verification_status='VERIFIED') claimed,
 (SELECT coalesce(sum(advertising_lamports),0)::text FROM treasury_transactions WHERE kind='FOUNDER_SEED' AND status='VERIFIED') seed,
 ((SELECT coalesce(sum(amount_lamports),0) FROM campaign_expenses)-(SELECT coalesce(sum(advertising_lamports),0) FROM treasury_transactions WHERE kind='REFUND' AND status='VERIFIED'))::text spent,
 (SELECT coalesce(sum(greatest(c.committed_lamports-coalesce((SELECT sum(amount_lamports) FROM campaign_expenses WHERE campaign_id=c.id),0),0)),0)::text FROM campaigns c WHERE c.status NOT IN ('COMPLETED','REJECTED')) committed,
 (SELECT count(*)::int FROM campaigns WHERE status='COMPLETED') completed,
 (SELECT balance_lamports::text FROM wallet_snapshots WHERE wallet=$2 ORDER BY synchronized_at DESC LIMIT 1) balance`,
    [s.mint, s.treasury],
  );
  const v = rows[0];
  return {
    ...v,
    available: availableFunds(
      BigInt(v.allocation),
      BigInt(v.seed),
      BigInt(v.spent),
      BigInt(v.committed),
      BigInt(v.balance ?? "0"),
    ).toString(),
  };
}
export async function currentPrice(c: Queryable = db()) {
  const { rows } = await c.query(
    "SELECT price_usd_micros::text micros,source,fetched_at at FROM sol_price_snapshots WHERE fetched_at>now()-interval '5 minutes' ORDER BY fetched_at DESC LIMIT 1",
  );
  return rows[0] || null;
}
export function emptyDashboard(
  s = envSettings(),
  notice:
    | string
    | null = "Tracking begins at launch. Configure the coin and treasury to begin.",
): Dashboard {
  return {
    settings: s,
    campaigns: [],
    activity: [],
    price: null,
    balance: null,
    inflows: "0",
    available: "0",
    allocation: "0",
    accrued: "0",
    claimed: "0",
    seed: "0",
    committed: "0",
    spent: "0",
    completed: 0,
    syncAt: null,
    syncError: null,
    notice,
    demo: false,
  };
}
export async function dashboard(): Promise<Dashboard> {
  if (demoEnabled()) return demoDashboard();
  if (!process.env.DATABASE_URL) return emptyDashboard();
  try {
    const s = await settings();
    const [f, c, a, p, sync] = await Promise.all([
      funding(s),
      campaigns(),
      ledger(),
      currentPrice(),
      db().query("SELECT * FROM sync_state WHERE id=true"),
    ]);
    const state = sync.rows[0];
    const fresh =
      state?.last_success_at &&
      Date.now() - new Date(state.last_success_at).getTime() < 180000;
    return {
      ...emptyDashboard(s, null),
      ...f,
      settings: s,
      campaigns: c,
      activity: a.rows,
      price: p,
      syncAt: state?.last_success_at ?? null,
      syncError: state?.error ? "Synchronization needs attention." : null,
      notice: s.maintenance
        ? "Maintenance mode. Public funding status is paused."
        : s.paused
          ? "Public status updates are paused."
          : !s.mint || !s.treasury
            ? "Tracking begins at launch."
            : state?.error
              ? "Treasury synchronization needs attention. Last verified data is shown."
              : state?.alert
                ? "Treasury history is being reconciled. Totals include indexed verified records."
                : !fresh
                  ? "Treasury synchronization delayed. Last verified data is shown."
                  : null,
    };
  } catch {
    return emptyDashboard(
      envSettings(),
      "Treasury connection unavailable. Tracking data cannot be loaded.",
    );
  }
}
function demoDashboard(): Dashboard {
  const c: Campaign = {
    id: "demo",
    slug: "streaming-tv-test",
    title: "Streaming TV Test Campaign",
    description:
      "A short commercial planned for a streaming-TV audience. Demo planning record; no platform approval is claimed.",
    target_usd_cents: "50000",
    committed_lamports: "0",
    spent_lamports: "0",
    status: "PLANNING",
    approval_status: "NOT SUBMITTED",
    platform: "To be selected",
    format: "Streaming TV · 15 seconds",
    video_url: null,
    approval_proof_url: null,
    planned_start: null,
    planned_end: null,
    actual_start: null,
    actual_end: null,
    results: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return {
    ...emptyDashboard(
      { ...envSettings(), treasury: "" },
      "DEMO DATA — NOT LIVE",
    ),
    demo: true,
    campaigns: [c],
    balance: "2840000000",
    available: "2840000000",
    seed: "2840000000",
    inflows: "2840000000",
    price: {
      micros: "115285211",
      source: "Demo illustration",
      at: "2026-01-01T00:00:00Z",
    },
  };
}
