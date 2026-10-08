import { z } from "zod";
import { handle, body, rateLimit } from "@/lib/server/http";
import { address } from "@/lib/validation";
import { createChallenge } from "@/lib/platform/auth";
export const POST = handle(async (r) => {
  await rateLimit("wallet-auth:" + r.headers.get("x-forwarded-for"), 10);
  const v = z.object({ wallet: address }).parse(await body(r));
  await rateLimit("challenge-wallet:" + v.wallet, 5);
  return createChallenge(v.wallet);
});
