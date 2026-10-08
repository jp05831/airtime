import { PublicKey } from "@solana/web3.js";
import { address } from "@/lib/validation";
import { required } from "@/lib/server/config";
import { db } from "@/lib/server/db";
export function platformConfig() {
  const integer = (key: string, fallback: string) => {
    const v = process.env[key] ?? fallback;
    if (!/^\d{1,12}$/.test(v))
      throw Error(`${key} must be integer cents/seconds`);
    return BigInt(v);
  };
  const mediaCents = integer("MEDIA_BUDGET_CENTS", "5000"),
    serviceFeeCents = integer("PLATFORM_FEE_CENTS", "1000"),
    totalCents = integer("TOTAL_CAMPAIGN_PRICE_CENTS", "6000"),
    ttlSeconds = integer("SOL_QUOTE_TTL_SECONDS", "300");
  if (totalCents !== mediaCents + serviceFeeCents)
    throw Error("Campaign total must equal media plus service fee");
  if (
    mediaCents !== 5000n ||
    serviceFeeCents !== 1000n ||
    totalCents !== 6000n ||
    ttlSeconds !== 300n
  )
    throw Error(
      "Version one requires $50 media, $10 fee and a five-minute quote",
    );
  const paymentWallet = process.env.CAMPAIGN_PAYMENT_WALLET?.trim() || "";
  if (paymentWallet) {
    address.parse(paymentWallet);
    if (!PublicKey.isOnCurve(new PublicKey(paymentWallet).toBytes()))
      throw Error("Payment wallet must be a normal signing wallet");
  }
  return {
    mediaCents,
    serviceFeeCents,
    totalCents,
    ttlSeconds: Number(ttlSeconds),
    paymentWallet,
    // Legacy read models retain these fields; fixed-price checkout never uses BPS arithmetic.
    minimumCents: mediaCents,
    feeBps: 2000,
    expirationMinutes: 5,
  };
}
export async function platformAvailable() {
  const { rows } = await db().query(
    "SELECT config FROM settings WHERE id=true",
  );
  if (rows[0]?.config.maintenance) {
    const { HttpError } = await import("@/lib/server/http");
    throw new HttpError(503, "AIRTIME is in maintenance. Try again later.");
  }
}
export function validatePlatform() {
  for (const name of [
    "CAMPAIGN_PAYMENT_WALLET",
    "MEDIA_BUDGET_CENTS",
    "PLATFORM_FEE_CENTS",
    "TOTAL_CAMPAIGN_PRICE_CENTS",
    "SOL_QUOTE_TTL_SECONDS",
    "FFPROBE_PATH",
  ])
    required(name);
  platformConfig();
}
