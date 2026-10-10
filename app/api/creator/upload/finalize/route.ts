import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import { platformAvailable } from "@/lib/platform/config";
import { FfprobeUnavailableError } from "@/lib/platform/creative";
import {
  finalizeUpload,
  uploadIdentifier,
  uploadJson,
} from "@/lib/platform/uploads";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "finalize-upload", 12);
  await platformAvailable();
  const { ticketId } = uploadIdentifier.parse(await uploadJson(r));
  try {
    return await finalizeUpload(identity, ticketId);
  } catch (error) {
    if (
      error instanceof FfprobeUnavailableError ||
      (error instanceof HttpError && error.status === 503)
    )
      return NextResponse.json(
        { error: error.message },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    throw error;
  }
});
