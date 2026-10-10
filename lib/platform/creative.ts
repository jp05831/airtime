import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, writeFile, rm, open, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maxCreativeBytes } from "@/lib/server/uploads";
export type VideoMetadata = {
  duration: number;
  width: number;
  height: number;
  audio: boolean;
  codec: string;
  audioReview: string;
};
export class FfprobeUnavailableError extends Error {
  constructor() {
    super(
      "Video validation is temporarily unavailable. Please try again later.",
    );
    this.name = "FfprobeUnavailableError";
  }
}
export async function resolveFfprobePath(
  configured = process.env.FFPROBE_PATH,
  bundled?: string,
) {
  if (configured?.trim()) return configured.trim();
  if (bundled !== undefined) return bundled;
  try {
    // Resolve on upload, not when importing the route. Missing runtime packages
    // must reach the controlled unavailable response, including on Vercel.
    const { default: ffprobe } = await import("@ffprobe-installer/ffprobe");
    return ffprobe.path || "";
  } catch {
    throw new FfprobeUnavailableError();
  }
}
async function availableFfprobePath() {
  const path = await resolveFfprobePath();
  if (!path) throw new FfprobeUnavailableError();
  try {
    await access(path, constants.X_OK);
    return path;
  } catch {
    throw new FfprobeUnavailableError();
  }
}
export function validateVideoMetadata(raw: any): VideoMetadata {
  const video = raw.streams?.find((s: any) => s.codec_type === "video"),
    audio = raw.streams?.find((s: any) => s.codec_type === "audio");
  const duration = Number(raw.format?.duration),
    width = Number(video?.width),
    height = Number(video?.height);
  if (!Number.isFinite(duration) || duration < 5 || duration > 90)
    throw Error("Commercial must be between 5 and 90 seconds");
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1280 ||
    height < 720 ||
    width > 3840 ||
    height > 2160 ||
    Math.abs(width / height - 16 / 9) > 0.01
  )
    throw Error("Upload a 16:9 commercial, minimum 1280×720");
  if (
    video.codec_name !== "h264" ||
    !["yuv420p", "yuvj420p"].includes(video.pix_fmt) ||
    !audio ||
    !["aac", "mp3"].includes(audio.codec_name)
  )
    throw Error("An H.264 MP4 with audible AAC/MP3 audio is required");
  if (
    Number(audio.sample_rate) < 44100 ||
    Number(audio.channels) < 1 ||
    Number(audio.channels) > 2
  )
    throw Error("Use 44.1/48 kHz mono or stereo audio");
  const rate = (value: string) => {
    const [n, d = "1"] = String(value).split("/");
    return Number(n) / Number(d);
  };
  const average = rate(video.avg_frame_rate),
    nominal = rate(video.r_frame_rate);
  if (
    ![24, 25, 30, 50, 60, 24000 / 1001, 30000 / 1001, 60000 / 1001].some(
      (f) => Math.abs(f - average) < 0.01,
    ) ||
    Math.abs(average - nominal) > 0.01
  )
    throw Error("Use a supported constant frame rate");
  if (
    !Number.isFinite(Number(video.bit_rate)) ||
    Number(video.bit_rate) < 2500000
  )
    throw Error("Video bitrate must be at least 2,500 kbps");
  const frames = raw.frames?.filter((f: any) => f.media_type === "video");
  if (frames) {
    if (frames.length < 2) throw Error("Video frame timing unavailable");
    for (let i = 1; i < frames.length; i++)
      if (
        Math.abs(
          Number(frames[i].best_effort_timestamp_time) -
            Number(frames[i - 1].best_effort_timestamp_time) -
            1 / average,
        ) > 0.002
      )
        throw Error("Variable frame rate is not supported");
  }
  return {
    duration,
    width,
    height,
    audio: true,
    codec: video.codec_name,
    audioReview:
      "Audio stream present; loudness, audibility, disclosures and prohibited content require human review.",
  };
}
export async function probeVideo(bytes: Buffer) {
  if (bytes.length < 12 || bytes.length > maxCreativeBytes())
    throw Error("File size invalid");
  const directory = await mkdtemp(join(tmpdir(), "airtime-creative-"));
  try {
    const path = join(directory, "creative.mp4");
    await writeFile(path, bytes);
    return await probeVideoFile(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
// Only server-generated temporary paths reach this function. Uploaded videos
// are streamed to disk, never buffered into a function request or a full Blob.
export async function probeVideoFile(path: string, signal?: AbortSignal) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 12 || info.size > maxCreativeBytes())
    throw Error("File size invalid");
  await inspectMp4Container(path, info.size);
  const ffprobePath = await availableFfprobePath();
  let result;
  try {
    result = await promisify(execFile)(
      ffprobePath,
      [
        "-protocol_whitelist",
        "file,pipe",
        "-v",
        "error",
        "-show_streams",
        "-show_frames",
        "-show_entries",
        "frame=media_type,best_effort_timestamp_time:stream:format",
        "-show_format",
        "-of",
        "json",
        path,
      ],
      { timeout: 30000, maxBuffer: 2000000, signal },
    );
  } catch (error) {
    // Spawn errors have string errno codes; a running FFprobe's numeric exit
    // code indicates invalid media and retains the existing validation error.
    if (typeof (error as NodeJS.ErrnoException).code === "string")
      throw new FfprobeUnavailableError();
    throw Error(
      "Unable to read a valid standalone MP4. Re-export and try again.",
    );
  }
  let metadata;
  try {
    metadata = JSON.parse(result.stdout);
  } catch {
    throw Error("Commercial metadata could not be validated");
  }
  if (
    !String(metadata.format?.format_name || "")
      .split(",")
      .includes("mp4")
  )
    throw Error(
      "Commercial is not a recognized MP4 container. Re-export as H.264 MP4.",
    );
  if (
    !Array.isArray(metadata.streams) ||
    !metadata.streams.some((stream: any) => stream.codec_type === "video")
  )
    throw Error(
      "Commercial does not contain a readable video stream. Re-export as H.264 MP4.",
    );
  return validateVideoMetadata(metadata);
}

// Walk bounded top-level ISO BMFF boxes rather than assuming ftyp is at byte 4.
// Leading free/wide boxes and extended-size boxes are valid; malformed sizes,
// truncated boxes, QuickTime-only brands and missing movie/media boxes are not.
async function inspectMp4Container(path: string, size: number) {
  const file = await open(path, "r");
  const invalid = (reason: string): never => {
    throw Error(
      `Commercial MP4 container is invalid: ${reason}. Re-export as H.264 MP4.`,
    );
  };
  try {
    let offset = 0,
      boxes = 0,
      fileType = false,
      movie = false,
      media = false;
    while (offset < size) {
      if (++boxes > 4096) invalid("too many container boxes");
      if (size - offset < 8) invalid("incomplete box header");
      const header = Buffer.alloc(16);
      const read = await file.read(
        header,
        0,
        Math.min(16, size - offset),
        offset,
      );
      if (read.bytesRead < 8) invalid("incomplete download");
      const type = header.toString("ascii", 4, 8);
      const shortSize = header.readUInt32BE(0);
      let boxSize = shortSize,
        headerSize = 8;
      if (shortSize === 1) {
        if (read.bytesRead < 16) invalid("incomplete extended box header");
        const extended = header.readBigUInt64BE(8);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER))
          invalid("invalid box size");
        boxSize = Number(extended);
        headerSize = 16;
      } else if (shortSize === 0) boxSize = size - offset;
      if (boxSize < headerSize || boxSize > size - offset)
        invalid("truncated or invalid box size");
      if (type === "ftyp") {
        const length = boxSize - headerSize;
        if (fileType || length < 8 || length > 4096 || length % 4)
          invalid("invalid file-type signature");
        const brands = Buffer.alloc(length);
        if (
          (await file.read(brands, 0, length, offset + headerSize))
            .bytesRead !== length
        )
          invalid("incomplete file-type signature");
        const compatible = [brands.toString("ascii", 0, 4)];
        for (let at = 8; at < length; at += 4)
          compatible.push(brands.toString("ascii", at, at + 4));
        if (
          !compatible.some((brand) =>
            /^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |MSNV)$/.test(brand),
          )
        )
          invalid("not an MP4 file-type signature");
        fileType = true;
      }
      movie ||= type === "moov";
      media ||= type === "mdat" && boxSize > headerSize;
      offset += boxSize;
    }
    if (!fileType) invalid("missing MP4 file-type signature");
    if (!movie || !media) invalid("missing movie or media data");
  } finally {
    await file.close();
  }
}
