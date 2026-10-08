export type Settings = {
  mint: string;
  creator: string;
  treasury: string;
  pumpUrl: string;
  axiomUrl: string;
  allocationBps: number;
  paused: boolean;
  maintenance: boolean;
};
export const statuses = [
  "PLANNING",
  "CREATIVE IN PROGRESS",
  "SUBMITTED FOR REVIEW",
  "APPROVED",
  "FUNDED",
  "SCHEDULED",
  "LIVE",
  "COMPLETED",
  "REJECTED",
] as const;
export type Campaign = {
  id: string;
  slug: string;
  title: string;
  description: string;
  target_usd_cents: string;
  committed_lamports: string;
  status: string;
  approval_status: string;
  platform: string;
  format: string;
  video_url: string | null;
  approval_proof_url: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  results: string;
  created_at: string;
  updated_at: string;
  spent_lamports: string;
  proofs?: Proof[];
  expenses?: Expense[];
};
export type Proof = {
  id: string;
  campaign_id: string;
  kind: string;
  url: string | null;
  object_path: string | null;
  mime_type: string | null;
  title: string;
  created_at: string;
};
export type Expense = {
  id: string;
  campaign_id: string;
  amount_lamports: string;
  usd_cents: string | null;
  treasury_transaction_id: string | null;
  note: string;
  created_at: string;
  signature?: string | null;
};
export type LedgerRow = {
  id: string;
  signature: string;
  kind: string;
  amount_lamports: string;
  usd_cents: string | null;
  direction: string;
  status: string;
  classification_source: string;
  recorded_at: string;
  block_time: string;
  note: string;
};
export type Dashboard = {
  settings: Settings;
  campaigns: Campaign[];
  activity: LedgerRow[];
  price: { micros: string; source: string; at: string } | null;
  balance: string | null;
  inflows: string;
  available: string;
  allocation: string;
  accrued: string;
  claimed: string;
  seed: string;
  committed: string;
  spent: string;
  completed: number;
  syncAt: string | null;
  syncError: string | null;
  notice: string | null;
  demo: boolean;
};
