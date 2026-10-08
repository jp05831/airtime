import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
export const address = z
  .string()
  .min(32)
  .max(44)
  .refine((v) => {
    try {
      return new PublicKey(v).toBase58() === v;
    } catch {
      return false;
    }
  }, "Invalid Solana address");
export const signature = z
  .string()
  .min(64)
  .max(88)
  .refine((v) => {
    try {
      return bs58.decode(v).length === 64;
    } catch {
      return false;
    }
  }, "Invalid transaction signature");
export const integer = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n, "Amount too large");
export function externalUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hostname === "localhost" ||
    /^\d+(\.\d+){3}$/.test(u.hostname) ||
    u.hostname.endsWith(".local") ||
    u.hostname.includes(":")
  )
    throw Error("Use a public HTTPS URL");
  return u.toString();
}
export const optionalUrl = z
  .string()
  .max(2000)
  .transform((v, ctx) => {
    try {
      return v ? externalUrl(v) : null;
    } catch {
      ctx.addIssue({ code: "custom", message: "Use a public HTTPS URL" });
      return z.NEVER;
    }
  });
export function tradeUrl(kind: "pump" | "axiom", value: string, mint?: string) {
  const u = new URL(externalUrl(value));
  if (
    u.hostname !== (kind === "pump" ? "pump.fun" : "axiom.trade") ||
    u.pathname === "/" ||
    u.searchParams.has("redirect") ||
    u.searchParams.has("url") ||
    (kind === "axiom" && !/^\/meme\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname)) ||
    (kind === "pump" &&
      mint &&
      !["/coin/" + mint, "/" + mint].includes(u.pathname))
  )
    throw Error("Use the configured token URL on the approved terminal");
  return u.toString();
}
export const settingsInput = z
  .object({
    mint: address,
    creator: address,
    treasury: address,
    pumpUrl: z.string(),
    axiomUrl: z.string(),
    allocationBps: z.number().int().min(0).max(10000),
    paused: z.boolean(),
    maintenance: z.boolean(),
  })
  .superRefine((s, ctx) => {
    try {
      tradeUrl("pump", s.pumpUrl, s.mint);
      tradeUrl("axiom", s.axiomUrl);
      if (s.creator === s.treasury)
        throw Error("Creator and treasury must be different wallets");
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
    }
  });
