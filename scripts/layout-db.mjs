// LOCAL UI fixture database only. No production/remote database or Solana connection.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
if (process.env.NODE_ENV === "production")
  throw Error("Layout fixtures are forbidden in production");
const db = new PGlite();
const server = new PGLiteSocketServer({
  db,
  host: "127.0.0.1",
  port: 5438,
  maxConnections: 10,
});
await server.start();
const result = await promisify(execFile)(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "scripts/migrate.ts"],
  {
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5438/postgres",
      NODE_ENV: "development",
    },
  },
);
console.log(result.stdout);
await db.exec("SET search_path=airtime,public");
const user = randomUUID(),
  wallet = Keypair.generate().publicKey.toBase58(),
  mint = Keypair.generate().publicKey.toBase58(),
  token = randomBytes(32).toString("base64url");
await db.query("INSERT INTO platform_users(id) VALUES($1)", [user]);
await db.query("INSERT INTO platform_wallets(user_id,wallet) VALUES($1,$2)", [
  user,
  wallet,
]);
await db.query(
  "INSERT INTO creator_sessions(token_hash,user_id,wallet,expires_at) VALUES($1,$2,$3,now()+interval '2 hours')",
  [createHash("sha256").update(token).digest("hex"), user, wallet],
);
await db.query(
  "INSERT INTO platform_coins(mint,name,ticker,current_creator,venue,metadata_source) VALUES($1,'Layout fixture coin','EXAMPLE',$2,'Local fixture — not chain verified','LOCAL_LAYOUT_FIXTURE')",
  [mint, wallet],
);
await db.query(
  "INSERT INTO coin_authorities(user_id,mint,wallet,role,evidence) VALUES($1,$2,$3,'CREATOR','{\"source\":\"LOCAL_LAYOUT_FIXTURE\"}')",
  [user, mint, wallet],
);
const creative = randomUUID(),
  campaign = randomUUID(),
  brief = {
    mint,
    title: "Layout fixture — not submitted",
    coinName: "Layout fixture coin",
    ticker: "EXAMPLE",
    pumpUrl: "https://pump.fun/coin/" + mint,
    website: "https://example.com",
    destinationUrl: "https://example.com/about",
    description: "A private local UI layout fixture. Not a real campaign.",
    objective: "Awareness",
    contactEmail:"layout@example.com",websiteVisible:true,
    creativeId: creative,
    headline: "Our community on the big screen",
    cta: "Learn more",
    disclosure: "Speculative cryptocurrency. No guaranteed returns.",
    qrUrl: "https://example.com/qr",
    targeting: {
      geography: "United States",
      location: "",
      minAge: 21,
      maxAge: 100,
      interests: [],
      devices: [],
    },
    mediaBudgetCents: "5000",
    durationDays: 7,
    proposedStart: "2026-12-01",
    rightsConfirmed: true,
    policyConfirmed: true,
    publicProofConsent: false,
  };
await db.query(
  "INSERT INTO ad_campaigns(id,user_id,mint,title,brief,media_budget_cents,duration_days,proposed_start) VALUES($1,$2,$3,$4,$5,5000,7,'2026-12-01')",
  [campaign, user, mint, brief.title, JSON.stringify(brief)],
);
await db.query(
  "INSERT INTO campaign_creatives(id,user_id,campaign_id,object_path,original_name,mime,bytes,metadata,validation_status) VALUES($1,$2,$3,$4,'local-layout-fixture.mp4','video/mp4',100,'{\"duration\":15,\"width\":1920,\"height\":1080,\"audio\":true}','TECHNICALLY_VALID')",
  [creative, user, campaign, "local-only/" + creative],
);
await writeFile(
  "/tmp/airtime-layout-session.json",
  JSON.stringify({ token, wallet, mint, campaign, creative }),
);
console.log(
  "Isolated layout PostgreSQL listening on 127.0.0.1:5438; use DEMO_MODE=true. Session metadata is only in /tmp/airtime-layout-session.json.",
);
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
