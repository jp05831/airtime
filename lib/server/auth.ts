import { createClient } from "@supabase/supabase-js";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { required } from "./config";
import { HttpError } from "./http";
import { db } from "./db";
export function supabase() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(12000) }),
    },
  });
}
export function seal(value: unknown, pending = false) {
  const key = createHash("sha256")
      .update(required(pending ? "TOTP_ENCRYPTION_KEY" : "AUTH_SECRET"))
      .digest(),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function unseal(
  value: string,
  pending = false,
): { access: string; refresh?: string; expires: number; factor?: string } {
  try {
    const bytes = Buffer.from(value, "base64url"),
      key = createHash("sha256")
        .update(required(pending ? "TOTP_ENCRYPTION_KEY" : "AUTH_SECRET"))
        .digest(),
      decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
    if (!data.access || data.expires < Date.now()) throw Error();
    return data;
  } catch {
    throw new HttpError(401, "Sign in again");
  }
}
export function adminIdentity(
  email: string | undefined,
  aal: string | undefined,
) {
  if (
    !email ||
    email.toLowerCase() !== required("ADMIN_EMAIL").toLowerCase() ||
    aal !== "aal2"
  )
    throw new HttpError(
      403,
      "Administrator authentication and two-factor verification required",
    );
}
export async function requireAdmin(r?: NextRequest) {
  const value = r
    ? r.cookies.get("airtime_admin")?.value
    : (await cookies()).get("airtime_admin")?.value;
  if (!value) throw new HttpError(401, "Administrator login required");
  const token = unseal(value);
  const client = supabase();
  const { data, error } = await client.auth.getUser(token.access);
  if (error || !data.user)
    throw new HttpError(401, "Administrator session expired");
  const claims = JSON.parse(
    Buffer.from(token.access.split(".")[1], "base64url").toString(),
  );
  adminIdentity(data.user.email, claims.aal);
  const { rows } = await db().query(
    "SELECT id,email FROM admin_users WHERE id=$1 AND lower(email)=lower($2)",
    [data.user.id, required("ADMIN_EMAIL")],
  );
  if (!rows[0]) throw new HttpError(403, "Administrator is not provisioned");
  return rows[0] as { id: string; email: string };
}
export async function pendingAdmin(r: NextRequest) {
  const value = r.cookies.get("airtime_pending")?.value;
  if (!value) throw new HttpError(401, "Sign in first");
  const token = unseal(value, true),
    client = supabase();
  const { data, error } = await client.auth.getUser(token.access);
  if (
    error ||
    data.user?.email?.toLowerCase() !== required("ADMIN_EMAIL").toLowerCase()
  )
    throw new HttpError(401, "Sign in again");
  const result = await client.auth.setSession({
    access_token: token.access,
    refresh_token: token.refresh!,
  });
  if (result.error) throw new HttpError(401, "Sign in again");
  return { token, client, user: data.user! };
}
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
