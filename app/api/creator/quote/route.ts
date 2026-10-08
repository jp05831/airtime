import { z } from "zod";
import { handle, body } from "@/lib/server/http";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import { releaseExpiredQuote } from "@/lib/platform/payments";
import { quoteCampaign } from "@/lib/platform/campaigns";
export const POST = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "quote", 6);
  const v = z
    .object({
      id: z.string().uuid(),
      action: z.literal("release-expired").optional(),
    })
    .parse(await body(r));
  return v.action
    ? releaseExpiredQuote(identity, v.id)
    : quoteCampaign(identity, v.id);
});
