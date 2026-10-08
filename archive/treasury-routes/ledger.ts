import { z } from "zod";
import { adminHandler } from "@/lib/server/admin";
import { body } from "@/lib/server/http";
import { classify } from "@/lib/server/campaigns";
export const POST = adminHandler(async (r, a) => {
  const v = z
    .object({
      id: z.string().uuid(),
      kind: z.enum([
        "CREATOR_FEE_COLLECTION",
        "FOUNDER_SEED",
        "TREASURY_DEPOSIT",
        "CAMPAIGN_EXPENDITURE",
        "REFUND",
        "ADMINISTRATIVE_ADJUSTMENT",
        "INTERNAL_TRANSFER",
      ]),
      note: z.string().min(10).max(1000),
      collectionId: z.string().uuid().nullable(),
      refundExpenseId: z.string().uuid().nullable(),
    })
    .parse(await body(r));
  return classify(v, a.id);
});
