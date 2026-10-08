import { z } from "zod";
import { handle, body } from "@/lib/server/http";
import { address } from "@/lib/validation";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import { preparePayment, prepareClaim } from "@/lib/platform/payments";
export const POST = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "prepare", 5);
  const v = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("PAYMENT"), id: z.string().uuid() }),
      z.object({
        kind: z.literal("CLAIM"),
        mint: address,
        venue: z.enum(["CURVE", "AMM"]),
      }),
    ])
    .parse(await body(r));
  return v.kind === "PAYMENT"
    ? preparePayment(identity, v.id)
    : prepareClaim(identity, v.mint, v.venue);
});
