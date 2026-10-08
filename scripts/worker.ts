import { runVibeSync } from "../lib/vibe/workflow";
import { runPlatformSync } from "../lib/platform/worker";
import { db } from "../lib/server/db";
import { validateProduction } from "../lib/server/config";
import { redact } from "../lib/server/http";
async function main() {
  if (process.env.NODE_ENV === "production") validateProduction();
  console.log(
    JSON.stringify({
      event: "sync_completed",
      result: { payments: await runPlatformSync(), vibe: await runVibeSync() },
    }),
  );
  await db().end();
}
main().catch((e) => {
  console.error(JSON.stringify({ event: "sync_failed", message: redact(e) }));
  process.exitCode = 1;
});
