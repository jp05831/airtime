import { PublicKey, Message, Transaction } from "@solana/web3.js";
import { db, transaction } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { refreshPrice } from "@/lib/server/price";
import { quoteLamports } from "@/lib/vibe/money";
import { address } from "@/lib/validation";
import { logOperation } from "./campaigns";
import {
  paymentSmokeEnabled,
  requirePaymentSmokeEnabled,
  platformAvailable,
  platformConfig,
} from "./config";
export const SMOKE_WARNING =
  "This transfers real mainnet SOL worth $1.00 plus Solana network fees. It is a TEST payment, is not automatically refunded, and will not create or activate a campaign.";
export async function smokeIdentity(adminId: string, id: string) {
  const row = (
    await db().query(
      "SELECT creator_wallet FROM payment_test_invoices WHERE id=$1 AND admin_id=$2",
      [id, adminId],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "TEST invoice not found");
  return { userId: adminId, wallet: row.creator_wallet as string };
}
export async function quotePaymentSmoke(adminId: string, wallet: string) {
  requirePaymentSmokeEnabled();
  await platformAvailable();
  address.parse(wallet);
  if (!PublicKey.isOnCurve(new PublicKey(wallet).toBytes()))
    throw new HttpError(400, "A normal signing wallet is required");
  const config = platformConfig();
  if (!config.paymentWallet)
    throw new HttpError(503, "Campaign payment wallet is not configured");
  if (config.paymentWallet === wallet)
    throw new HttpError(
      403,
      "Choose a payer different from the payment recipient",
    );
  const price = await refreshPrice();
  if (!price)
    throw new HttpError(
      503,
      "SOL/USD pricing is unavailable. No TEST invoice was issued.",
    );
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(836244220)");
    await c.query(
      "UPDATE payment_test_invoices SET status='EXPIRED' WHERE status='OPEN' AND prepared_message IS NULL AND expires_at<=now()",
    );
    const old = (
      await c.query(
        "SELECT * FROM payment_test_invoices WHERE status IN ('OPEN','VERIFYING') FOR UPDATE",
      )
    ).rows[0];
    if (old) {
      if (
        old.admin_id === adminId &&
        old.creator_wallet === wallet &&
        new Date(old.expires_at).getTime() > Date.now()
      )
        return { invoice: smokeInvoiceView(old) };
      throw new HttpError(
        409,
        "One TEST invoice is already open. Reconcile or safely release it before requesting another.",
      );
    }
    const row = (
      await c.query(
        "INSERT INTO payment_test_invoices(admin_id,creator_wallet,recipient_wallet,price_usd_micros,price_source,price_fetched_at,required_lamports) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          adminId,
          wallet,
          config.paymentWallet,
          String(price.price_usd_micros),
          price.source,
          price.fetched_at,
          quoteLamports(100n, BigInt(price.price_usd_micros)).toString(),
        ],
      )
    ).rows[0];
    await logOperation(
      adminId,
      "TEST_INVOICE_ISSUED",
      row.id,
      {
        record_kind: "TEST",
        requiredLamports: String(row.required_lamports),
        warning: SMOKE_WARNING,
      },
      c,
    );
    return { invoice: smokeInvoiceView(row) };
  });
}
export function smokeInvoiceView(row: any) {
  const phase =
    row.status === "PAID"
      ? "Finalized"
      : row.status === "VERIFYING"
        ? row.confirmation_checked_at
          ? "Confirming"
          : "Broadcast"
        : row.status === "OPEN"
          ? row.prepared_message
            ? "Prepared"
            : "Quoted"
          : row.status;
  const encoded =
    row.prepared_message && row.status === "OPEN"
      ? Transaction.populate(
          Message.from(Buffer.from(row.prepared_message, "base64")),
        )
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64")
      : null;
  return {
    id: row.id,
    record_kind: "TEST",
    status: row.status,
    phase,
    payer: row.creator_wallet,
    recipient: row.recipient_wallet,
    totalCents: "100",
    mediaCents: "0",
    revenueCents: "0",
    lamports: String(row.required_lamports),
    priceMicros: String(row.price_usd_micros),
    priceSource: row.price_source,
    expiresAt: new Date(row.expires_at).toISOString(),
    reference: row.payment_reference,
    signature: row.broadcast_signature,
    transaction: encoded,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
export async function paymentSmokeState(adminId: string) {
  const rows = (
    await db().query(
      "SELECT * FROM payment_test_invoices WHERE admin_id=$1 ORDER BY created_at DESC LIMIT 20",
      [adminId],
    )
  ).rows;
  return {
    enabled:
      paymentSmokeEnabled() &&
      (process.env.VIBE_LIVE_MODE || "false") === "false",
    warning: SMOKE_WARNING,
    invoices: rows.map(smokeInvoiceView),
  };
}
