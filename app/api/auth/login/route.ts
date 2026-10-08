import { z } from "zod";
import { NextResponse } from "next/server";
import { handle, body, rateLimit, HttpError } from "@/lib/server/http";
import { supabase, seal, cookieOptions } from "@/lib/server/auth";
import { required } from "@/lib/server/config";
export const POST = handle(async (r) => {
  await rateLimit("auth:global", 12);
  const v = z
    .object({
      email: z.string().email().max(254),
      password: z.string().min(1).max(200),
    })
    .parse(await body(r));
  await rateLimit("auth:" + v.email.toLowerCase(), 5);
  if (v.email.toLowerCase() !== required("ADMIN_EMAIL").toLowerCase())
    throw new HttpError(401, "Invalid login");
  const client = supabase();
  const { data, error } = await client.auth.signInWithPassword(v);
  if (error || !data.session) throw new HttpError(401, "Invalid login");
  const factors = await client.auth.mfa.listFactors();
  if (factors.error)
    throw new HttpError(401, "Unable to prepare two-factor verification");
  const factor = factors.data.totp.find((f) => f.status === "verified")?.id;
  const response = NextResponse.json({ step: factor ? "verify" : "enroll" });
  response.cookies.set(
    "airtime_pending",
    seal(
      {
        access: data.session.access_token,
        refresh: data.session.refresh_token,
        factor,
        expires: Date.now() + 600000,
      },
      true,
    ),
    { ...cookieOptions, maxAge: 600 },
  );
  return response;
});
