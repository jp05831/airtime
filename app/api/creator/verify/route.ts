import { z } from "zod";
import { handle, body } from "@/lib/server/http";
import { signature } from "@/lib/validation";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import {
  ownedInvoice,
  confirmPayment,
  confirmClaim,
} from "@/lib/platform/payments";
export const POST = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "verify", 15);
  const v = z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("PAYMENT"),
        id: z.string().uuid(),
        signature,
      }),
      z.object({ kind: z.literal("CLAIM"), id: z.string().uuid() }),
    ])
    .parse(await body(r));
  if (v.kind === "CLAIM") return confirmClaim(identity, v.id);
  await ownedInvoice(identity, v.id);
  return confirmPayment(v.id, v.signature);
});
