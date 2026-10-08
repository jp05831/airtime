import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
const names = [
  "DATABASE_URL",
  "DATABASE_CA_CERT_BASE64",
  "AUTH_SECRET",
  "TOTP_ENCRYPTION_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HELIUS_API_KEY",
  "HELIUS_WEBHOOK_SECRET",
  "WORKER_SECRET",
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
const trace = JSON.parse(
  await readFile(
    ".next/server/app/api/creator/upload/route.js.nft.json",
    "utf8",
  ),
);
if (
  !trace.files.some((file) =>
    file.includes("@ffprobe-installer/linux-x64/ffprobe"),
  )
)
  throw Error("Static FFprobe binary missing from creator upload output trace");
console.log("Creator upload output trace includes static FFprobe.");
