import { createClient } from "@supabase/supabase-js";
import { required } from "./config";
export function storage() {
  return createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
      },
    },
  ).storage.from(process.env.SUPABASE_STORAGE_BUCKET || "airtime-proof");
}
export function maxCreativeBytes(){const v=process.env.MAX_CREATIVE_BYTES||"25000000";if(!/^\d+$/.test(v)||Number(v)<1000000||Number(v)>250000000)throw Error("Invalid maximum creative size");return Number(v);}
export function validateUpload(bytes: Buffer, type: string) {
  const maximum = type === "video/mp4" ? maxCreativeBytes() : 10000000;
  if (bytes.length > maximum || bytes.length < 12)
    throw Error("File size invalid");
  const valid =
    type === "application/pdf"
      ? bytes.subarray(0, 5).toString() === "%PDF-"
      : type === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : type === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : type === "video/mp4"
            ? bytes.subarray(4, 8).toString() === "ftyp"
            : false;
  if (
    type === "application/pdf" &&
    /\/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile)\b/i.test(
      bytes.toString("latin1"),
    )
  )
    throw Error("Active PDF content is not allowed");
  if (!valid) throw Error("Only valid PDF, PNG, JPEG or MP4 files are allowed");
  return true;
}
