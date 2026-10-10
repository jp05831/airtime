import { handle } from "@/lib/server/http";
import { requireCreator, creatorLimit } from "@/lib/platform/auth";
import { platformAvailable } from "@/lib/platform/config";
import {
  createUploadTicket,
  cancelUpload,
  uploadDeclaration,
  uploadIdentifier,
  uploadJson,
} from "@/lib/platform/uploads";
export const maxDuration = 30;
export const POST = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "upload", 6);
  await platformAvailable();
  return createUploadTicket(
    identity,
    uploadDeclaration.parse(await uploadJson(r)),
  );
});
export const DELETE = handle(async (r) => {
  const identity = await requireCreator(r);
  await creatorLimit(identity, "cancel-upload", 12);
  const { ticketId } = uploadIdentifier.parse(await uploadJson(r));
  return cancelUpload(identity, ticketId);
});
