import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffprobe from "@ffprobe-installer/ffprobe";
import { validateUpload } from "@/lib/server/uploads";
export type VideoMetadata = {
  duration: number;
  width: number;
  height: number;
  audio: boolean;
  codec: string;
  audioReview: string;
};
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
  validateUpload(bytes, "video/mp4");
  const directory = await mkdtemp(join(tmpdir(), "airtime-creative-"));
  try {
    const path = join(directory, "creative.mp4");
    await writeFile(path, bytes);
    let result;
    try {
      result = await promisify(execFile)(
        process.env.FFPROBE_PATH ||
          (process.env.NODE_ENV === "production"
            ? (() => {
                throw Error(
                  "Maintained production media validator is not configured",
                );
              })()
            : ffprobe.path),
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
        { timeout: 30000, maxBuffer: 2000000 },
      );
    } catch {
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
    return validateVideoMetadata(metadata);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
