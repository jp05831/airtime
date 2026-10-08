import { z } from "zod";
import { handle, body } from "@/lib/server/http";
import { address } from "@/lib/validation";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import { addCoin, discoverCoins } from "@/lib/platform/coins";
import { platformAvailable } from "@/lib/platform/config";
export const POST = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "coins", 6);
  await platformAvailable();
  const v = z.object({ mint: address.optional() }).parse(await body(r));
  if (v.mint) {
    const p = await addCoin(identity, v.mint);
    return { mint: p.mint, role: p.role, venue: p.venue, evidence: p.evidence };
  }
  return discoverCoins(identity);
});
