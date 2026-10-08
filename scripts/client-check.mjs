import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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
async function scan(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) await scan(path);
    else if (/\.(js|map)$/.test(path)) {
      const text = await readFile(path, "utf8");
      for (const n of names) {
        const value = process.env[n];
        if (value && value.length >= 8 && text.includes(value))
          throw Error("Server secret found: " + n);
      }
      if (/createDecipheriv|createCipheriv|SOLANA_RPC_URL/.test(text))
        throw Error("Server tracking/auth code in browser bundle");
    }
  }
}
await scan(".next/static");
console.log(
  "Client secret scan passed (" +
    names.filter((n) => process.env[n]).length +
    " secret canaries).",
);
