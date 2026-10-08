import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError } from "@/lib/server/http";
import { requireCreator } from "@/lib/platform/auth";
import { requireAdmin } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/uploads";
export const GET = handle(async (r) => {
  const id = z.string().uuid().parse(r.nextUrl.searchParams.get("id"));
  let userId: string | null = null;
  try {
    userId = (await requireCreator(r)).userId;
  } catch {
    await requireAdmin(r);
  }
  const { rows } = userId
    ? await db().query(
        "SELECT object_path,thumbnail_path FROM campaign_creatives WHERE id=$1 AND user_id=$2",
        [id, userId],
      )
    : await db().query(
        "SELECT object_path,thumbnail_path FROM campaign_creatives WHERE id=$1",
        [id],
      );
  if (!rows[0]) throw new HttpError(404, "Creative not found");
  const path =
    r.nextUrl.searchParams.get("thumbnail") === "true"
      ? rows[0].thumbnail_path
      : rows[0].object_path;
  if (!path) throw new HttpError(404, "Thumbnail not supplied");
  const result = await storage().createSignedUrl(path, 60);
  if (result.error) throw Error("Storage unavailable");
  const response = NextResponse.redirect(result.data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}, false);
