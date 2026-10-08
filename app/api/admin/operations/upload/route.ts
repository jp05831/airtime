import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminHandler } from "@/lib/server/admin";
import { limitedBytes, HttpError } from "@/lib/server/http";
import { db } from "@/lib/server/db";
import { storage, validateUpload } from "@/lib/server/uploads";
import { logOperation } from "@/lib/platform/campaigns";
export const POST = adminHandler(async (r, a) => {
  const bytes = await limitedBytes(r, 11000000),
    form = await new NextRequest(r.url, {
      method: "POST",
      headers: r.headers,
      body: bytes,
    }).formData();
  const id = z.string().uuid().parse(form.get("id")),
    kind = z.enum(["APPROVAL", "PLACEMENT", "RECEIPT"]).parse(form.get("kind")),
    file = form.get("file");
  if (
    !(file instanceof File) ||
    !["application/pdf", "image/png", "image/jpeg"].includes(file.type)
  )
    throw new HttpError(400, "Upload a PDF/PNG/JPEG proof");
  try {
    validateUpload(Buffer.from(await file.arrayBuffer()), file.type);
  } catch {
    throw new HttpError(400, "Proof file invalid");
  }
  if (
    !(await db().query("SELECT id FROM ad_campaigns WHERE id=$1", [id]))
      .rowCount
  )
    throw new HttpError(404, "Campaign not found");
  const proofId = randomUUID(),
    path = `operations/${id}/${proofId}`;
  const result = await storage().upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (result.error) throw Error("Storage unavailable");
  await db().query(
    "INSERT INTO platform_proofs(id,campaign_id,kind,object_path,mime,original_name,admin_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [proofId, id, kind, path, file.type, file.name.slice(0, 120), a.id],
  );
  await logOperation(a.id, "PROOF_UPLOAD", id, { proofId, kind });
  return { id: proofId };
});
