import {
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  type VersionedTransactionResponse,
  type Connection,
} from "@solana/web3.js";
import bs58 from "bs58";
import { connection, GENESIS } from "@/lib/server/chain";
import { db, transaction } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { officialEvents, PUMP, PUMP_AMM } from "@/lib/server/protocol";
import { WSOL, ZERO } from "@/lib/accounting";
import { verifyCoinAuthority, buildClaim, pda } from "./coins";
import { logOperation, transition } from "./campaigns";
import { platformAvailable } from "./config";
import { assertCreativeApproved } from "@/lib/vibe/review";
import type { CreatorIdentity } from "./model";
export const MEMO = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
export function invoiceMemo(id: string) {
  return "AIRTIME:" + id;
}
export async function ownedInvoice(
  identity: CreatorIdentity,
  id: string,
  lock = false,
  c = db() as any,
) {
  const { rows } = await c.query(
    `SELECT * FROM campaign_invoices WHERE id=$1 AND user_id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [id, identity.userId],
  );
  if (!rows[0]) throw new HttpError(404, "Invoice not found");
  return rows[0];
}
export function verifyPaymentStructure(
  tx: VersionedTransactionResponse,
  invoice: any,
  finalized: boolean,
) {
  if (!finalized || !tx.meta || tx.meta.err || !tx.blockTime)
    throw new HttpError(409, "Payment must be finalized and successful");
  const when = tx.blockTime * 1000;
  if (
    when < Math.floor(new Date(invoice.created_at).getTime() / 1000) * 1000 ||
    when > new Date(invoice.expires_at).getTime()
  )
    throw new HttpError(409, "Payment is outside the invoice window");
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta.loadedAddresses,
  });
  const message = tx.transaction.message;
  if (
    message.header.numRequiredSignatures !== 1 ||
    keys.get(0)?.toBase58() !== invoice.creator_wallet ||
    message.compiledInstructions.length !== 2
  )
    throw new HttpError(
      409,
      "Payment signer or instructions do not match the invoice",
    );
  let amount: bigint | null = null,
    hasMemo = false;
  for (const ix of message.compiledInstructions) {
    const program = keys.get(ix.programIdIndex);
    if (program?.equals(SystemProgram.programId)) {
      try {
        const transfer = SystemInstruction.decodeTransfer(
          new TransactionInstruction({
            programId: SystemProgram.programId,
            data: Buffer.from(ix.data),
            keys: Array.from(ix.accountKeyIndexes).map((i) => ({
              pubkey: keys.get(i)!,
              isSigner: message.isAccountSigner(i),
              isWritable: message.isAccountWritable(i),
            })),
          }),
        );
        if (
          transfer.fromPubkey.toBase58() !== invoice.creator_wallet ||
          transfer.toPubkey.toBase58() !== invoice.recipient_wallet
        )
          throw Error();
        amount = transfer.lamports;
      } catch {
        throw new HttpError(
          409,
          "Payment recipient does not match the invoice",
        );
      }
    } else if (program?.equals(MEMO))
      hasMemo =
        Buffer.from(ix.data).toString() ===
        invoiceMemo(invoice.payment_reference || invoice.id);
    else throw new HttpError(409, "Payment contains unrelated instructions");
  }
  if (!hasMemo || amount !== BigInt(invoice.required_lamports))
    throw new HttpError(
      409,
      "Payment amount or invoice reference does not match",
    );
  let recipientIndex = -1;
  for (let i = 0; i < keys.length; i++)
    if (keys.get(i)?.toBase58() === invoice.recipient_wallet)
      recipientIndex = i;
  const pre = tx.meta.preBalances[recipientIndex],
    post = tx.meta.postBalances[recipientIndex];
  if (
    !Number.isSafeInteger(pre) ||
    !Number.isSafeInteger(post) ||
    BigInt(post) - BigInt(pre) !== amount
  )
    throw new HttpError(409, "Exact recipient credit could not be verified");
  return {
    amount,
    slot: tx.slot,
    blockTime: new Date(when),
    evidence: {
      method: "FINALIZED_SYSTEM_TRANSFER_AND_INVOICE_MEMO",
      memo: invoiceMemo(invoice.payment_reference || invoice.id),
      slot: tx.slot,
      signer: invoice.creator_wallet,
      recipient: invoice.recipient_wallet,
    },
  };
}
export async function finalizedTransaction(
  signature: string,
  conn: Connection = connection(),
) {
  if ((await conn.getGenesisHash()) !== GENESIS)
    throw new HttpError(503, "Mainnet RPC required");
  const status = (
    await conn.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (status?.confirmationStatus !== "finalized")
    throw new HttpError(409, "Transaction is awaiting finalized confirmation");
  if (status.err) throw new HttpError(409, "Transaction failed on-chain");
  const tx = await conn.getTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.transaction.signatures[0] !== signature)
    throw new HttpError(409, "Finalized transaction unavailable");
  return tx;
}
export async function preparePayment(
  identity: CreatorIdentity,
  id: string,
  conn: Connection = connection(),
) {
  await platformAvailable();
  const invoice = await ownedInvoice(identity, id);
  if (invoice.product_version !== 2)
    throw new HttpError(409, "Historical invoices cannot be paid");
  await assertCreativeApproved(invoice.campaign_id, identity.userId);
  if (new Date(invoice.expires_at).getTime() <= Date.now())
    throw new HttpError(409, "Payment quote expired");
  const tx = new Transaction({ feePayer: new PublicKey(identity.wallet) });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(identity.wallet),
      toPubkey: new PublicKey(invoice.recipient_wallet),
      lamports: BigInt(invoice.required_lamports),
    }),
  );
  tx.add(
    new TransactionInstruction({
      programId: MEMO,
      keys: [],
      data: Buffer.from(invoiceMemo(invoice.payment_reference || id)),
    }),
  );
  const block = await conn.getLatestBlockhash("finalized");
  tx.recentBlockhash = block.blockhash;
  return transaction(async (c) => {
    const current = await ownedInvoice(identity, id, true, c);
    if (new Date(current.expires_at).getTime() <= Date.now())
      throw new HttpError(409, "Payment quote expired");
    if (current.status !== "OPEN" || current.broadcast_signature)
      throw new HttpError(409, "Payment already prepared or broadcast");
    if (current.prepared_message) {
      if (
        (await conn.getBlockHeight("finalized")) <=
        Number(current.prepared_blockheight)
      )
        throw new HttpError(
          409,
          "A payment is already prepared. Confirm or wait for its blockhash to expire.",
        );
    }
    const msg = tx.serializeMessage().toString("base64");
    await c.query(
      "UPDATE campaign_invoices SET prepared_message=$2,prepared_blockheight=$3,prepared_at=now() WHERE id=$1",
      [id, msg, block.lastValidBlockHeight],
    );
    return {
      id,
      kind: "PAYMENT",
      transaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      description: `Pay exactly ${invoice.required_lamports} lamports to AIRTIME for invoice ${id}. Only this transfer and its invoice memo are included. Network fees are charged separately by Solana.`,
      blockheight: block.lastValidBlockHeight,
    };
  });
}
export async function prepareClaim(
  identity: CreatorIdentity,
  mint: string,
  venue: "CURVE" | "AMM",
  conn: Connection = connection(),
) {
  await platformAvailable();
  const proof = await verifyCoinAuthority(identity.wallet, mint, conn);
  const built = await buildClaim(proof, identity.wallet, venue, conn);
  const { rows } = await db().query(
    "INSERT INTO fee_claim_requests(user_id,wallet,mint,venue,creator,prepared_message,blockheight) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [
      identity.userId,
      identity.wallet,
      mint,
      venue,
      proof.creator,
      built.tx.serializeMessage().toString("base64"),
      built.blockheight,
    ],
  );
  return {
    id: rows[0].id,
    kind: "CLAIM",
    transaction: built.tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    description: built.description,
    blockheight: built.blockheight,
    estimatedVaultLamports: built.estimatedVaultLamports,
  };
}
export async function broadcastSigned(
  identity: CreatorIdentity,
  id: string,
  kind: "PAYMENT" | "CLAIM",
  encoded: string,
  conn: Connection = connection(),
) {
  await platformAvailable();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 1232) throw new HttpError(400, "Transaction too large");
  let tx: Transaction;
  try {
    tx = Transaction.from(bytes);
  } catch {
    throw new HttpError(400, "Malformed signed transaction");
  }
  if (tx.feePayer?.toBase58() !== identity.wallet || !tx.verifySignatures())
    throw new HttpError(403, "Wallet signature invalid");
  if (kind === "PAYMENT") {
    const invoice = await ownedInvoice(identity, id);
    await assertCreativeApproved(invoice.campaign_id, identity.userId);
  }
  const signature = bs58.encode(tx.signature!);
  await transaction(async (c) => {
    const table =
      kind === "PAYMENT" ? "campaign_invoices" : "fee_claim_requests";
    const row = (
      await c.query(
        `SELECT * FROM ${table} WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [id, identity.userId],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Transaction request not found");
    const old = kind === "PAYMENT" ? row.broadcast_signature : row.signature;
    if (old)
      throw new HttpError(
        409,
        "This transaction was already submitted. Check confirmation; it will not be rebroadcast.",
      );
    if (row.prepared_message !== tx.serializeMessage().toString("base64"))
      throw new HttpError(
        403,
        "Signed instructions differ from the reviewed transaction",
      );
    if (
      (await conn.getBlockHeight("finalized")) >
      Number(kind === "PAYMENT" ? row.prepared_blockheight : row.blockheight)
    )
      throw new HttpError(409, "Prepared blockhash expired");
    if (
      kind === "PAYMENT" &&
      (row.status !== "OPEN" ||
        new Date(row.expires_at).getTime() <= Date.now())
    )
      throw new HttpError(409, "Payment quote expired");
    await verifyCoinAuthority(identity.wallet, row.mint, conn);
    if (kind === "PAYMENT") {
      await c.query(
        "UPDATE campaign_invoices SET broadcast_signature=$2,status='VERIFYING' WHERE id=$1",
        [id, signature],
      );
      const campaign = (
        await c.query(
          "SELECT status FROM ad_campaigns WHERE id=$1 FOR UPDATE",
          [row.campaign_id],
        )
      ).rows[0];
      await transition(
        c,
        row.campaign_id,
        campaign.status,
        "PAYMENT_VERIFYING",
        identity.wallet,
        "Signed payment submitted; awaiting finality",
      );
    } else
      await c.query(
        "UPDATE fee_claim_requests SET signature=$2,status='BROADCAST' WHERE id=$1",
        [id, signature],
      );
    await logOperation(
      identity.wallet,
      "SIGNED_TRANSACTION",
      id,
      { kind, signature },
      c,
    );
  });
  // Persist signature before RPC. Never resubmit on ambiguous RPC failures or retry a payment.
  try {
    const sent = await conn.sendRawTransaction(bytes, {
      skipPreflight: false,
      maxRetries: 0,
      preflightCommitment: "finalized",
    });
    if (sent !== signature) throw Error("RPC signature mismatch");
    return { signature, status: "BROADCAST" };
  } catch {
    return {
      signature,
      status: "CONFIRMATION_UNKNOWN",
      notice:
        "RPC submission could not be confirmed. Check this signature. AIRTIME will never automatically resubmit your payment.",
    };
  }
}
export async function confirmPayment(
  id: string,
  signature: string,
  conn: Connection = connection(),
) {
  const tx = await finalizedTransaction(signature, conn);
  const invoice = (
    await db().query("SELECT * FROM campaign_invoices WHERE id=$1", [id])
  ).rows[0];
  if (!invoice) throw new HttpError(404, "Invoice not found");
  const proof = verifyPaymentStructure(tx, invoice, true);
  return transaction(async (c) => {
    const i = (
      await c.query("SELECT * FROM campaign_invoices WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    const previous = (
      await c.query(
        "SELECT invoice_id FROM campaign_payments WHERE signature=$1 OR invoice_id=$2",
        [signature, id],
      )
    ).rows[0];
    if (previous) {
      if (previous.invoice_id !== id)
        throw new HttpError(
          409,
          "Transaction already credited to another invoice",
        );
      return { status: "PAID", duplicate: true };
    }
    if (!["OPEN", "VERIFYING"].includes(i.status))
      throw new HttpError(409, "Invoice requires manual reconciliation");
    if (i.broadcast_signature && i.broadcast_signature !== signature)
      throw new HttpError(409, "Invoice already has a submitted payment");
    await c.query(
      "INSERT INTO campaign_payments(invoice_id,signature,creator_wallet,recipient_wallet,amount_lamports,status,slot,block_time,evidence) VALUES($1,$2,$3,$4,$5,'FINALIZED',$6,$7,$8)",
      [
        id,
        signature,
        i.creator_wallet,
        i.recipient_wallet,
        proof.amount.toString(),
        proof.slot,
        proof.blockTime,
        JSON.stringify({ ...proof.evidence, transaction: tx }),
      ],
    );
    await c.query(
      "UPDATE campaign_invoices SET status='PAID',broadcast_signature=$2 WHERE id=$1",
      [id, signature],
    );
    const campaign = (
      await c.query("SELECT status FROM ad_campaigns WHERE id=$1 FOR UPDATE", [
        i.campaign_id,
      ])
    ).rows[0];
    await transition(
      c,
      i.campaign_id,
      campaign.status,
      "PAID",
      i.creator_wallet,
      "Finalized exact campaign payment verified",
    );
    if (i.product_version === 2)
      await c.query(
        "INSERT INTO campaign_provisioning(campaign_id,invoice_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [i.campaign_id, i.id],
      );
    if (i.product_version === 2)
      await c.query(
        "INSERT INTO campaign_settlements(invoice_id,campaign_id,customer_lamports,media_cents,service_fee_cents) VALUES($1,$2,$3,5000,1000) ON CONFLICT(invoice_id) DO NOTHING",
        [id, i.campaign_id, proof.amount.toString()],
      );
    return { status: "PAID" };
  });
}
export async function confirmClaim(
  identity: CreatorIdentity,
  id: string,
  conn: Connection = connection(),
) {
  const claim = (
    await db().query(
      "SELECT * FROM fee_claim_requests WHERE id=$1 AND user_id=$2",
      [id, identity.userId],
    )
  ).rows[0];
  if (!claim?.signature) throw new HttpError(404, "Claim not submitted");
  if (claim.status === "FINALIZED")
    return { status: "FINALIZED", amountLamports: claim.exact_claim_lamports };
  const tx = await finalizedTransaction(claim.signature, conn);
  const expected = Buffer.from(claim.prepared_message, "base64");
  if (!Buffer.from(tx.transaction.message.serialize()).equals(expected))
    throw new HttpError(
      409,
      "Claim transaction does not match reviewed instructions",
    );
  const events = officialEvents(tx).filter((e) => e.data);
  let amount: bigint | null = null;
  for (const e of events) {
    const data = e.data!;
    if (
      e.program === PUMP &&
      e.name === "CollectCreatorFeeEvent" &&
      data.creator === claim.wallet &&
      [ZERO, WSOL].includes(data.quote_mint)
    )
      amount = data.creator_fee;
    if (
      e.program === PUMP_AMM &&
      e.name === "CollectCoinCreatorFeeEvent" &&
      data.coin_creator === claim.wallet
    )
      amount = data.coin_creator_fee;
  }
  // Shared distribution is proved from actual native transfers to this shareholder, never a proportional estimate.
  if (
    events.some(
      (e) =>
        e.name === "DistributeCreatorFeesEvent" && e.data?.mint === claim.mint,
    )
  ) {
    const vault = pda(PUMP, ["creator-vault", new PublicKey(claim.creator)]),
      keys = tx.transaction.message.getAccountKeys({
        accountKeysFromLookups: tx.meta?.loadedAddresses,
      });
    let total = 0n;
    for (const ix of (tx.meta?.innerInstructions || []).flatMap(
      (g) => g.instructions,
    )) {
      if (keys.get(ix.programIdIndex)?.equals(SystemProgram.programId)) {
        try {
          const t = SystemInstruction.decodeTransfer(
            new TransactionInstruction({
              programId: SystemProgram.programId,
              keys: ix.accounts.map((n) => ({
                pubkey: keys.get(n)!,
                isSigner: false,
                isWritable: true,
              })),
              data: Buffer.from(bs58.decode(ix.data)),
            }),
          );
          if (
            t.fromPubkey.equals(vault) &&
            t.toPubkey.toBase58() === claim.wallet
          )
            total += t.lamports;
        } catch {}
      }
    }
    amount = total;
  }
  if (claim.venue === "AMM" && claim.creator !== claim.wallet) amount = 0n;
  await transaction(async (c) => {
    const current = (
      await c.query(
        "SELECT status FROM fee_claim_requests WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (current.status === "FINALIZED") return;
    const evidence = {
      method:
        amount === null
          ? "FINALIZED_CLAIM_EXACT_AMOUNT_UNAVAILABLE"
          : "OFFICIAL_EVENT_OR_NATIVE_SHAREHOLDER_TRANSFER",
      events,
      transaction: tx,
    };
    await c.query(
      "UPDATE fee_claim_requests SET status='FINALIZED',exact_claim_lamports=$2,evidence=$3,slot=$4,confirmed_at=now() WHERE id=$1",
      [
        id,
        amount?.toString() ?? null,
        JSON.stringify(evidence, (_, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
        tx.slot,
      ],
    );
    await logOperation(
      identity.wallet,
      "CLAIM_FINALIZED",
      id,
      {
        signature: claim.signature,
        exactClaimLamports: amount?.toString() ?? null,
      },
      c,
    );
  });
  return {
    status: "FINALIZED",
    amountLamports: amount?.toString() ?? null,
    notice:
      "Claim finalized. A campaign payment still requires a separate wallet signature.",
  };
}

export async function releaseExpiredQuote(
  identity: CreatorIdentity,
  campaignId: string,
  conn: Connection = connection(),
) {
  const invoice = (
    await db().query(
      "SELECT * FROM campaign_invoices WHERE campaign_id=$1 AND user_id=$2 AND status IN ('OPEN','VERIFYING')",
      [campaignId, identity.userId],
    )
  ).rows[0];
  if (!invoice) throw new HttpError(404, "No open invoice");
  if (new Date(invoice.expires_at).getTime() >= Date.now())
    throw new HttpError(409, "Quote has not expired");
  if ((await conn.getGenesisHash()) !== GENESIS)
    throw new HttpError(503, "Mainnet RPC required");
  if (
    invoice.prepared_blockheight &&
    (await conn.getBlockHeight("finalized")) <=
      Number(invoice.prepared_blockheight)
  )
    throw new HttpError(
      409,
      "Prepared transaction can still land. Do not repay.",
    );
  if (invoice.broadcast_signature) {
    const state = (
      await conn.getSignatureStatuses([invoice.broadcast_signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (state && !state.err) {
      await confirmPayment(invoice.id, invoice.broadcast_signature, conn);
      return { status: "PAID" };
    }
    if (state && (state.confirmationStatus !== "finalized" || !state.err))
      throw new HttpError(409, "Wait for finality before recovering the quote");
    const tx = await conn.getTransaction(invoice.broadcast_signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta && !tx.meta.err)
      throw new HttpError(
        409,
        "Payment exists and requires reconciliation. Do not repay.",
      );
  }
  if (!invoice.broadcast_signature) {
    const recent = await conn.getSignaturesForAddress(
      new PublicKey(invoice.recipient_wallet),
      { limit: 10 },
      "finalized",
    );
    const created = Math.floor(new Date(invoice.created_at).getTime() / 1000);
    if (
      recent.some((e) => e.blockTime === null) ||
      (recent.length === 10 && (recent.at(-1)?.blockTime || 0) >= created)
    )
      throw new HttpError(
        409,
        "Payment history requires manual reconciliation before another quote. Do not repay.",
      );
    for (const item of recent.filter(
      (e) => !e.err && (e.blockTime || 0) >= created,
    )) {
      const t = await conn.getTransaction(item.signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (!t)
        throw new HttpError(
          409,
          "Recipient history is incomplete. Do not repay.",
        );
      const keys = t.transaction.message.getAccountKeys({
        accountKeysFromLookups: t.meta?.loadedAddresses,
      });
      if (
        t.transaction.message.compiledInstructions.some(
          (ix) =>
            keys.get(ix.programIdIndex)?.equals(MEMO) &&
            Buffer.from(ix.data).toString() ===
              invoiceMemo(invoice.payment_reference || invoice.id),
        )
      ) {
        await confirmPayment(invoice.id, item.signature, conn);
        return { status: "PAID" };
      }
    }
  }
  return transaction(async (c) => {
    const locked = await ownedInvoice(identity, invoice.id, true, c);
    if (!["OPEN", "VERIFYING"].includes(locked.status))
      throw new HttpError(409, "Invoice changed. Refresh campaign.");
    if (
      (
        await c.query("SELECT id FROM campaign_payments WHERE invoice_id=$1", [
          invoice.id,
        ])
      ).rows.length
    )
      throw new HttpError(409, "Payment already recorded");
    await c.query(
      "UPDATE campaign_invoices SET status='CANCELLED' WHERE id=$1",
      [invoice.id],
    );
    const campaign = (
      await c.query("SELECT status FROM ad_campaigns WHERE id=$1 FOR UPDATE", [
        campaignId,
      ])
    ).rows[0];
    if (campaign.status === "PAYMENT_VERIFYING")
      await transition(
        c,
        campaignId,
        "PAYMENT_VERIFYING",
        "APPROVED_AWAITING_PAYMENT",
        identity.wallet,
        "Expired blockhash with no successful transaction; quote cancelled, no payment retried",
      );
    await logOperation(
      identity.wallet,
      "EXPIRED_UNPAID_QUOTE_RELEASED",
      invoice.id,
      {},
      c,
    );
    return {
      status: "CANCELLED",
      notice:
        "Old quote cancelled after checking the expired blockhash and payment status. Request a fresh invoice; nothing has been resent.",
    };
  });
}
