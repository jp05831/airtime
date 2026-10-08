import { PublicKey, type Connection } from "@solana/web3.js";
import { connection, queue, GENESIS } from "@/lib/server/chain";
import { db, transaction } from "@/lib/server/db";
import { redact } from "@/lib/server/http";
import { refreshPrice } from "@/lib/server/price";
import { transition } from "./campaigns";
import { platformConfig } from "./config";
import { confirmPayment, confirmClaim, MEMO } from "./payments";
export async function processPlatformSignature(
  signature: string,
  conn: Connection = connection(),
) {
  const state = (
    await conn.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (state?.confirmationStatus !== "finalized")
    throw Error("Awaiting finalized confirmation");
  const tx = await conn.getTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.transaction.signatures[0] !== signature)
    throw Error("Finalized transaction unavailable");
  if (tx.meta?.err) {
    await db().query(
      "UPDATE webhook_events SET status='REJECTED',error='Transaction failed on-chain' WHERE signature=$1",
      [signature],
    );
    return;
  }
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses,
  });
  let invoiceId: string | null = null;
  for (const ix of tx.transaction.message.compiledInstructions)
    if (keys.get(ix.programIdIndex)?.equals(MEMO)) {
      const memo = Buffer.from(ix.data).toString();
      if (/^AIRTIME:[0-9a-f-]{36}$/.test(memo)) invoiceId = memo.slice(8);
    }
  if (invoiceId) {
    const invoice = (
      await db().query(
        "SELECT id FROM campaign_invoices WHERE payment_reference=$1 OR (product_version=1 AND id=$1)",
        [invoiceId],
      )
    ).rows[0];
    if (!invoice) throw Error("Unknown payment reference");
    await confirmPayment(invoice.id, signature, conn);
    await db().query(
      "UPDATE webhook_events SET status='CONFIRMED',error=NULL,rpc_payload=$2 WHERE signature=$1",
      [signature, JSON.stringify(tx)],
    );
    return;
  }
  const claim = (
    await db().query(
      "SELECT id,user_id,wallet FROM fee_claim_requests WHERE signature=$1",
      [signature],
    )
  ).rows[0];
  if (claim) {
    await confirmClaim(
      { userId: claim.user_id, wallet: claim.wallet },
      claim.id,
      conn,
    );
    await db().query(
      "UPDATE webhook_events SET status='CONFIRMED',error=NULL,rpc_payload=$2 WHERE signature=$1",
      [signature, JSON.stringify(tx)],
    );
    return;
  }
  await db().query(
    "UPDATE webhook_events SET status='UNCLASSIFIED',rpc_payload=$2,error=NULL WHERE signature=$1",
    [signature, JSON.stringify(tx)],
  );
}
export async function runPlatformSync(conn: Connection = connection()) {
  const config = platformConfig();
  if (!config.paymentWallet)
    return {
      configured: false,
      notice: "Campaign payment wallet not configured",
    };
  const lock = await db().connect(),
    deadline = Date.now() + 220000;
  try {
    if (
      !(await lock.query("SELECT pg_try_advisory_lock(836244101) acquired"))
        .rows[0].acquired
    )
      return { busy: true };
    const settings = (
      await lock.query("SELECT config FROM settings WHERE id=true")
    ).rows[0].config;
    if (settings.maintenance || settings.paused) return { paused: true };
    await lock.query(
      "UPDATE sync_state SET last_started_at=now() WHERE id=true",
    );
    // Unprepared expired quotes cannot have a signed checkout transaction. Prepared quotes
    // remain reconcilable until their transaction/blockhash outcome is independently proven.
    await transaction(async (c) => {
      const expired = await c.query(
        "UPDATE campaign_invoices SET status='EXPIRED' WHERE status='OPEN' AND expires_at<=now() AND prepared_message IS NULL RETURNING campaign_id",
      );
      for (const invoice of expired.rows) {
        const order = (
          await c.query(
            "SELECT status FROM ad_campaigns WHERE id=$1 FOR UPDATE",
            [invoice.campaign_id],
          )
        ).rows[0];
        if (order.status === "QUOTE_ACTIVE")
          await transition(
            c,
            invoice.campaign_id,
            order.status,
            "APPROVED_AWAITING_PAYMENT",
            "SYSTEM",
            "Unprepared payment quote expired",
          );
      }
    });
    if ((await conn.getGenesisHash()) !== GENESIS)
      throw Error("Mainnet RPC required");
    const s = (await lock.query("SELECT cursors FROM sync_state WHERE id=true"))
      .rows[0];
    const cursors = s.cursors || {},
      key = "platform:" + config.paymentWallet,
      cursor = cursors[key] || {};
    const entries = await conn.getSignaturesForAddress(
      new PublicKey(config.paymentWallet),
      {
        limit: 100,
        ...(cursor.head ? { until: cursor.head } : {}),
        ...(cursor.before ? { before: cursor.before } : {}),
      },
      "finalized",
    );
    const head = cursor.pendingHead || entries[0]?.signature;
    for (const e of [...entries].reverse())
      await queue(e.signature, { source: "CAMPAIGN_WALLET_RECONCILIATION" });
    const backlog = entries.length === 100;
    cursors[key] = backlog
      ? { ...cursor, pendingHead: head, before: entries.at(-1)?.signature }
      : { head: head || cursor.head };
    const pendingPayments = await lock.query(
      "SELECT broadcast_signature signature FROM campaign_invoices WHERE status='VERIFYING' AND broadcast_signature IS NOT NULL UNION SELECT signature FROM fee_claim_requests WHERE status='BROADCAST'",
    );
    for (const p of pendingPayments.rows)
      await queue(p.signature, { source: "SIGNED_CAMPAIGN_TRANSACTION" });
    const { rows } = await lock.query(
      "SELECT signature FROM webhook_events WHERE status IN ('DETECTED','VERIFYING','FAILED') AND attempts<12 ORDER BY created_at LIMIT 15",
    );
    let errors = 0,
      processed = 0;
    for (const e of rows) {
      if (Date.now() > deadline) break;
      try {
        await lock.query(
          "UPDATE webhook_events SET status='VERIFYING' WHERE signature=$1",
          [e.signature],
        );
        await processPlatformSignature(e.signature, conn);
        processed++;
      } catch (error) {
        errors++;
        await lock.query(
          "UPDATE webhook_events SET status='FAILED',attempts=attempts+1,error=$2 WHERE signature=$1",
          [e.signature, redact(error)],
        );
      }
    }
    const b = await conn.getBalanceAndContext(
      new PublicKey(config.paymentWallet),
      "finalized",
    );
    if (!Number.isSafeInteger(b.value)) throw Error("Unsafe RPC balance");
    await lock.query(
      "INSERT INTO wallet_snapshots(wallet,balance_lamports,slot,commitment) VALUES($1,$2,$3,'finalized') ON CONFLICT(wallet,slot) DO NOTHING",
      [config.paymentWallet, String(b.value), b.context.slot],
    );
    await refreshPrice();
    await lock.query(
      "UPDATE sync_state SET last_success_at=now(),cursors=$1,error=$2,alert=$3 WHERE id=true",
      [
        JSON.stringify(cursors),
        errors ? `${errors} signatures need review` : null,
        backlog ? "Payment wallet history backlog" : null,
      ],
    );
    return { processed, errors, backlog };
  } catch (e) {
    await lock.query("UPDATE sync_state SET error=$1 WHERE id=true", [
      redact(e),
    ]);
    throw e;
  } finally {
    await lock.query("SELECT pg_advisory_unlock(836244101)");
    lock.release();
  }
}
