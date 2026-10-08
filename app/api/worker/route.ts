import { handle, authorize, rateLimit } from "@/lib/server/http";
import { runPlatformSync } from "@/lib/platform/worker";
import { runVibeSync } from "@/lib/vibe/workflow";
export const maxDuration = 300;
export const POST = handle(async (r) => {
  authorize(r, "CRON_SECRET", "Bearer ");
  await rateLimit("worker", 10);
  const [payments, vibe] = await Promise.allSettled([
    runPlatformSync(),
    runVibeSync(),
  ]);
  return {
    payments:
      payments.status === "fulfilled" ? payments.value : { failed: true },
    vibe: vibe.status === "fulfilled" ? vibe.value : { failed: true },
  };
}, false);
export const GET = POST;
