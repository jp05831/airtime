import { handle } from "@/lib/server/http";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import { z } from "zod";
import { VibeClient } from "@/lib/vibe/client";
export const GET = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "catalog", 20);
  const type = z
    .enum(["REGION", "CITY", "METRO"])
    .parse(r.nextUrl.searchParams.get("type"));
  const search = z
    .string()
    .min(2)
    .max(100)
    .parse(r.nextUrl.searchParams.get("search"));
  return new VibeClient().geo(type, search);
}, false);
