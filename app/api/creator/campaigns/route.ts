import { z } from "zod";
import { handle, body } from "@/lib/server/http";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import {
  saveCampaign,
  submitForReview,
  ownedCampaign,
  logOperation,
} from "@/lib/platform/campaigns";
import { db } from "@/lib/server/db";
export const POST = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "campaign", 20);
  const v = await body(r);
  if (v.action === "submit") {
    const { id } = z.object({ id: z.string().uuid() }).parse(v);
    return submitForReview(identity, id);
  }
  if (v.action === "message") {
    const m = z
      .object({
        id: z.string().uuid(),
        message: z.string().trim().min(1).max(3000),
      })
      .parse(v);
    await ownedCampaign(identity, m.id);
    await db().query(
      "INSERT INTO creator_messages(campaign_id,sender,body) VALUES($1,$2,$3)",
      [m.id, identity.wallet, m.message],
    );
    await logOperation(identity.wallet, "CREATOR_MESSAGE", m.id, {});
    return { sent: true };
  }
  return saveCampaign(identity, v);
});
