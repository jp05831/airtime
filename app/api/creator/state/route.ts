import { handle } from "@/lib/server/http";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import { creatorState } from "@/lib/platform/campaigns";
export const GET = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "state", 30);
  return creatorState(identity, r.nextUrl.searchParams.get("fees") === "true");
}, false);
