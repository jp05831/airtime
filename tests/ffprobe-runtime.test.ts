import { expect, it, vi } from "vitest";
import {
  FfprobeUnavailableError,
  probeVideo,
  resolveFfprobePath,
} from "@/lib/platform/creative";

vi.mock("@ffprobe-installer/ffprobe", () => {
  throw Error("Cannot find module '@ffprobe-installer/linux-x64/package.json'");
});

it("allows route imports and an explicit local executable without loading the installer", async () => {
  const { POST } = await import("@/app/api/creator/upload/route");
  expect(typeof POST).toBe("function");
  expect(await resolveFfprobePath("/opt/local/ffprobe")).toBe(
    "/opt/local/ffprobe",
  );
});

it("fails closed with a safe unavailable error if the runtime package is missing", async () => {
  vi.stubEnv("FFPROBE_PATH", "");
  try {
    const bytes = Buffer.alloc(40);
    bytes.write("ftyp", 4);
    await expect(probeVideo(bytes)).rejects.toBeInstanceOf(
      FfprobeUnavailableError,
    );
    await expect(probeVideo(bytes)).rejects.toThrow(
      "Video validation is temporarily unavailable",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
