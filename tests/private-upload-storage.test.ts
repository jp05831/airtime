import { afterEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ getBucket: vi.fn(), from: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ storage }) }));
import { privateUploadStorage } from "@/lib/server/uploads";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
it("fails closed when private storage is public, missing, or changed", async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-test-key");
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", "airtime-proof");
  for (const response of [
    { data: { public: true }, error: null },
    { data: null, error: Error("missing") },
  ]) {
    storage.getBucket.mockResolvedValue(response);
    await expect(privateUploadStorage()).rejects.toMatchObject({ status: 503 });
  }
  await expect(privateUploadStorage("another-bucket")).rejects.toMatchObject({
    status: 503,
  });
  expect(storage.from).not.toHaveBeenCalled();
  storage.getBucket.mockResolvedValue({ data: { public: false }, error: null });
  storage.from.mockReturnValue({ private: true });
  expect(await privateUploadStorage()).toEqual({ private: true });
});
