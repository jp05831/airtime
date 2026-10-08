import { z } from "zod";
import { handle, authorize, body, rateLimit } from "@/lib/server/http";
import { queue } from "@/lib/server/chain";
import { signature } from "@/lib/validation";
import { db } from "@/lib/server/db";
export const POST = handle(async (r) => {
  authorize(r, "HELIUS_WEBHOOK_SECRET");
  await rateLimit("webhook", 120);
  const rows = z
    .array(z.object({ signature }).passthrough())
    .min(1)
    .max(100)
    .parse(await body(r));
  let queued = 0;
  for (const item of rows) if (await queue(item.signature, item)) queued++;
  await db().query("UPDATE sync_state SET last_webhook_at=now() WHERE id=true");
  return { accepted: rows.length, queued };
}, false);
