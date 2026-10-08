import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/uploads";
import { rateLimit } from "@/lib/server/http";
import { z } from "zod";
export async function GET(
  r: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await rateLimit("public:media", 120);
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const { rows } = await db().query(
      "SELECT object_path,mime_type FROM campaign_proof WHERE id=$1",
      [id],
    );
    if (!rows[0]?.object_path)
      return new NextResponse("Not found", { status: 404 });
    const result = await storage().download(rows[0].object_path);
    if (result.error) return new NextResponse("Unavailable", { status: 503 });
    const bytes = Buffer.from(await result.data.arrayBuffer()),
      type = rows[0].mime_type;
    const range = r.headers.get("range");
    if (range && type === "video/mp4") {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : NaN,
        end = match && match[2] ? Number(match[2]) : bytes.length - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        start >= bytes.length
      )
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${bytes.length}` },
        });
      const last = Math.min(end, bytes.length - 1);
      return new NextResponse(bytes.subarray(start, last + 1), {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${last}/${bytes.length}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(last - start + 1),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=60",
        },
      });
    }
    return new NextResponse(bytes, {
      headers: {
        "Content-Type":
          type === "application/pdf" ? "application/octet-stream" : type,
        "Accept-Ranges": "bytes",
        "Content-Length": String(bytes.length),
        "Content-Disposition":
          type === "application/pdf"
            ? 'attachment; filename="campaign-proof.pdf"'
            : "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch {
    return new NextResponse("Unavailable", { status: 503 });
  }
}
