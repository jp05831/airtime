import { Connection, PublicKey } from "@solana/web3.js";
import { db, transaction } from "./db";
import { settings, required } from "./config";
import { allocation, usdCents } from "@/lib/accounting";
import {
  verifiedFees,
  treasuryChange,
  poolState,
  canonicalPool,
  PUMP_AMM,
  PUMP,
} from "./protocol";
import { refreshPrice } from "./price";
import { redact } from "./http";
import { funding } from "./queries";
export const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export function connection() {
  return new Connection(required("SOLANA_RPC_URL"), {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: async (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
  });
}
export async function queue(signature: string, payload: unknown) {
  const result = await db().query(
    "INSERT INTO webhook_events(signature,payload) VALUES($1,$2) ON CONFLICT(signature) DO NOTHING",
    [signature, JSON.stringify(payload)],
  );
  return !!result.rowCount;
}
export async function processSignature(
  signature: string,
  conn: Connection = connection(),
) {
  const s = await settings();
  if (s.paused || s.maintenance) throw Error("Tracking is paused");
  if ((await conn.getGenesisHash()) !== GENESIS)
    throw Error("RPC must be mainnet");
  const state = (
    await conn.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (state?.confirmationStatus !== "finalized")
    throw Error("Waiting for finality");
  const tx = await conn.getTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.transaction.signatures[0] !== signature)
    throw Error("Finalized transaction unavailable");
  const pools = new Map<
    string,
    {
      mint: string;
      quote: string;
      creator: string;
      canonical: boolean;
      holder: boolean;
      cashback: boolean;
    }
  >();
  const feeRecords = await verifiedFees(tx, s, async (key) => {
    if (pools.has(key)) return pools.get(key)!;
    const account = await conn.getAccountInfo(new PublicKey(key), "finalized");
    if (!account || account.owner.toBase58() !== PUMP_AMM)
      throw Error("Unsupported pool owner");
    const p = poolState(account.data);
    const resolved = {
      mint: p.base_mint,
      quote: p.quote_mint,
      creator: p.coin_creator,
      canonical:
        p.index === 0n && canonicalPool(p.base_mint, p.quote_mint) === key,
      holder: p.is_holder_reward,
      cashback: p.is_cashback_coin,
    };
    pools.set(key, resolved);
    return resolved;
  });
  const change = treasuryChange(tx, s.treasury, s.creator);
  const price = await refreshPrice();
  return transaction(async (c) => {
    const { rows } = await c.query(
      "SELECT status FROM webhook_events WHERE signature=$1 FOR UPDATE",
      [signature],
    );
    if (
      !rows[0] ||
      ["VERIFIED", "UNCLASSIFIED", "REJECTED", "CONFIRMED"].includes(
        rows[0].status,
      )
    )
      return { duplicate: true };
    for (const e of feeRecords)
      await c.query(
        `INSERT INTO creator_fee_events(signature,event_index,kind,mint,creator_wallet,amount_lamports,allocation_bps,allocation_lamports,venue,evidence,verification_status,block_time,price_snapshot_id,usd_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'VERIFIED',$11,$12,$13) ON CONFLICT(signature,event_index) DO NOTHING`,
        [
          signature,
          e.index,
          e.kind,
          e.mint,
          e.creator,
          e.amount.toString(),
          s.allocationBps,
          allocation(e.amount, s.allocationBps).toString(),
          e.venue,
          JSON.stringify(e.evidence),
          new Date(tx.blockTime! * 1000),
          price?.id ?? null,
          price
            ? usdCents(e.amount, BigInt(price.price_usd_micros)).toString()
            : null,
        ],
      );
    if (change)
      await c.query(
        `INSERT INTO treasury_transactions(signature,wallet,amount_lamports,direction,source_wallet,price_snapshot_id,usd_cents,status,classification_source,block_time) VALUES($1,$2,$3,$4,$5,$6,$7,'UNCLASSIFIED','RPC_FINALIZED',$8) ON CONFLICT(signature) DO NOTHING`,
        [
          signature,
          s.treasury,
          change.amount.toString(),
          change.direction,
          change.source,
          price?.id ?? null,
          price
            ? usdCents(change.amount, BigInt(price.price_usd_micros)).toString()
            : null,
          new Date(tx.blockTime! * 1000),
        ],
      );
    const status = tx.meta?.err
      ? "REJECTED"
      : change
        ? "UNCLASSIFIED"
        : feeRecords.length
          ? "VERIFIED"
          : "UNCLASSIFIED";
    await c.query(
      "UPDATE webhook_events SET status=$2,rpc_payload=$3,error=NULL WHERE signature=$1",
      [signature, status, JSON.stringify(tx)],
    );
    return { status };
  });
}
export async function runSync(conn: Connection = connection()) {
  const deadline = Date.now() + 240000;
  const lock = await db().connect();
  try {
    const acquired = await lock.query(
      "SELECT pg_try_advisory_lock(836244001) acquired",
    );
    if (!acquired.rows[0]?.acquired) return { busy: true };
    const s = await settings();
    if (s.paused || s.maintenance) return { paused: true };
    await lock.query(
      "UPDATE sync_state SET last_started_at=now() WHERE id=true",
    );
    if ((await conn.getGenesisHash()) !== GENESIS)
      throw Error("RPC must be mainnet");
    const { rows: states } = await lock.query(
      "SELECT cursors FROM sync_state WHERE id=true",
    );
    const cursors = states[0].cursors || {};
    const curve = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), new PublicKey(s.mint).toBuffer()],
      new PublicKey(PUMP),
    )[0].toBase58();
    const watch = [
      s.treasury,
      s.creator,
      s.mint,
      curve,
      canonicalPool(s.mint, "So11111111111111111111111111111111111111112"),
    ].filter(Boolean);
    let backlog = false;
    for (const wallet of watch) {
      const cursor =
        typeof cursors[wallet] === "string"
          ? { head: cursors[wallet] }
          : cursors[wallet] || {};
      const batch = await conn.getSignaturesForAddress(
        new PublicKey(wallet),
        {
          limit: 100,
          ...(cursor.head ? { until: cursor.head } : {}),
          ...(cursor.before ? { before: cursor.before } : {}),
        },
        "finalized",
      );
      const pendingHead = cursor.pendingHead || batch[0]?.signature;
      for (const entry of [...batch].reverse())
        await queue(entry.signature, { source: "RPC_RECONCILIATION", wallet });
      if (batch.length === 100) {
        backlog = true;
        cursors[wallet] = {
          ...cursor,
          pendingHead,
          before: batch.at(-1)?.signature,
        };
        await lock.query(
          `INSERT INTO alerts(kind,entity_id,message) VALUES('BACKLOG',$1,'RPC history page full; monitor Helius coverage and run documented historical backfill') ON CONFLICT(kind,entity_id) DO NOTHING`,
          [wallet],
        );
      } else if (pendingHead) cursors[wallet] = { head: pendingHead };
    }
    const { rows: pending } = await lock.query(
      "SELECT signature FROM webhook_events WHERE status IN ('DETECTED','VERIFYING','FAILED') AND attempts<12 ORDER BY created_at LIMIT 15",
    );
    let errors = 0,
      processed = 0;
    for (const row of pending) {
      if (Date.now() > deadline - 60000) break;
      processed++;
      try {
        await lock.query(
          "UPDATE webhook_events SET status='VERIFYING' WHERE signature=$1",
          [row.signature],
        );
        await processSignature(row.signature, conn);
      } catch (error) {
        errors++;
        await lock.query(
          "UPDATE webhook_events SET status='FAILED',attempts=attempts+1,error=$2 WHERE signature=$1",
          [row.signature, redact(error)],
        );
      }
    }
    const snapshot = await conn.getBalanceAndContext(
      new PublicKey(s.treasury),
      "finalized",
    );
    if (!Number.isSafeInteger(snapshot.value))
      throw Error("Unsafe treasury balance");
    await lock.query(
      "INSERT INTO wallet_snapshots(wallet,balance_lamports,slot,commitment) VALUES($1,$2,$3,'finalized') ON CONFLICT(wallet,slot) DO NOTHING",
      [s.treasury, String(snapshot.value), snapshot.context.slot],
    );
    await refreshPrice();
    const f = await funding(s);
    const outstanding = await lock.query(
      "SELECT count(*)::int count FROM webhook_events WHERE status='FAILED' AND attempts>=12",
    );
    const remaining = await lock.query(
      "SELECT count(*)::int count FROM webhook_events WHERE status IN ('DETECTED','VERIFYING','FAILED') AND attempts<12",
    );
    backlog = backlog || remaining.rows[0].count > 0;
    if (outstanding.rows[0].count)
      await lock.query(
        "INSERT INTO alerts(kind,entity_id,message) VALUES('RETRY_EXHAUSTED','indexer','Some signatures exhausted automatic retries; review and reconcile') ON CONFLICT(kind,entity_id) DO NOTHING",
      );
    const { rows: price } = await lock.query(
      "SELECT price_usd_micros FROM sol_price_snapshots WHERE fetched_at>now()-interval '5 minutes' ORDER BY fetched_at DESC LIMIT 1",
    );
    if (price[0]) {
      const { rows: campaigns } = await lock.query(
        "SELECT c.id,c.target_usd_cents,greatest(c.committed_lamports-coalesce((SELECT sum(amount_lamports) FROM campaign_expenses e WHERE e.campaign_id=c.id),0),0)::text own_commitment FROM campaigns c WHERE c.status NOT IN ('COMPLETED','REJECTED','SCHEDULED','LIVE')",
      );
      for (const campaign of campaigns)
        if (
          usdCents(
            BigInt(f.available) + BigInt(campaign.own_commitment),
            BigInt(price[0].price_usd_micros),
          ) >= BigInt(campaign.target_usd_cents)
        )
          await lock.query(
            "INSERT INTO alerts(kind,entity_id,message) VALUES('CAMPAIGN_FUNDED',$1,'Campaign target reached; review funding and documented platform approval') ON CONFLICT(kind,entity_id) DO NOTHING",
            [campaign.id],
          );
    }
    await lock.query(
      "UPDATE sync_state SET last_success_at=now(),error=$1,cursors=$2,alert=$3 WHERE id=true",
      [
        errors || outstanding.rows[0].count
          ? `${errors + outstanding.rows[0].count} transactions need retry/review`
          : null,
        JSON.stringify(cursors),
        backlog ? "History backlog requires backfill" : null,
      ],
    );
    return { processed, errors, backlog };
  } catch (error) {
    await lock.query("UPDATE sync_state SET error=$1 WHERE id=true", [
      redact(error),
    ]);
    await lock.query(
      "INSERT INTO alerts(kind,entity_id,message) VALUES('SYNC_FAILURE','worker',$1) ON CONFLICT(kind,entity_id) DO UPDATE SET message=EXCLUDED.message,created_at=now()",
      [redact(error)],
    );
    throw error;
  } finally {
    await lock.query("SELECT pg_advisory_unlock(836244001)");
    lock.release();
  }
}
