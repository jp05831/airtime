import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const names = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "TOTP_ENCRYPTION_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HELIUS_API_KEY",
  "HELIUS_WEBHOOK_SECRET",
  "CRON_SECRET",
  "VIBE_CLIENT_ID",
  "VIBE_CLIENT_SECRET",
  "VIBE_ACCESS_TOKEN",
];
const env = { ...process.env, DEMO_MODE: "false" };
for (const name of names)
  env[name] = "AIRTIME_CANARY_" + randomBytes(24).toString("hex");
for (const args of [
  ["run", "build"],
  ["run", "check:client"],
]) {
  const result = spawnSync("npm", args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status || 1);
}
