import { db, transaction, type Queryable } from "./db";
import { settings } from "./config";
import { funding, currentPrice } from "./queries";
import { HttpError } from "./http";
import { usdCents, allocation } from "@/lib/accounting";
import { externalUrl } from "@/lib/validation";
export async function audit(
  admin: string,
  action: string,
  entity: string,
  details: unknown,
  c: Queryable = db(),
) {
  await c.query(
    "INSERT INTO audit_logs(admin_id,action,entity_id,details) VALUES($1,$2,$3,$4)",
    [admin, action, entity, JSON.stringify(details)],
  );
}
export async function commitCampaign(
  id: string,
  amount: bigint,
  admin: string,
  key: string,
) {
  if (amount <= 0n) throw new HttpError(400, "Commit a positive amount");
  const s = await settings();
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(836244002)");
    const existing = await c.query(
      "SELECT campaign_id,amount_lamports FROM fund_commitments WHERE idempotency_key=$1",
      [key],
    );
    if (existing.rows[0]) {
      if (
        existing.rows[0].campaign_id !== id ||
        BigInt(existing.rows[0].amount_lamports) !== amount
      )
        throw new HttpError(
          409,
          "Idempotency key belongs to a different commitment",
        );
      return { duplicate: true };
    }
    const { rows } = await c.query(
      "SELECT * FROM campaigns WHERE id=$1 FOR UPDATE",
      [id],
    );
    const campaign = rows[0];
    if (
      !campaign ||
      campaign.approval_status !== "APPROVED" ||
      ["COMPLETED", "REJECTED"].includes(campaign.status)
    )
      throw new HttpError(409, "Campaign needs documented platform approval");
    const f = await funding(s, c);
    if (amount > BigInt(f.available))
      throw new HttpError(409, "Insufficient uncommitted advertising funds");
    const price = await currentPrice(c);
    const funded =
      price &&
      usdCents(
        BigInt(campaign.committed_lamports) + amount,
        BigInt(price.micros),
      ) >= BigInt(campaign.target_usd_cents);
    await c.query(
      "UPDATE campaigns SET committed_lamports=committed_lamports+$2,status=CASE WHEN $3 THEN 'FUNDED' ELSE status END WHERE id=$1",
      [id, amount.toString(), !!funded],
    );
    await c.query(
      "INSERT INTO fund_commitments(campaign_id,amount_lamports,idempotency_key) VALUES($1,$2,$3)",
      [id, amount.toString(), key],
    );
    await audit(
      admin,
      "COMMIT_FUNDS",
      id,
      { amountLamports: amount.toString() },
      c,
    );
    return { committed: true };
  });
}
export async function recordExpense(
  input: {
    campaignId: string;
    amount: string;
    transactionId?: string | null;
    note: string;
    idempotencyKey: string;
  },
  admin: string,
) {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(836244002)");
    const { rows: existing } = await c.query(
      "SELECT campaign_id,amount_lamports FROM campaign_expenses WHERE idempotency_key=$1",
      [input.idempotencyKey],
    );
    if (existing[0]) {
      if (
        existing[0].campaign_id !== input.campaignId ||
        BigInt(existing[0].amount_lamports) !== BigInt(input.amount)
      )
        throw new HttpError(
          409,
          "Idempotency key belongs to a different expense",
        );
      return { duplicate: true };
    }
    const price = await currentPrice(c);
    await c.query(
      `INSERT INTO campaign_expenses(campaign_id,amount_lamports,usd_cents,price_snapshot_id,treasury_transaction_id,idempotency_key,note) VALUES($1,$2,$3,(SELECT id FROM sol_price_snapshots WHERE fetched_at>now()-interval '5 minutes' ORDER BY fetched_at DESC LIMIT 1),$4,$5,$6)`,
      [
        input.campaignId,
        input.amount,
        price
          ? usdCents(BigInt(input.amount), BigInt(price.micros)).toString()
          : null,
        input.transactionId || null,
        input.idempotencyKey,
        input.note,
      ],
    );
    await audit(
      admin,
      "RECORD_EXPENSE",
      input.campaignId,
      { amountLamports: input.amount, chainLinked: !!input.transactionId },
      c,
    );
    return { recorded: true };
  });
}
export async function transition(id: string, status: string, admin: string) {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(836244002)");
    const { rows } = await c.query(
      "SELECT * FROM campaigns WHERE id=$1 FOR UPDATE",
      [id],
    );
    const campaign = rows[0];
    if (!campaign) throw new HttpError(404, "Campaign not found");
    if (campaign.status === "COMPLETED")
      throw new HttpError(409, "Completed records cannot be reopened");
    if (
      ["APPROVED", "FUNDED", "SCHEDULED", "LIVE", "COMPLETED"].includes(
        status,
      ) &&
      campaign.approval_status !== "APPROVED"
    )
      throw new HttpError(409, "Record platform approval first");
    if (status === "FUNDED")
      throw new HttpError(400, "Use the commit-funds action");
    if (status === "SCHEDULED" && !campaign.planned_start)
      throw new HttpError(409, "Set a planned start date first");
    if (
      ["SCHEDULED", "LIVE", "COMPLETED"].includes(status) &&
      BigInt(campaign.committed_lamports) <= 0n
    )
      throw new HttpError(409, "Commit funds before launching");
    if (status === "COMPLETED") {
      const { rows: proof } = await c.query(
        "SELECT id FROM campaign_proof WHERE campaign_id=$1",
        [id],
      );
      const { rows: spent } = await c.query(
        "SELECT coalesce(sum(amount_lamports),0)::text amount FROM campaign_expenses WHERE campaign_id=$1",
        [id],
      );
      if (!proof.length || BigInt(spent[0].amount) <= 0n)
        throw new HttpError(
          409,
          "Completion needs actual spend and published campaign proof",
        );
    }
    await c.query(
      `UPDATE campaigns SET status=$2,actual_start=CASE WHEN $2='LIVE' THEN coalesce(actual_start,now()) ELSE actual_start END,actual_end=CASE WHEN $2='COMPLETED' THEN now() ELSE actual_end END WHERE id=$1`,
      [id, status],
    );
    await audit(
      admin,
      "CAMPAIGN_STATUS",
      id,
      { from: campaign.status, to: status },
      c,
    );
    return { updated: true };
  });
}
export async function classify(
  input: {
    id: string;
    kind: string;
    note: string;
    collectionId?: string | null;
    refundExpenseId?: string | null;
  },
  admin: string,
) {
  const s = await settings();
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(836244002)");
    const { rows } = await c.query(
      "SELECT * FROM treasury_transactions WHERE id=$1 FOR UPDATE",
      [input.id],
    );
    const tx = rows[0];
    if (!tx || tx.status === "REJECTED")
      throw new HttpError(404, "Verified chain transaction not found");
    if (tx.advertising_lamports > 0)
      throw new HttpError(
        409,
        "Funding classifications are immutable; use an audited correction",
      );
    let advertising = 0n;
    if (input.kind === "FOUNDER_SEED") {
      if (tx.direction !== "IN" || tx.source_wallet !== s.creator)
        throw new HttpError(
          409,
          "Founder seed requires a proven direct creator-wallet transfer",
        );
      const { rows: claim } = await c.query(
        "SELECT id FROM creator_fee_events WHERE signature=$1 AND kind='COLLECTION'",
        [tx.signature],
      );
      if (claim.length)
        throw new HttpError(
          409,
          "Creator-fee collections cannot be relabeled as founder seed",
        );
      advertising = BigInt(tx.amount_lamports);
    }
    if (input.kind === "CREATOR_FEE_COLLECTION") {
      if (tx.direction !== "IN" || !input.collectionId)
        throw new HttpError(409, "Select exact verified collection evidence");
      const { rows: claims } = await c.query(
        "SELECT * FROM creator_fee_events WHERE id=$1 AND kind='COLLECTION' AND verification_status='VERIFIED' FOR UPDATE",
        [input.collectionId],
      );
      const claim = claims[0];
      if (
        !claim ||
        claim.creator_wallet !== s.creator ||
        BigInt(tx.amount_lamports) > BigInt(claim.amount_lamports) ||
        new Date(claim.block_time) > new Date(tx.block_time) ||
        (tx.source_wallet !== s.creator && tx.signature !== claim.signature)
      )
        throw new HttpError(
          409,
          "Collection evidence does not cover this deposit",
        );
      const f = await funding(s, c);
      const { rows: allocated } = await c.query(
        "SELECT coalesce(sum(amount_lamports),0)::text total FROM treasury_transactions WHERE kind='CREATOR_FEE_COLLECTION' AND status='VERIFIED'",
      );
      if (
        BigInt(allocated[0].total) + BigInt(tx.amount_lamports) >
        BigInt(f.accrued)
      )
        throw new HttpError(
          409,
          "Deposit exceeds indexed verified token-fee accrual; reconcile missing history first",
        );
      advertising = allocation(BigInt(tx.amount_lamports), s.allocationBps);
    }
    if (input.kind === "REFUND") {
      if (tx.direction !== "IN" || !input.refundExpenseId)
        throw new HttpError(409, "Refund requires an original expense");
      const { rows: expense } = await c.query(
        "SELECT * FROM campaign_expenses WHERE id=$1 FOR UPDATE",
        [input.refundExpenseId],
      );
      if (
        !expense[0] ||
        BigInt(tx.amount_lamports) > BigInt(expense[0].amount_lamports)
      )
        throw new HttpError(409, "Refund exceeds original spend");
      const { rows: refunded } = await c.query(
        "SELECT coalesce(sum(amount_lamports),0)::text total FROM treasury_transactions WHERE refund_expense_id=$1 AND kind='REFUND' AND status='VERIFIED'",
        [input.refundExpenseId],
      );
      if (
        BigInt(refunded[0].total) + BigInt(tx.amount_lamports) >
        BigInt(expense[0].amount_lamports)
      )
        throw new HttpError(409, "Expense already refunded");
      advertising = BigInt(tx.amount_lamports);
    }
    if (input.kind === "CAMPAIGN_EXPENDITURE" && tx.direction !== "OUT")
      throw new HttpError(409, "Expenditure must be an outflow");
    await c.query(
      "UPDATE treasury_transactions SET kind=$2,status='VERIFIED',classification_source='ADMIN_REVIEW',note=$3,advertising_lamports=$4,fee_collection_id=$5,refund_expense_id=$6,advertising_bps=$7 WHERE id=$1",
      [
        input.id,
        input.kind,
        input.note,
        advertising.toString(),
        input.collectionId || null,
        input.refundExpenseId || null,
        input.kind === "CREATOR_FEE_COLLECTION" ? s.allocationBps : null,
      ],
    );
    await audit(
      admin,
      "CLASSIFY_TRANSFER",
      input.id,
      {
        kind: input.kind,
        note: input.note,
        advertisingBps:
          input.kind === "CREATOR_FEE_COLLECTION" ? s.allocationBps : null,
        advertisingLamports: advertising.toString(),
        collectionId: input.collectionId || null,
        refundExpenseId: input.refundExpenseId || null,
      },
      c,
    );
    return { classified: true };
  });
}
export function safeProof(value: string) {
  return externalUrl(value);
}
