import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { db } from "./db";
import { origin, required } from "./config";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export function redact(error: unknown) {
  let message = error instanceof Error ? error.message : "Operation failed";
  for (const name of [
    "DATABASE_URL",
    "DATABASE_CA_CERT_BASE64",
    "AUTH_SECRET",
    "TOTP_ENCRYPTION_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "HELIUS_API_KEY",
    "HELIUS_WEBHOOK_SECRET",
    "WORKER_SECRET",
    "COINGECKO_API_KEY",
    "VIBE_CLIENT_ID",
    "VIBE_CLIENT_SECRET",
    "VIBE_ACCESS_TOKEN",
  ])
    if (process.env[name])
      message = message.split(process.env[name]!).join("[redacted]");
  return message
    .replace(
      /(?:Bearer|Basic)\s+[A-Za-z0-9+\/=_.-]+/gi,
      "[redacted authorization]",
    )
    .replace(/api-key=[^&\s]+/g, "api-key=[redacted]")
    .slice(0, 400);
}
export function authorize(r: NextRequest, name: string, prefix = "") {
  if (!r.headers.get("authorization")) throw new HttpError(401, "Unauthorized");
  const expected = hash(prefix + required(name)),
    actual = hash(r.headers.get("authorization") || "");
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(actual)))
    throw new HttpError(401, "Unauthorized");
}
const memory = new Map<string, { count: number; until: number }>();
export async function rateLimit(key: string, limit = 20) {
  const id = hash(key);
  if (!process.env.DATABASE_URL) {
    if (memory.size > 1000) memory.clear();
    const old = memory.get(id);
    const item =
      old && old.until > Date.now()
        ? { ...old, count: old.count + 1 }
        : { count: 1, until: Date.now() + 60000 };
    memory.set(id, item);
    if (item.count > limit)
      throw new HttpError(429, "Please try again in one minute");
    return;
  }
  const { rows } = await db().query(
    `INSERT INTO rate_limits(key,count,resets_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.resets_at<now() THEN 1 ELSE rate_limits.count+1 END,resets_at=CASE WHEN rate_limits.resets_at<now() THEN now()+interval '1 minute' ELSE rate_limits.resets_at END RETURNING count`,
    [id],
  );
  if (rows[0].count > limit)
    throw new HttpError(429, "Please try again in one minute");
}
export function handle(fn: (r: NextRequest) => Promise<unknown>, csrf = true) {
  return async (r: NextRequest) => {
    try {
      if (csrf && r.headers.get("origin") !== origin())
        throw new HttpError(403, "Invalid request origin");
      const data = await fn(r);
      return data instanceof NextResponse
        ? data
        : NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const status =
        error instanceof ZodError
          ? 400
          : error instanceof HttpError
            ? error.status
            : 500;
      if (status >= 500)
        console.error(
          JSON.stringify({ event: "request_failed", message: redact(error) }),
        );
      return NextResponse.json(
        {
          error:
            status >= 500
              ? "Service is not configured or temporarily unavailable."
              : status === 400
                ? "Check the submitted values."
                : (error as Error).message,
        },
        { status },
      );
    }
  };
}
export async function limitedBytes(r: NextRequest, limit: number) {
  if (Number(r.headers.get("content-length") || 0) > limit)
    throw new HttpError(413, "Request too large");
  const reader = r.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(413, "Request too large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } finally {
    reader.releaseLock();
  }
}
export async function body(r: NextRequest) {
  const text = (await limitedBytes(r, 1000000)).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
