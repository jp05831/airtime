import { z } from "zod";
import { adminHandler } from "@/lib/server/admin";
import { body, rateLimit, HttpError } from "@/lib/server/http";
import { address, signature } from "@/lib/validation";
import { connection } from "@/lib/server/chain";
import {
  broadcastSigned,
  preparePayment,
  confirmPayment,
  releaseExpiredQuote,
} from "@/lib/platform/payments";
import {
  quotePaymentSmoke,
  smokeIdentity,
  paymentSmokeState,
} from "@/lib/platform/payment-smoke";
import { db } from "@/lib/server/db";
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote"), wallet: address }).strict(),
  z.object({ action: z.literal("prepare"), id: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("broadcast"),
      id: z.string().uuid(),
      transaction: z.string().min(20).max(2000),
    })
    .strict(),
  z
    .object({ action: z.literal("verify"), id: z.string().uuid(), signature })
    .strict(),
  z
    .object({ action: z.literal("release-expired"), id: z.string().uuid() })
    .strict(),
]);
export const GET = adminHandler(
  async (_r, admin) => paymentSmokeState(admin.id),
  false,
);
export const POST = adminHandler(async (r, admin) => {
  const v = input.parse(await body(r));
  await rateLimit(
    "admin-payment-test:" + admin.id + ":" + v.action,
    v.action === "quote" ? 3 : 15,
  );
  if (v.action === "quote") return quotePaymentSmoke(admin.id, v.wallet);
  const identity = await smokeIdentity(admin.id, v.id),
    conn = connection();
  if (v.action === "prepare")
    return preparePayment(identity, v.id, conn, "TEST");
  if (v.action === "broadcast")
    return broadcastSigned(identity, v.id, "TEST", v.transaction, conn);
  if (v.action === "release-expired")
    return releaseExpiredQuote(identity, v.id, conn, "TEST");
  await db().query(
    "UPDATE payment_test_invoices SET confirmation_checked_at=now() WHERE id=$1 AND status='VERIFYING'",
    [v.id],
  );
  try {
    const result = await confirmPayment(v.id, v.signature, conn, "TEST");
    return { ...result, phase: "Finalized", record_kind: "TEST" };
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.status === 409 &&
      error.message === "Transaction is awaiting finalized confirmation"
    )
      return {
        status: "VERIFYING",
        phase: "Confirming",
        record_kind: "TEST",
        signature: v.signature,
      };
    throw error;
  }
});
