import { NextResponse } from "next/server";
import { handle, hash } from "@/lib/server/http";
import { db } from "@/lib/server/db";
import { cookieOptions } from "@/lib/server/auth";
export const POST = handle(async (r) => {
  const token = r.cookies.get("airtime_creator")?.value;
  if (token) {
    try {
      await db().query("DELETE FROM creator_sessions WHERE token_hash=$1", [
        hash(token),
      ]);
    } catch {
      console.error(JSON.stringify({ event: "creator_session_revoke_failed" }));
    }
  }
  const response = NextResponse.json({ disconnected: true });
  response.cookies.set("airtime_creator", "", { ...cookieOptions, maxAge: 0 });
  return response;
});
