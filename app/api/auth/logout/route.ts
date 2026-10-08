import { NextResponse } from "next/server";
import { handle } from "@/lib/server/http";
import { cookieOptions, unseal, supabase } from "@/lib/server/auth";
export const POST = handle(async (r) => {
  const value = r.cookies.get("airtime_admin")?.value;
  if (value) {
    try {
      const token = unseal(value),
        client = supabase();
      await client.auth.admin.signOut(token.access, "local");
    } catch {
      /* Always clear local session. */
    }
  }
  const response = NextResponse.json({ signedOut: true });
  for (const name of ["airtime_admin", "airtime_pending"])
    response.cookies.set(name, "", { ...cookieOptions, maxAge: 0 });
  return response;
});
