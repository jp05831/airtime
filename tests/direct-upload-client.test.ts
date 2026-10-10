import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { putSignedFile, uploadCommercial } from "@/lib/direct-upload";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

const requests: FakeXHR[] = [];
let failure = "";
class FakeXHR {
  method = "";
  url = "";
  body: unknown;
  status = 200;
  timeout = 0;
  withCredentials = true;
  headers: Record<string, string> = {};
  upload = { onprogress: null as null | ((event: { loaded: number }) => void) };
  onload!: () => void;
  onerror!: () => void;
  onabort!: () => void;
  ontimeout!: () => void;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    requests.push(this);
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send(body: File) {
    this.body = body;
    queueMicrotask(() => {
      if (failure === "network") return this.onerror();
      if (failure === "timeout") return this.ontimeout();
      if (failure === "abort") return this.onabort();
      this.upload.onprogress?.({ loaded: body.size / 2 });
      if (failure) this.status = Number(failure);
      this.onload();
    });
  }
}
const ticket = {
  ticketId: "e0cebe5e-8346-4183-abed-55796d15d140",
  uploadUrl:
    "https://project.supabase.co/storage/v1/object/upload/sign/bucket/video?token=capability",
  thumbnailUrl:
    "https://project.supabase.co/storage/v1/object/upload/sign/bucket/image?token=thumbnail",
  expiresAt: new Date(Date.now() + 900000).toISOString(),
};
beforeEach(() => {
  requests.length = 0;
  failure = "";
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      Response.json(
        path.endsWith("/finalize")
          ? { id: ticket.ticketId, metadata: { width: 1920 } }
          : ticket,
      ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("Browser direct storage transport", () => {
  it("sends raw files only to signed storage and small JSON declarations/identifiers to AIRTIME with visible progress", async () => {
    const file = new File(["video bytes"], "commercial.mp4", {
      type: "video/mp4",
    });
    const thumbnail = new File(["thumbnail bytes"], "thumbnail.png", {
      type: "image/png",
    });
    const progress = vi.fn(),
      stage = vi.fn();
    expect(
      await uploadCommercial(file, thumbnail, 25000000, progress, stage),
    ).toMatchObject({ id: ticket.ticketId });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      method: "PUT",
      url: ticket.uploadUrl,
      body: file,
      withCredentials: false,
      headers: { "Content-Type": "video/mp4", "x-upsert": "false" },
    });
    expect(requests[1]).toMatchObject({
      method: "PUT",
      url: ticket.thumbnailUrl,
      body: thumbnail,
    });
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.map(([path]) => path)).toEqual([
      "/api/creator/upload",
      "/api/creator/upload/finalize",
    ]);
    expect(JSON.parse(String(calls[0][1]!.body))).toEqual({
      name: file.name,
      mime: file.type,
      size: file.size,
      thumbnail: { mime: thumbnail.type, size: thumbnail.size },
    });
    expect(JSON.parse(String(calls[1][1]!.body))).toEqual({
      ticketId: ticket.ticketId,
    });
    for (const [, init] of calls) {
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(typeof init?.body).toBe("string");
      expect(String(init?.body).length).toBeLessThan(4096);
    }
    expect(progress).toHaveBeenLastCalledWith(100);
    expect(
      progress.mock.calls.some(([value]) => value > 0 && value < 100),
    ).toBe(true);
    expect(stage).toHaveBeenLastCalledWith("Checking video format…");
  });
  it.each([
    ["network", "interrupted"],
    ["abort", "interrupted"],
    ["timeout", "timed out"],
    ["413", "limit"],
    ["403", "expired"],
  ])("reports %s and cancels only its ticket", async (mode, message) => {
    failure = mode;
    await expect(
      uploadCommercial(
        new File(["video"], "ad.mp4", { type: "video/mp4" }),
        null,
        25000000,
        vi.fn(),
        vi.fn(),
      ),
    ).rejects.toThrow(message);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    const [path, init] = vi.mocked(fetch).mock.calls[1];
    expect(path).toBe("/api/creator/upload");
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toEqual({
      ticketId: ticket.ticketId,
    });
  });
  it("rejects declared oversized media before issuing a ticket", async () => {
    await expect(
      uploadCommercial(
        new File(["large"], "ad.mp4", { type: "video/mp4" }),
        null,
        1,
        vi.fn(),
        vi.fn(),
      ),
    ).rejects.toThrow("limit");
    expect(fetch).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
  it("does not upload or finalize an expired ticket", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ ...ticket, expiresAt: new Date(0).toISOString() }),
    );
    await expect(
      uploadCommercial(
        new File(["video"], "ad.mp4", { type: "video/mp4" }),
        null,
        25000000,
        vi.fn(),
        vi.fn(),
      ),
    ).rejects.toThrow("expired");
    expect(requests).toHaveLength(0);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([path]) => String(path).endsWith("/finalize")),
    ).toBe(false);
  });
  it("preserves a safe server technical-validation error", async () => {
    vi.mocked(fetch).mockImplementation(async (path) =>
      String(path).endsWith("/finalize")
        ? Response.json(
            { error: "Commercial must be between 5 and 90 seconds" },
            { status: 422 },
          )
        : Response.json(ticket),
    );
    await expect(
      uploadCommercial(
        new File(["video"], "ad.mp4", { type: "video/mp4" }),
        null,
        25000000,
        vi.fn(),
        vi.fn(),
      ),
    ).rejects.toThrow("5 and 90");
  });
  it("allows only the configured storage origin through browser CSP", () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co/path");
    const csp = middleware(
      new NextRequest("http://localhost:3200/creator"),
    ).headers.get("Content-Security-Policy");
    expect(csp).toContain("connect-src 'self' https://project.supabase.co;");
    expect(csp).not.toContain("connect-src *");
    expect(csp).not.toContain("/path");
  });
  it("uses an ephemeral capability without authorization headers", async () => {
    await putSignedFile(
      ticket.uploadUrl,
      new File(["video"], "ad.mp4", { type: "video/mp4" }),
      vi.fn(),
    );
    expect(requests[0].headers).not.toHaveProperty("Authorization");
  });
});
