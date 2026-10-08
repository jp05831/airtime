import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, body, rateLimit } from "@/lib/server/http";
import { address, signature } from "@/lib/validation";
import { authenticateWallet, creatorCookie } from "@/lib/platform/auth";
export const POST = handle(async (r) => {
  await rateLimit("wallet-signin:" + r.headers.get("x-forwarded-for"), 10);
  const v = z
    .object({ id: z.string().uuid(), wallet: address, signature })
    .parse(await body(r));
  const session = await authenticateWallet(v.id, v.wallet, v.signature);
  return creatorCookie(
    NextResponse.json({ wallet: session.wallet, userId: session.userId }),
    session.token,
  );
});
