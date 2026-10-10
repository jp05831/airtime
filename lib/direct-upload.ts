// Browser-only transport. No Supabase credentials or server helpers are used.
type Ticket = {
  ticketId: string;
  uploadUrl: string;
  thumbnailUrl: string | null;
  expiresAt: string;
  mime: "video/mp4";
};
export function putSignedFile(
  url: string,
  file: File,
  progress: (bytes: number) => void,
  contentType = file.type,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = false;
    xhr.timeout = 120000;
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) =>
      progress(Math.min(event.loaded, file.size));
    xhr.onerror = () =>
      reject(
        Error(
          "Upload was interrupted. Check your connection and upload again.",
        ),
      );
    xhr.onabort = () =>
      reject(Error("Upload was interrupted. Upload the file again."));
    xhr.ontimeout = () =>
      reject(
        Error("Upload timed out. Check your connection and upload again."),
      );
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        progress(file.size);
        resolve();
      } else if (xhr.status === 413)
        reject(
          Error(
            "The file exceeds the private storage upload limit. Choose a smaller file.",
          ),
        );
      else if ([401, 403].includes(xhr.status))
        reject(
          Error("Your secure upload expired. Upload again for a new ticket."),
        );
      else
        reject(
          Error(
            "The upload could not be completed. Upload again for a new ticket.",
          ),
        );
    };
    xhr.send(file);
  });
}
async function jsonRequest(path: string, body: unknown, method = "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error || "Upload request failed. Try again.");
  return result;
}
export async function uploadCommercial(
  file: File,
  thumbnail: File | null,
  maximum: number,
  progress: (percent: number) => void,
  stage: (message: string) => void,
) {
  const browserMime = file.type.split(";")[0].trim().toLowerCase();
  if (
    browserMime !== "video/mp4" &&
    !(
      (!browserMime || browserMime === "application/octet-stream") &&
      /\.mp4$/i.test(file.name)
    )
  )
    throw Error("Choose an MP4 commercial.");
  // This declaration is only a candidate type. Server byte/container and
  // FFprobe validation remain authoritative, including for renamed files.
  if (file.size > maximum)
    throw Error(
      `Commercial exceeds the ${Math.floor(maximum / 1000000)} MB upload limit.`,
    );
  if (
    thumbnail &&
    (!["image/png", "image/jpeg"].includes(thumbnail.type) ||
      thumbnail.size > 2000000)
  )
    throw Error("Thumbnail must be a PNG/JPEG below 2 MB.");
  stage("Preparing secure upload…");
  const ticket: Ticket = await jsonRequest("/api/creator/upload", {
    name: file.name,
    mime: "video/mp4",
    size: file.size,
    ...(thumbnail
      ? { thumbnail: { mime: thumbnail.type, size: thumbnail.size } }
      : {}),
  });
  const checkExpiry = () => {
    if (Date.now() >= new Date(ticket.expiresAt).getTime())
      throw Error(
        "Upload ticket expired. Upload the file again for a new ticket.",
      );
  };
  let finalizationStarted = false;
  try {
    if (ticket.mime !== "video/mp4")
      throw Error(
        "Secure upload type is invalid. Request a new upload ticket.",
      );
    checkExpiry();
    const total = file.size + (thumbnail?.size || 0);
    stage("Uploading commercial…");
    await putSignedFile(
      ticket.uploadUrl,
      file,
      (bytes) => progress(Math.round((bytes / total) * 100)),
      ticket.mime,
    );
    if (thumbnail) {
      checkExpiry();
      if (!ticket.thumbnailUrl)
        throw Error(
          "Thumbnail upload is unavailable. Request a new upload ticket.",
        );
      stage("Uploading thumbnail…");
      await putSignedFile(ticket.thumbnailUrl, thumbnail, (bytes) =>
        progress(Math.round(((file.size + bytes) / total) * 100)),
      );
    }
    checkExpiry();
    stage("Checking video format…");
    finalizationStarted = true;
    return await jsonRequest("/api/creator/upload/finalize", {
      ticketId: ticket.ticketId,
    });
  } catch (error) {
    // Cancellation never targets an arbitrary object path, and cannot cancel a
    // validating/validated ticket if a finalize response was lost.
    // A finalize attempt consumes the ticket and performs its own cleanup.
    // Do not send a second mutation that would report a misleading 409.
    // The next uploadCommercial call always requests a fresh ticket.
    if (!finalizationStarted)
      await jsonRequest(
        "/api/creator/upload",
        { ticketId: ticket.ticketId },
        "DELETE",
      ).catch(() => {});
    throw error;
  }
}
