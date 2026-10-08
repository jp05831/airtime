import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const names = [
  "VIBE_CLIENT_ID",
  "VIBE_CLIENT_SECRET",
  "VIBE_ACCESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_SECRET",
  "TOTP_ENCRYPTION_KEY",
  "HELIUS_WEBHOOK_SECRET",
  "WORKER_SECRET",
  "DATABASE_URL",
  "DATABASE_CA_CERT_BASE64",
];
const excluded = new Set(["node_modules", ".git", ".next-dev", "artifacts"]);
let files = 0;
async function scan(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (excluded.has(e.name)) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      await scan(path);
      continue;
    }
    if (e.name.startsWith(".env") && e.name !== ".env.example") continue; // private secret storage is never printed or treated as a committed public artifact.
    if (
      !/\.(tsx?|jsx?|mjs|cjs|json|md|sql|ya?ml|map)$/.test(path) &&
      e.name !== ".env.example"
    )
      continue;
    const text = await readFile(path, "utf8");
    files++;
    for (const name of names) {
      const value = process.env[name];
      if (value && value.length >= 20 && text.includes(value))
        throw Error("Configured secret leaked in " + path + " (" + name + ")");
    }
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) &&
      !path.startsWith("tests/")
    )
      throw Error("Private-key material in " + path);
    if (
      /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
        text,
      ) &&
      !path.startsWith("tests/")
    )
      throw Error("Possible embedded signed credential in " + path);
    if (e.name === ".env.example")
      for (const name of names) {
        const match = text.match(new RegExp("^" + name + "=(.*)$", "m"));
        if (match?.[1].trim())
          throw Error("Secret placeholder must be empty: " + name);
      }
  }
}
await scan(".");
console.log(
  "Repository and built artifact secret scan passed: " +
    files +
    " text files. No credential values printed.",
);
