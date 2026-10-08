import { vibeConfig } from "@/lib/vibe/config";
import { validatePlatform } from "@/lib/platform/config";
import type { Settings } from "@/lib/types";
import { db } from "./db";
import { databaseConnectionOptions } from "./database-config";
export function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw Error(`${name} is required`);
  return value;
}
export function demoEnabled() {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE === "true")
    throw Error("Demo mode is forbidden in production");
  return (
    process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true"
  );
}
export function envSettings(): Settings {
  return {
    mint: process.env.TOKEN_MINT || "",
    creator: process.env.CREATOR_WALLET || "",
    treasury: process.env.TREASURY_WALLET || "",
    pumpUrl: process.env.PUMP_URL || "",
    axiomUrl: process.env.AXIOM_URL || "",
    allocationBps: Number(process.env.AD_ALLOCATION_BPS ?? "10000"),
    paused: false,
    maintenance: false,
  };
}
export async function settings() {
  const fallback = envSettings();
  if (!process.env.DATABASE_URL) return fallback;
  const { rows } = await db().query(
    "SELECT config FROM settings WHERE id=true",
  );
  return { ...fallback, ...rows[0]?.config } as Settings;
}
export function origin() {
  return new URL(required("APP_ORIGIN")).origin;
}
export function validateProduction() {
  demoEnabled();
  for (const name of [
    "DATABASE_URL",
    "DATABASE_CA_CERT_BASE64",
    "APP_ORIGIN",
    "ADMIN_EMAIL",
    "AUTH_SECRET",
    "TOTP_ENCRYPTION_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SOLANA_RPC_URL",
    "HELIUS_API_KEY",
    "HELIUS_WEBHOOK_SECRET",
    "WORKER_SECRET",
  ])
    required(name);
  validatePlatform();
  vibeConfig();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(required("ADMIN_EMAIL")))
    throw Error("ADMIN_EMAIL must be a valid email");
  for (const name of [
    "AUTH_SECRET",
    "TOTP_ENCRYPTION_KEY",
    "HELIUS_WEBHOOK_SECRET",
    "WORKER_SECRET",
  ])
    if (required(name).length < 32)
      throw Error(`${name} must be at least 32 characters`);
  if (
    new Set(
      [
        "AUTH_SECRET",
        "TOTP_ENCRYPTION_KEY",
        "HELIUS_WEBHOOK_SECRET",
        "WORKER_SECRET",
      ].map(required),
    ).size !== 4
  )
    throw Error("Secrets must be distinct");
  const app = new URL(required("APP_ORIGIN"));
  if (
    app.username ||
    app.password ||
    app.protocol !== "https:" ||
    app.pathname !== "/" ||
    app.search ||
    app.hash
  )
    throw Error("APP_ORIGIN must be an HTTPS origin");
  databaseConnectionOptions(process.env, true);
  for (const name of ["SOLANA_RPC_URL", "SUPABASE_URL"])
    if (new URL(required(name)).protocol !== "https:")
      throw Error(`${name} requires HTTPS`);
  if (process.env.NEXT_PUBLIC_SOLANA_NETWORK !== "mainnet-beta")
    throw Error("Mainnet network required");
}
