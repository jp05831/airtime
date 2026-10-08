import { z } from "zod";
import { NextResponse } from "next/server";
import { handle, body, rateLimit, HttpError } from "@/lib/server/http";
import {
  pendingAdmin,
  seal,
  cookieOptions,
  adminIdentity,
} from "@/lib/server/auth";
import { db } from "@/lib/server/db";
export const POST = handle(async (r) => {
  await rateLimit("auth:totp", 8);
  const { code } = z
    .object({ code: z.string().regex(/^\d{6}$/) })
    .parse(await body(r));
  const { client, token, user } = await pendingAdmin(r);
  if (!token.factor) throw new HttpError(400, "Enroll an authenticator first");
  const { data, error } = await client.auth.mfa.challengeAndVerify({
    factorId: token.factor,
    code,
  });
  if (error) throw new HttpError(401, "Invalid authenticator code");
  const claims = JSON.parse(
    Buffer.from(data.access_token.split(".")[1], "base64url").toString(),
  );
  adminIdentity(user.email, claims.aal);
  await db().query(
    "INSERT INTO admin_users(id,email,last_login_at) VALUES($1,$2,now()) ON CONFLICT(id) DO UPDATE SET last_login_at=now()",
    [user.id, user.email],
  );
  await db().query(
    "INSERT INTO audit_logs(admin_id,action) VALUES($1,'LOGIN_MFA_VERIFIED')",
    [user.id],
  );
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(
    "airtime_admin",
    seal({
      access: data.access_token,
      expires: Date.now() + Math.min(data.expires_in, 3600) * 1000,
    }),
    { ...cookieOptions, maxAge: Math.min(data.expires_in, 3600) },
  );
  response.cookies.set("airtime_pending", "", { ...cookieOptions, maxAge: 0 });
  return response;
});
