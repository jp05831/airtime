import { NextResponse } from "next/server";
import { handle, rateLimit, HttpError } from "@/lib/server/http";
import { pendingAdmin, seal, cookieOptions } from "@/lib/server/auth";
export const POST = handle(async (r) => {
  await rateLimit("auth:enroll", 5);
  const { client, token } = await pendingAdmin(r);
  const factors = await client.auth.mfa.listFactors();
  if (factors.error)
    throw new HttpError(503, "Authenticator provider unavailable");
  if (factors.data?.totp.some((f) => f.status === "verified"))
    throw new HttpError(409, "An authenticator is already enrolled");
  for (const f of factors.data?.all || [])
    if (f.status === "unverified" && f.factor_type === "totp")
      await client.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "AIRTIME administrator",
  });
  if (error) throw new HttpError(400, "Unable to enroll authenticator");
  const response = NextResponse.json({
    secret: data.totp.secret,
    qr: data.totp.qr_code,
  });
  response.cookies.set(
    "airtime_pending",
    seal({ ...token, factor: data.id }, true),
    { ...cookieOptions, maxAge: 600 },
  );
  return response;
});
