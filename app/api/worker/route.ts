import { handle, authorize, rateLimit } from "@/lib/server/http";
import { runPlatformSync } from "@/lib/platform/worker";
import { runVibeSync } from "@/lib/vibe/workflow";
import { connection } from "@/lib/server/chain";
import { cleanupUploadTickets } from "@/lib/platform/uploads";
export const maxDuration = 30;
export const POST = handle(async (r) => {
  authorize(r, "WORKER_SECRET", "Bearer ");
  await rateLimit("worker", 10);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const results = await Promise.race([
    Promise.allSettled([
      runPlatformSync(connection(3000)),
      runVibeSync(),
      cleanupUploadTickets(),
    ]),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), 25000);
    }),
  ]).finally(() => clearTimeout(timeout));
  if (!results) return { accepted: true, deferred: true, retryOnNextRun: true };
  const [payments, vibe, uploads] = results;
  return {
    payments:
      payments.status === "fulfilled" ? payments.value : { failed: true },
    vibe: vibe.status === "fulfilled" ? vibe.value : { failed: true },
    uploads: uploads.status === "fulfilled" ? uploads.value : { failed: true },
  };
}, false);
