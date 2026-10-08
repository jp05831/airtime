import { z } from "zod";
import { randomUUID } from "node:crypto";
import { adminHandler } from "@/lib/server/admin";
import { HttpError, limitedBytes } from "@/lib/server/http";
import { storage, validateUpload } from "@/lib/server/uploads";
import { db, transaction } from "@/lib/server/db";
import { audit } from "@/lib/server/campaigns";
export const POST = adminHandler(async (r, a) => {
  if (Number(r.headers.get("content-length") || 0) > 26000000)
    throw new HttpError(413, "File too large");
  if (!r.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new HttpError(400, "Select a supported file");
  const payload = await limitedBytes(r, 26000000);
  let form: FormData;
  try {
    form = await new Response(payload, {
      headers: { "Content-Type": r.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new HttpError(400, "Invalid multipart upload");
  }
  const campaignId = z.string().uuid().parse(form.get("campaignId")),
    kind = z
      .enum(["VIDEO", "RECEIPT", "PLACEMENT", "RESULTS"])
      .parse(form.get("kind")),
    file = form.get("file");
  if (!(file instanceof File) || file.size > 25000000)
    throw new HttpError(400, "Select a supported file");
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    validateUpload(bytes, file.type);
  } catch {
    throw new HttpError(400, "Invalid file type or size");
  }
  if (kind === "VIDEO" && file.type !== "video/mp4")
    throw new HttpError(400, "Video must be MP4");
  const { rows } = await db().query("SELECT id FROM campaigns WHERE id=$1", [
    campaignId,
  ]);
  if (!rows[0]) throw new HttpError(404, "Campaign not found");
  const path = campaignId + "/" + randomUUID();
  const uploaded = await storage().upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (uploaded.error) throw new HttpError(503, "Proof storage unavailable");
  try {
    return await transaction(async (c) => {
      const result = await c.query(
        "INSERT INTO campaign_proof(campaign_id,kind,title,object_path,mime_type) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [
          campaignId,
          kind,
          file.name.replace(/[^a-zA-Z0-9 ._-]/g, "").slice(0, 160),
          path,
          file.type,
        ],
      );
      await audit(
        a.id,
        "UPLOAD_PROOF",
        campaignId,
        { kind, bytes: file.size },
        c,
      );
      return { id: result.rows[0].id };
    });
  } catch (error) {
    await storage().remove([path]);
    throw error;
  }
});
