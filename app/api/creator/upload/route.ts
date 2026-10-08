import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { handle, limitedBytes, HttpError } from "@/lib/server/http";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import { db } from "@/lib/server/db";
import { storage, validateUpload, maxCreativeBytes } from "@/lib/server/uploads";
import {
  FfprobeUnavailableError,
  probeVideo,
} from "@/lib/platform/creative";
import { platformAvailable } from "@/lib/platform/config";
export const maxDuration = 60;
export const POST = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "upload", 6);
  await platformAvailable();
  const bytes = await limitedBytes(r, maxCreativeBytes()+2100000);
  const copy = new NextRequest(r.url, {
    method: "POST",
    headers: r.headers,
    body: bytes,
  });
  const form = await copy.formData(),
    file = form.get("file"),
    thumbnail = form.get("thumbnail");
  if (!(file instanceof File) || file.type !== "video/mp4")
    throw new HttpError(400, "Upload an MP4 commercial");
  let metadata;
  try {
    metadata = await probeVideo(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof FfprobeUnavailableError)
      return NextResponse.json(
        { error: e.message },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    throw new HttpError(400, (e as Error).message);
  }
  const id = randomUUID(),
    path = `creators/${identity.userId}/${id}/commercial.mp4`;
  let thumbPath: null | string = null;
  if (thumbnail instanceof File && thumbnail.size) {
    if (
      !["image/png", "image/jpeg"].includes(thumbnail.type) ||
      thumbnail.size > 2000000
    )
      throw new HttpError(400, "Thumbnail must be a PNG/JPEG below 2 MB");
    try {
      validateUpload(
        Buffer.from(await thumbnail.arrayBuffer()),
        thumbnail.type,
      );
    } catch {
      throw new HttpError(400, "Thumbnail file invalid");
    }
    thumbPath = `creators/${identity.userId}/${id}/thumbnail.${thumbnail.type === "image/png" ? "png" : "jpg"}`;
    const thumbResult = await storage().upload(thumbPath, thumbnail, {
      contentType: thumbnail.type,
      upsert: false,
    });
    if (thumbResult.error) throw Error("Thumbnail storage failed");
  }
  const uploaded = await storage().upload(path, file, {
    contentType: "video/mp4",
    upsert: false,
  });
  if (uploaded.error) throw Error("Creative storage failed");
  try {
    await db().query(
      "INSERT INTO campaign_creatives(id,user_id,object_path,thumbnail_path,original_name,mime,bytes,metadata,validation_status) VALUES($1,$2,$3,$4,$5,'video/mp4',$6,$7,'TECHNICALLY_VALID')",
      [
        id,
        identity.userId,
        path,
        thumbPath,
        file.name.slice(0, 120),
        file.size,
        JSON.stringify(metadata),
      ],
    );
  } catch (e) {
    await storage().remove([path, ...(thumbPath ? [thumbPath] : [])]);
    throw e;
  }
  return {
    id,
    metadata,
    name: file.name.slice(0, 120),
    notice:
      "Technical format checked. Human creative/compliance review is still required.",
  };
});
