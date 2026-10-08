import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError } from "@/lib/server/http";
import { requireCreator } from "@/lib/platform/auth";
import { requireAdmin } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/uploads";
export const GET = handle(async (r) => {
  const id = z.string().uuid().parse(r.nextUrl.searchParams.get("id"));
  const row = (
    await db().query(
      "SELECT p.*,c.user_id,c.status,c.public_proof FROM platform_proofs p JOIN ad_campaigns c ON c.id=p.campaign_id WHERE p.id=$1",
      [id],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "Proof not found"); // Receipts remain private even when placement evidence is explicitly published.
  if (!(
    row.kind === "PLACEMENT" &&
    row.status === "COMPLETED" &&
    row.public_proof
  )) {
    let creator = null;
    try {
      creator = await requireCreator(r);
    } catch {}
    if (creator) {
      if (creator.userId !== row.user_id)
        throw new HttpError(404, "Proof not found");
    } else await requireAdmin(r);
  }
  const result = await storage().createSignedUrl(row.object_path, 60, {
    download: row.original_name,
  });
  if (result.error) throw Error("Proof unavailable");
  const response = NextResponse.redirect(result.data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}, false);
