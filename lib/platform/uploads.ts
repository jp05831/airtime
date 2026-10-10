import { randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { db, transaction } from "@/lib/server/db";
import { HttpError, limitedBytes } from "@/lib/server/http";
import type { NextRequest } from "next/server";
import { required } from "@/lib/server/config";
import {
  maxCreativeBytes,
  privateUploadStorage,
  storageBucket,
  validateUpload,
} from "@/lib/server/uploads";
import { FfprobeUnavailableError, probeVideoFile } from "./creative";
import type { CreatorIdentity } from "./model";

export const uploadDeclaration = z
  .object({
    name: z.string().min(1).max(120),
    mime: z.literal("video/mp4"),
    size: z.number().int().safe().min(12),
    thumbnail: z
      .object({
        mime: z.enum(["image/png", "image/jpeg"]),
        size: z.number().int().safe().min(12),
      })
      .strict()
      .optional(),
  })
  .strict();
export const uploadIdentifier = z
  .object({ ticketId: z.string().uuid() })
  .strict();
export async function uploadJson(r: NextRequest) {
  if (
    r.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
  )
    throw new HttpError(
      415,
      "Commercials must upload directly to private storage. Refresh AIRTIME and try again.",
    );
  const bytes = await limitedBytes(r, 4096);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new HttpError(400, "Upload request is invalid.");
  }
}
const TICKET_MS = 15 * 60 * 1000;
// Supabase signed upload URLs have a provider-controlled two-hour lifetime.
// Keep tombstones past token expiry so late uploads cannot escape cleanup.
const TOKEN_CLEANUP_MS = (2 * 60 + 10) * 60 * 1000;
type Bucket = Awaited<ReturnType<typeof privateUploadStorage>>;
type Ticket = {
  id: string;
  user_id: string;
  wallet: string;
  bucket: string;
  object_path: string;
  final_object_path: string;
  thumbnail_path: string | null;
  final_thumbnail_path: string | null;
  original_name: string;
  declared_mime: string;
  declared_bytes: string;
  max_bytes: string;
  thumbnail_mime: string | null;
  thumbnail_bytes: string | null;
  status: string;
  expires_at: Date;
  cleanup_after: Date;
};
function signedUrl(
  value: string,
  bucket: string,
  path: string,
  upload: boolean,
) {
  const url = new URL(value),
    base = new URL(required("SUPABASE_URL"));
  const expected = `/storage/v1/object/${upload ? "upload/sign" : "sign"}/${encodeURIComponent(bucket)}/${path}`;
  if (
    url.origin !== base.origin ||
    url.pathname !== expected ||
    !url.searchParams.get("token")
  )
    throw new HttpError(
      503,
      "Private upload storage is temporarily unavailable.",
    );
  return url.toString();
}
function paths(ticket: Ticket, includeFinal: boolean) {
  return [
    ticket.object_path,
    ticket.thumbnail_path,
    ...(includeFinal
      ? [ticket.final_object_path, ticket.final_thumbnail_path]
      : []),
  ].filter((p): p is string => !!p);
}
async function removeObjects(
  bucket: Bucket,
  ticket: Ticket,
  includeFinal: boolean,
) {
  const result = await bucket.remove(paths(ticket, includeFinal));
  if (result.error)
    throw new HttpError(503, "Upload cleanup is temporarily unavailable.");
}
export async function createUploadTicket(
  identity: CreatorIdentity,
  input: z.infer<typeof uploadDeclaration>,
) {
  input = uploadDeclaration.parse(input);
  const maximum = maxCreativeBytes();
  if (input.size > maximum)
    throw new HttpError(
      413,
      `Commercial exceeds the ${Math.floor(maximum / 1000000)} MB upload limit.`,
    );
  if (input.thumbnail && input.thumbnail.size > 2000000)
    throw new HttpError(413, "Thumbnail must be below 2 MB.");
  const bucketName = storageBucket();
  const bucket = await privateUploadStorage(
    bucketName,
    AbortSignal.timeout(25000),
  );
  const id = randomUUID(),
    now = Date.now(),
    expires = new Date(now + TICKET_MS);
  const prefix = `creators/${identity.userId}/`,
    pending = `${prefix}pending/${id}/`,
    final = `${prefix}${id}/`;
  const thumbnail = input.thumbnail
    ? `thumbnail.${input.thumbnail.mime === "image/png" ? "png" : "jpg"}`
    : null;
  const { rows } = await db().query(
    `INSERT INTO creative_upload_tickets(id,user_id,wallet,bucket,object_path,final_object_path,thumbnail_path,final_thumbnail_path,original_name,declared_mime,declared_bytes,max_bytes,thumbnail_mime,thumbnail_bytes,expires_at,cleanup_after,next_cleanup_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$15) RETURNING *`,
    [
      id,
      identity.userId,
      identity.wallet,
      bucketName,
      pending + "commercial.mp4",
      final + "commercial.mp4",
      thumbnail ? pending + thumbnail : null,
      thumbnail ? final + thumbnail : null,
      input.name,
      input.mime,
      input.size,
      maximum,
      input.thumbnail?.mime ?? null,
      input.thumbnail?.size ?? null,
      expires,
      new Date(now + TOKEN_CLEANUP_MS),
    ],
  );
  const ticket: Ticket = rows[0];
  try {
    const video = await bucket.createSignedUploadUrl(ticket.object_path, {
      upsert: false,
    });
    if (video.error || !video.data) throw Error("Signing failed");
    let thumbnailUrl: string | null = null;
    if (ticket.thumbnail_path) {
      const result = await bucket.createSignedUploadUrl(ticket.thumbnail_path, {
        upsert: false,
      });
      if (result.error || !result.data) throw Error("Signing failed");
      thumbnailUrl = signedUrl(
        result.data.signedUrl,
        bucketName,
        ticket.thumbnail_path,
        true,
      );
    }
    return {
      ticketId: id,
      expiresAt: expires.toISOString(),
      maxBytes: maximum,
      uploadUrl: signedUrl(
        video.data.signedUrl,
        bucketName,
        ticket.object_path,
        true,
      ),
      thumbnailUrl,
    };
  } catch {
    await db().query(
      "UPDATE creative_upload_tickets SET status='REJECTED',completed_at=now(),next_cleanup_at=now() WHERE id=$1 AND status='ISSUED'",
      [id],
    );
    throw new HttpError(
      503,
      "Private upload storage is temporarily unavailable. Try uploading again.",
    );
  }
}

async function downloadToFile(
  bucket: Bucket,
  ticket: Ticket,
  path: string,
  mime: string,
  declared: number,
  limit: number,
  destination: string,
  signal: AbortSignal,
) {
  const info = await bucket.info(path);
  if (info.error || !info.data)
    throw new HttpError(
      409,
      "Upload is incomplete or interrupted. Upload the file again.",
    );
  const size = info.data.size;
  if (!Number.isSafeInteger(size) || size! < 12 || size! > limit)
    throw new HttpError(
      413,
      "The stored file exceeds the upload limit or has an invalid size.",
    );
  if (size !== declared)
    throw new HttpError(
      422,
      "Uploaded file size does not match the upload ticket. Upload it again.",
    );
  if (info.data.contentType?.split(";")[0].trim().toLowerCase() !== mime)
    throw new HttpError(
      422,
      "Uploaded file type does not match the upload ticket.",
    );
  const signed = await bucket.createSignedUrl(path, 60);
  if (signed.error || !signed.data)
    throw new HttpError(
      503,
      "Private upload storage is temporarily unavailable.",
    );
  let response: Response;
  try {
    response = await fetch(
      signedUrl(signed.data.signedUrl, ticket.bucket, path, false),
      {
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      },
    );
  } catch {
    throw new HttpError(
      408,
      "Upload verification was interrupted. Upload the file again.",
    );
  }
  if (!response.ok || !response.body)
    throw new HttpError(
      409,
      "Upload is incomplete or interrupted. Upload the file again.",
    );
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) ||
      Number(length) > limit ||
      Number(length) !== declared)
  ) {
    await response.body.cancel();
    throw new HttpError(
      Number(length) > limit ? 413 : 422,
      "Stored file size is invalid. Upload the file again.",
    );
  }
  if (
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    mime
  ) {
    await response.body.cancel();
    throw new HttpError(
      422,
      "Stored file type is invalid. Upload the file again.",
    );
  }
  const reader = response.body.getReader();
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let actual = 0;
  try {
    file = await open(destination, "wx");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      actual += value.byteLength;
      if (actual > limit || actual > declared)
        throw new HttpError(
          413,
          "The actual uploaded file exceeds its upload limit.",
        );
      // FileHandle.write can write fewer bytes than requested.
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await file.write(
          value,
          offset,
          value.byteLength - offset,
        );
        if (!bytesWritten) throw Error("Temporary file write failed");
        offset += bytesWritten;
      }
    }
    if (actual !== declared || actual !== size)
      throw new HttpError(
        422,
        "Upload is incomplete or interrupted. Upload the file again.",
      );
    return actual;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      408,
      "Upload verification was interrupted. Upload the file again.",
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await file?.close();
  }
}

export async function finalizeUpload(
  identity: CreatorIdentity,
  ticketId: string,
) {
  z.string().uuid().parse(ticketId);
  const claim = await db().query(
    "UPDATE creative_upload_tickets SET status='VALIDATING',claimed_at=now() WHERE id=$1 AND user_id=$2 AND wallet=$3 AND status='ISSUED' AND expires_at>now() RETURNING *",
    [ticketId, identity.userId, identity.wallet],
  );
  const ticket: Ticket | undefined = claim.rows[0];
  if (!ticket) {
    const { rows } = await db().query(
      "SELECT status,expires_at FROM creative_upload_tickets WHERE id=$1 AND user_id=$2 AND wallet=$3",
      [ticketId, identity.userId, identity.wallet],
    );
    if (!rows[0]) throw new HttpError(404, "Upload ticket not found.");
    if (
      rows[0].status === "EXPIRED" ||
      (rows[0].status === "ISSUED" &&
        new Date(rows[0].expires_at).getTime() <= Date.now())
    )
      throw new HttpError(
        410,
        "Upload ticket expired. Upload the file again for a new ticket.",
      );
    throw new HttpError(
      409,
      "This upload ticket is already being processed or has been used. Request a new ticket.",
    );
  }
  const signal = AbortSignal.timeout(50000);
  let directory: string | undefined, bucket: Bucket | undefined;
  try {
    bucket = await privateUploadStorage(ticket.bucket, signal);
    directory = await mkdtemp(join(tmpdir(), "airtime-upload-"));
    const path = join(directory, "commercial.mp4");
    const size = await downloadToFile(
      bucket,
      ticket,
      ticket.object_path,
      ticket.declared_mime,
      Number(ticket.declared_bytes),
      Math.min(Number(ticket.max_bytes), maxCreativeBytes()),
      path,
      signal,
    );
    const metadata = await probeVideoFile(path, signal);
    if (ticket.thumbnail_path) {
      const thumb = join(directory, "thumbnail");
      await downloadToFile(
        bucket,
        ticket,
        ticket.thumbnail_path,
        ticket.thumbnail_mime!,
        Number(ticket.thumbnail_bytes),
        2000000,
        thumb,
        signal,
      );
      validateUpload(await readFile(thumb), ticket.thumbnail_mime!);
    }
    // Signed upload tokens can only write pending paths. Validated paths are
    // immutable to that token, even if an original upload is replayed later.
    const copy = await bucket.copy(
      ticket.object_path,
      ticket.final_object_path,
    );
    if (copy.error)
      throw new HttpError(
        503,
        "Could not publish the validated commercial. Upload it again.",
      );
    if (ticket.thumbnail_path) {
      const copy = await bucket.copy(
        ticket.thumbnail_path,
        ticket.final_thumbnail_path!,
      );
      if (copy.error)
        throw new HttpError(
          503,
          "Could not publish the validated thumbnail. Upload it again.",
        );
    }
    await transaction(async (c) => {
      const row = (
        await c.query(
          "SELECT status FROM creative_upload_tickets WHERE id=$1 AND user_id=$2 AND wallet=$3 FOR UPDATE",
          [ticketId, identity.userId, identity.wallet],
        )
      ).rows[0];
      if (row?.status !== "VALIDATING")
        throw new HttpError(
          409,
          "Upload validation expired. Upload the file again.",
        );
      await c.query(
        "INSERT INTO campaign_creatives(id,user_id,object_path,thumbnail_path,original_name,mime,bytes,metadata,validation_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'TECHNICALLY_VALID')",
        [
          ticketId,
          identity.userId,
          ticket.final_object_path,
          ticket.final_thumbnail_path,
          ticket.original_name,
          ticket.declared_mime,
          size,
          JSON.stringify(metadata),
        ],
      );
      await c.query(
        "UPDATE creative_upload_tickets SET status='VALIDATED',creative_id=$1,completed_at=now() WHERE id=$1 AND status='VALIDATING'",
        [ticketId],
      );
    });
    return {
      id: ticketId,
      metadata,
      name: ticket.original_name,
      notice:
        "Technical format checked. Human creative/compliance review is still required.",
    };
  } catch (error) {
    // Do not delete a committed creative if the database's commit response was
    // lost. Only the winning transition to REJECTED may remove final paths.
    const rejected = await db().query(
      "UPDATE creative_upload_tickets SET status='REJECTED',completed_at=now(),next_cleanup_at=now() WHERE id=$1 AND status='VALIDATING' RETURNING id",
      [ticketId],
    );
    if (rejected.rows.length && bucket)
      await removeObjects(bucket, ticket, true).catch(() => {});
    if (error instanceof HttpError || error instanceof FfprobeUnavailableError)
      throw error;
    throw new HttpError(
      422,
      error instanceof Error &&
        /^(Commercial|Upload a 16:9|An H\.264|Use |Video |Variable frame|Unable to read|File size|Only valid)/.test(
          error.message,
        )
        ? error.message
        : "Commercial could not be technically validated. Re-export the video and upload it again.",
    );
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export async function cancelUpload(
  identity: CreatorIdentity,
  ticketId: string,
) {
  const { rows } = await db().query(
    "UPDATE creative_upload_tickets SET status='REJECTED',completed_at=now(),next_cleanup_at=now() WHERE id=$1 AND user_id=$2 AND wallet=$3 AND status='ISSUED' RETURNING *",
    [ticketId, identity.userId, identity.wallet],
  );
  if (!rows[0])
    throw new HttpError(409, "Upload ticket is unavailable or already used.");
  const ticket: Ticket = rows[0];
  const bucket = await privateUploadStorage(
    ticket.bucket,
    AbortSignal.timeout(8000),
  );
  await removeObjects(bucket, ticket, true).catch(() => {});
  return { cancelled: true };
}

export async function cleanupUploadTickets() {
  const { rows } = await db().query(`WITH due AS (
    SELECT id FROM creative_upload_tickets WHERE cleaned_at IS NULL AND next_cleanup_at<=now()
      AND (cleanup_lease_until IS NULL OR cleanup_lease_until<=now())
      AND (status<>'VALIDATING' OR claimed_at<now()-interval '5 minutes')
    ORDER BY next_cleanup_at LIMIT 10 FOR UPDATE SKIP LOCKED
  ) UPDATE creative_upload_tickets t SET cleanup_lease_until=now()+interval '1 minute',
      status=CASE WHEN status='ISSUED' THEN 'EXPIRED' WHEN status='VALIDATING' THEN 'REJECTED' ELSE status END
    FROM due WHERE t.id=due.id RETURNING t.*`);
  if (!rows.length) return { cleaned: 0 };
  // One bounded Storage delete request per bucket, not one request per object.
  let cleaned = 0;
  for (const bucketName of new Set(rows.map((r) => r.bucket))) {
    const tickets = rows.filter((r) => r.bucket === bucketName) as Ticket[];
    try {
      const bucket = await privateUploadStorage(
        bucketName,
        AbortSignal.timeout(8000),
      );
      const result = await bucket.remove(
        tickets.flatMap((ticket) =>
          paths(ticket, ticket.status !== "VALIDATED"),
        ),
      );
      if (result.error) throw Error("Cleanup unavailable");
      await db().query(
        "UPDATE creative_upload_tickets SET cleaned_at=CASE WHEN cleanup_after<=now() THEN now() ELSE NULL END,next_cleanup_at=CASE WHEN cleanup_after<=now() THEN now() ELSE cleanup_after END,cleanup_lease_until=NULL WHERE id=ANY($1::uuid[])",
        [tickets.map((ticket) => ticket.id)],
      );
      cleaned += tickets.length;
    } catch {
      await db().query(
        "UPDATE creative_upload_tickets SET next_cleanup_at=now()+interval '5 minutes',cleanup_lease_until=NULL WHERE id=ANY($1::uuid[])",
        [tickets.map((ticket) => ticket.id)],
      );
    }
  }
  return { cleaned };
}
