import { z } from "zod";
import { handle, body } from "@/lib/server/http";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import { broadcastSigned } from "@/lib/platform/payments";
export const POST = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "broadcast", 5);
  const v = z
    .object({
      id: z.string().uuid(),
      kind: z.enum(["PAYMENT", "CLAIM"]),
      transaction: z.string().min(20).max(2000),
    })
    .parse(await body(r));
  return broadcastSigned(identity, v.id, v.kind, v.transaction);
});
