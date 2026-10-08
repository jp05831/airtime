import { adminHandler } from "@/lib/server/admin";
import { body } from "@/lib/server/http";
import { db } from "@/lib/server/db";
import { audit } from "@/lib/server/campaigns";
import { queue } from "@/lib/server/chain";
import { runVibeSync } from "@/lib/vibe/workflow";
import { runPlatformSync } from "@/lib/platform/worker";
import { z } from "zod";
import { signature } from "@/lib/validation";
export const maxDuration = 300;
export const POST = adminHandler(async (r, a) => {
  const v = z.object({ signature: signature.optional() }).parse(await body(r));
  if (v.signature) {
    await queue(v.signature, { source: "ADMIN_RECONCILIATION" });
    await db().query(
      "UPDATE webhook_events w SET attempts=0,status='DETECTED',error=NULL WHERE signature=$1 AND (status='FAILED' OR (status='UNCLASSIFIED' AND NOT EXISTS(SELECT 1 FROM creator_fee_events f WHERE f.signature=w.signature) AND NOT EXISTS(SELECT 1 FROM treasury_transactions t WHERE t.signature=w.signature AND t.advertising_lamports>0)))",
      [v.signature],
    );
  }
  await audit(a.id, "RESYNC_REQUEST", v.signature || "worker", {});
  const [payments, vibe] = await Promise.allSettled([
    runPlatformSync(),
    runVibeSync(),
  ]);
  return {
    payments:
      payments.status === "fulfilled" ? payments.value : { failed: true },
    vibe: vibe.status === "fulfilled" ? vibe.value : { failed: true },
  };
});
