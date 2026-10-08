import { describe, it, expect, beforeEach, vi } from "vitest";
import { VibeClient } from "@/lib/vibe/client";
import { VibeAuthProvider } from "@/lib/vibe/auth";
import { activationGate, vibeConfig } from "@/lib/vibe/config";
import { VIBE_OAUTH_SCOPES } from "@/lib/vibe/auth";
import { resolveSoleAdvertiser } from "@/lib/vibe/advertisers";
import { redact } from "@/lib/server/http";
import { fixedInvoiceAmounts, decimalUnits, exactJSON } from "@/lib/vibe/money";
import { VibeStatusMapper } from "@/lib/vibe/status";
import { verifiedSummary } from "@/lib/vibe/reporting";
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("VIBE_LIVE_MODE", "false");
  vi.stubEnv("VIBE_CLIENT_ID", "synthetic-test-client");
  vi.stubEnv("VIBE_CLIENT_SECRET", "synthetic-test-secret");
  vi.stubEnv("VIBE_ACCOUNT_ID", "123");
  vi.stubEnv("VIBE_ACCESS_TOKEN", "");
  vi.stubEnv("VIBE_ACCESS_TOKEN_EXPIRES_AT", "");
});
describe("Pinned Vibe adapter", () => {
  it("keeps the exact reviewed private-app scope list", () => {
    expect(VIBE_OAUTH_SCOPES).toEqual([
      "advertisers:read",
      "audiences:read",
      "audiences:write",
      "campaigns:read",
      "campaigns:write",
      "campaigns:publish",
      "creatives:read",
      "creatives:write",
      "reporting:read",
      "billing:read",
    ]);
    expect(
      VIBE_OAUTH_SCOPES.some(
        (s: string) =>
          s.startsWith("account:") ||
          s === "advertisers:write" ||
          s.startsWith("impression_tracking:"),
      ),
    ).toBe(false);
  });
  it("calculates exactly $50 media + $10 fee with integer ceiling lamports", () => {
    expect(fixedInvoiceAmounts(100000000n)).toEqual({
      media: 5000n,
      fee: 1000n,
      total: 6000n,
      lamports: 600000000n,
    });
    expect(fixedInvoiceAmounts(123456789n).lamports).toBe(486000005n);
  });
  it("preserves financial JSON numbers without floating point", () => {
    expect(
      exactJSON('{"balance_cents":9007199254740993,"spend":0.125}'),
    ).toEqual({ balance_cents: "9007199254740993", spend: "0.125" });
    expect(decimalUnits("0.003", 9)).toBe(3000000n);
    expect(() => decimalUnits("0.00000001", 6)).toThrow();
  });
  it("refreshes expired OAuth tokens and coalesces concurrent authentication", async () => {
    const transport = vi.fn(async (_u: any, init: any) => {
      expect(init.headers.Authorization.startsWith("Basic ")).toBe(true);
      expect(init.headers["X-Vibe-Revision"]).toBeUndefined();
      const form = new URLSearchParams(String(init.body));
      expect(form.get("grant_type")).toBe("client_credentials");
      expect(form.get("scope")).toBe(
        "advertisers:read audiences:read audiences:write campaigns:read campaigns:write campaigns:publish creatives:read creatives:write reporting:read billing:read",
      );
      expect(form.get("scope")).not.toMatch(
        /account:|advertisers:write|impression_tracking/,
      );
      return new Response(
        JSON.stringify({
          access_token: "synthetic-response",
          token_type: "Bearer",
          expires_in: 60,
        }),
      );
    });
    const auth = new VibeAuthProvider(transport as any);
    await Promise.all([auth.accessToken(), auth.accessToken()]);
    expect(transport).toHaveBeenCalledTimes(1);
    await auth.accessToken(true);
    expect(transport).toHaveBeenCalledTimes(2);
    await auth.accessToken();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("allows a private account-bound live client with blank VIBE_ACCOUNT_ID and the correct client ID key", () => {
    vi.stubEnv("VIBE_LIVE_MODE", "true");
    vi.stubEnv("VIBE_ACCOUNT_ID", "");
    vi.stubEnv("VIBE_CLIENT_ID", "verified-client-id");
    vi.stubEnv("VIBE_CLIENT_SECRET", "verified-client-secret");
    expect(vibeConfig()).toMatchObject({ live: true, accountId: "" });
    vi.stubEnv("VIBE_CLIENT_ID", "");
    expect(() => vibeConfig()).toThrow("configuration is incomplete");
    vi.stubEnv("VIBE_CLIENT_ID", "verified-client-id");
    vi.stubEnv("VIBE_ACCOUNT_ID", "not-an-integer");
    expect(() => vibeConfig()).toThrow("Vibe account ID must be an integer");
  });
  it("does not attach blank account_id to private advertiser reads", async () => {
    const transport = vi.fn(async (u: any, init: any) =>
      String(u).includes("oauth2/token")
        ? new Response(
            JSON.stringify({
              access_token: "fixture-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          )
        : new Response(
            JSON.stringify({
              total: 1,
              data: [
                {
                  id: "12345678-1234-4234-8234-123456789012",
                  name: "AIRTIME",
                  url: "https://airtime.example",
                  industry: "FINANCIAL_SERVICES",
                },
              ],
            }),
          ),
    );
    vi.stubEnv("VIBE_ACCOUNT_ID", "");
    const result = await new VibeClient(transport as any).advertisers();
    expect(result).toHaveLength(1);
    expect(
      new URL(String(transport.mock.calls[1][0])).searchParams.has(
        "account_id",
      ),
    ).toBe(false);
  });
  it("resolves exactly one authorized advertiser and rejects empty or ambiguous access", () => {
    const one = {
      id: "12345678-1234-4234-8234-123456789012",
      name: "AIRTIME",
      url: "https://airtime.example",
      industry: "FINANCIAL_SERVICES",
    };
    expect(resolveSoleAdvertiser([one])).toEqual(one);
    expect(() => resolveSoleAdvertiser([])).toThrow(
      "No Vibe advertiser is authorized",
    );
    expect(() =>
      resolveSoleAdvertiser([
        one,
        { ...one, id: "22345678-1234-4234-8234-123456789012", name: "Other" },
      ]),
    ).toThrow("Multiple Vibe advertisers");
  });
  it("redacts bearer credentials from errors", () => {
    expect(
      redact(new Error("Request failed with Bearer synthetic-secret-token")),
    ).not.toContain("synthetic-secret-token");
  });
  it("pins the revision, isolates account and retries read-only temporary failures", async () => {
    let reads = 0;
    const transport = vi.fn(async (u: any, init: any) => {
      if (String(u).includes("/oauth2/token"))
        return new Response(
          JSON.stringify({
            access_token: "synthetic-response",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        );
      expect(init.headers["X-Vibe-Revision"]).toBe("2026-06-01");
      expect(new URL(String(u)).searchParams.get("account_id")).toBe("123");
      reads++;
      return reads === 1
        ? new Response("", { status: 503 })
        : new Response(
            '{"account_id":123,"balance_cents":100,"currency":"USD"}',
          );
    });
    expect(
      (await new VibeClient(transport as any).balance()).balance_cents,
    ).toBe("100");
    expect(reads).toBe(2);
  });
  it("blocks publishing and activation in prelaunch mode", async () => {
    const transport = vi.fn();
    const client = new VibeClient(transport as any);
    await expect(
      client.publish("12345678-1234-4234-8234-123456789012"),
    ).rejects.toThrow("disabled");
    await expect(
      client.action("12345678-1234-4234-8234-123456789012", "ACTIVATE"),
    ).rejects.toThrow("disabled");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["DAILY", "GLOBAL"])(
    "requires exactly $50 GLOBAL lifetime budget (%s)",
    (type) => {
      const c = new VibeClient();
      expect(() =>
        c.assertBudget({
          budget: 51,
          budget_type: type,
          starts_at: "2030-01-01",
          ends_at: "2030-01-08",
        }),
      ).toThrow();
      if (type === "DAILY")
        expect(() =>
          c.assertBudget({
            budget: 50,
            budget_type: type,
            starts_at: "2030-01-01",
            ends_at: "2030-01-08",
          }),
        ).toThrow();
    },
  );
  it("uses official creative statuses and never invents approval", () => {
    expect(VibeStatusMapper.creative("AUTHORIZED")).toBe(
      "APPROVED_AWAITING_PAYMENT",
    );
    expect(VibeStatusMapper.creative("BLOCKED")).toBe("CREATIVE_REJECTED");
    expect(VibeStatusMapper.creative("PENDING_REVIEW")).toBe(
      "CREATIVE_PENDING",
    );
    expect(() => VibeStatusMapper.creative("APPROVED" as any)).toThrow();
  });
  it("uses only the global live-mode switch", () => {
    expect(activationGate()).toContain("disabled");
    vi.stubEnv("VIBE_LIVE_MODE", "true");
    expect(activationGate()).toBeNull();
  });
  it("rejects foreign advertiser reports and retains unavailable metrics as null", () => {
    expect(() =>
      verifiedSummary([{ campaign_id: "other", advertiser_id: "a" }], "c", "a"),
    ).toThrow();
    expect(
      verifiedSummary([{ campaign_id: "c", advertiser_id: "a" }], "c", "a")
        .spend,
    ).toBeNull();
  });
  it("rejects unsafe signed report download destinations without fetching", async () => {
    const transport = vi.fn();
    await expect(
      new VibeClient(transport as any).reportRows("http://127.0.0.1/private"),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

it("redacts configured Vibe credentials from structured errors", async () => {
  vi.stubEnv("VIBE_CLIENT_SECRET", "synthetic-test-secret");
  const { redact } = await import("@/lib/server/http");
  expect(redact(Error("Provider refused synthetic-test-secret"))).not.toContain(
    "synthetic-test-secret",
  );
});
