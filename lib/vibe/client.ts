import { z } from "zod";
import { VibeAuthProvider, type Transport } from "./auth";
import { vibeConfig } from "./config";
import { exactJSON } from "./money";
export class VibeError extends Error {
  constructor(
    public status: number,
    public ambiguous = false,
  ) {
    super(
      status === 401 || status === 403
        ? "Vibe authorization failed"
        : "Vibe request unavailable; verification/retry required",
    );
  }
}
const uuid = z.string().uuid();
export const advertiserSchema = z
  .object({ id: uuid, name: z.string(), url: z.string(), industry: z.string() })
  .passthrough();
export const creativeSchema = z
  .object({
    id: uuid,
    advertiser_id: uuid,
    name: z.string(),
    approval_status: z.enum([
      "PROCESSING",
      "PENDING_REVIEW",
      "AUTHORIZED",
      "BLOCKED",
    ]),
    approval_details: z.string().nullable(),
  })
  .passthrough();
export const campaignSchema = z
  .object({
    id: uuid,
    advertiser_id: uuid,
    name: z.string(),
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED", "DELETED"]),
    state: z
      .enum([
        "ARCHIVED",
        "BLOCKED",
        "COMPLETED",
        "DELIVERING",
        "INACTIVE",
        "PAUSED",
        "PAYMENT_ISSUE",
        "PENDING_REVIEW",
        "UPCOMING",
      ])
      .nullable(),
    active: z.boolean(),
  })
  .passthrough();
export const strategySchema = z
  .object({
    id: uuid,
    campaign_id: uuid,
    name: z.string(),
    budget: z.coerce.number().int().safe(),
    budget_type: z.enum(["DAILY", "GLOBAL"]),
    active: z.boolean(),
    starts_at: z.string(),
    ends_at: z.string().nullable(),
    creative_ids: z.array(uuid),
    targeting: z.record(z.unknown()),
    state: z.enum(["AUTHORIZED", "BLOCKED", "PENDING_REVIEW"]).nullable(),
  })
  .passthrough();
export type VibeCreative = z.infer<typeof creativeSchema>;
export type VibeCampaign = z.infer<typeof campaignSchema>;
export type VibeStrategy = z.infer<typeof strategySchema>;
export type StrategyOrder = {
  campaign_id: string;
  name: string;
  budget: 50;
  budget_type: "GLOBAL";
  starts_at: string;
  ends_at: string;
  active: boolean;
  creative_ids: string[];
  targeting: Record<string, unknown>;
};
export class VibeClient {
  private deadline = Date.now() + 150000;
  readonly auth: VibeAuthProvider;
  constructor(
    private transport: Transport = fetch,
    private mock = false,
  ) {
    if (mock && process.env.NODE_ENV !== "test")
      throw Error("Mock transport is forbidden outside automated tests");
    this.auth = new VibeAuthProvider(transport);
  }
  private assertWrite() {
    if (!this.mock && !vibeConfig().live)
      throw Error("Vibe live mode disabled: external mutations are blocked");
  }
  async request(
    path: string,
    method = "GET",
    payload?: unknown,
    catalog = false,
  ): Promise<any> {
    if (Date.now() > this.deadline)
      throw Error("Vibe synchronization time limit reached");
    if (
      path.endsWith("/publish") ||
      (path.endsWith("/actions") && (payload as any)?.action === "ACTIVATE")
    )
      this.assertWrite();
    const config = vibeConfig();
    const url = new URL(path, config.base);
    if (url.origin !== config.base || !path.startsWith("/"))
      throw Error("Invalid Vibe endpoint");
    if (config.accountId && !catalog)
      url.searchParams.set("account_id", config.accountId);
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.transport(url, {
          method,
          headers: {
            Authorization: "Bearer " + (await this.auth.accessToken()),
            "X-Vibe-Revision": config.revision,
            "Content-Type": "application/json",
          },
          body: payload === undefined ? undefined : JSON.stringify(payload),
          signal: AbortSignal.timeout(12000),
          redirect: "error",
        });
      } catch {
        throw new VibeError(0, method !== "GET");
      }
      if (response.status === 401 && attempt === 0) {
        await this.auth.accessToken(true);
        continue;
      }
      if (!response.ok) {
        if (
          method === "GET" &&
          (response.status === 429 || response.status >= 500) &&
          attempt < 2
        ) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          continue;
        }
        throw new VibeError(
          response.status,
          method !== "GET" && response.status >= 500,
        );
      }
      const text = await response.text();
      if (text.length > 2000000) throw new VibeError(502, method !== "GET");
      try {
        return text ? exactJSON(text) : {};
      } catch {
        throw new VibeError(502, method !== "GET");
      }
    }
    throw new VibeError(401);
  }
  async list<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const results: T[] = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const url =
        path + (path.includes("?") ? "&" : "?") + "limit=100&offset=" + offset;
      const p = await this.request(url),
        total = Number(p.total);
      if (!Array.isArray(p.data) || !Number.isSafeInteger(total) || total < 0)
        throw Error("Invalid Vibe paginated response");
      results.push(...p.data.map((r: unknown) => schema.parse(r)));
      if (results.length >= total) return results;
      if (!p.data.length) throw Error("Incomplete Vibe pagination");
    }
    throw Error("Vibe history exceeds reconciliation limit");
  }
  balance() {
    return this.request("/billing/balance");
  }
  advertisers() {
    return this.list("/advertisers", advertiserSchema);
  }
  advertiser(id: string) {
    return this.request("/advertisers/" + uuid.parse(id)).then((v) =>
      advertiserSchema.parse(v),
    );
  }
  creatives(advertiserId: string) {
    return this.list(
      "/creatives?advertiser_id=" + uuid.parse(advertiserId),
      creativeSchema,
    );
  }
  campaigns(advertiserId: string) {
    return this.list(
      "/campaigns?advertiser_id=" + uuid.parse(advertiserId),
      campaignSchema,
    );
  }
  campaign(id: string) {
    return this.request("/campaigns/" + uuid.parse(id)).then((v) =>
      campaignSchema.parse(v),
    );
  }
  createCampaign(advertiserId: string, name: string) {
    return this.request("/campaigns", "POST", {
      advertiser_id: uuid.parse(advertiserId),
      name,
      goal: "AWARENESS",
      optimization_goal: { type: "CPM", value: this.cpmTarget() },
      active: false,
      countries: ["USA"],
    }).then((v) => campaignSchema.parse(v));
  }
  private cpmTarget() {
    const v = process.env.VIBE_CPM_TARGET_CENTS || "2000";
    if (
      !/^\d+$/.test(v) ||
      BigInt(v) < 100n ||
      BigInt(v) > 50000n ||
      BigInt(v) % 100n
    )
      throw Error("CPM optimization target must be whole USD");
    return Number(BigInt(v) / 100n);
  }
  async upload(advertiserId: string, bytes: Buffer) {
    const data = await this.request(
      "/creatives/upload-url?advertiser_id=" + uuid.parse(advertiserId),
    );
    const target = new URL(data.upload_url);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      !target.hostname.endsWith(".amazonaws.com") ||
      target.port ||
      Date.parse(data.expires_at) <= Date.now()
    )
      throw Error("Unsafe/expired Vibe upload destination");
    const form = new FormData();
    for (const [key, value] of Object.entries(data.fields || {})) {
      if (typeof value !== "string") throw Error("Invalid upload fields");
      form.set(key, value);
    }
    form.set(
      "file",
      new Blob([new Uint8Array(bytes)], { type: "video/mp4" }),
      "commercial.mp4",
    );
    const response = await this.transport(target, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok) throw new VibeError(response.status);
    return uuid.parse(data.upload_id);
  }
  createCreative(advertiserId: string, name: string, uploadId: string) {
    return this.request("/creatives/video", "POST", {
      advertiser_id: uuid.parse(advertiserId),
      name,
      upload_id: uuid.parse(uploadId),
    }).then((v) =>
      v.status === "processing"
        ? z
            .object({ status: z.literal("processing"), upload_id: uuid })
            .parse(v)
        : creativeSchema.parse(v),
    );
  }
  strategies(campaignId: string) {
    return this.list(
      "/strategies?campaign_id=" + uuid.parse(campaignId),
      strategySchema,
    );
  }
  strategy(id: string) {
    return this.request("/strategies/" + uuid.parse(id)).then((v) =>
      strategySchema.parse(v),
    );
  }
  createStrategy(order: StrategyOrder) {
    this.assertBudget(order);
    return this.request("/strategies", "POST", order).then((v) =>
      strategySchema.parse(v),
    );
  }
  updateStrategy(
    id: string,
    order: Omit<StrategyOrder, "campaign_id" | "name">,
  ) {
    this.assertBudget(order);
    return this.request("/strategies/" + uuid.parse(id), "PATCH", order).then(
      (v) => strategySchema.parse(v),
    );
  }
  assertBudget(v: {
    budget: number;
    budget_type: string;
    ends_at: string;
    starts_at: string;
  }) {
    if (
      v.budget !== 50 ||
      v.budget_type !== "GLOBAL" ||
      !Number.isFinite(Date.parse(v.ends_at)) ||
      Date.parse(v.ends_at) <= Date.parse(v.starts_at)
    )
      throw Error("A $50 lifetime strategy with a finite end is required");
  }
  publish(id: string) {
    return this.request(
      "/campaigns/" + uuid.parse(id) + "/publish",
      "POST",
    ).then((v) => campaignSchema.parse(v));
  }
  action(id: string, action: "PAUSE" | "ACTIVATE") {
    return this.request("/strategies/" + uuid.parse(id) + "/actions", "POST", {
      action,
    }).then((v) => strategySchema.parse(v));
  }
  geo(type: "REGION" | "CITY" | "METRO", search: string) {
    return this.request(
      "/geo/locations?type=" +
        type +
        "&search=" +
        encodeURIComponent(search) +
        "&limit=100",
      "GET",
      undefined,
      true,
    );
  }
  ages() {
    return this.request("/segments/ages", "GET", undefined, true);
  }
  createReport(payload: unknown) {
    return this.request("/reports", "POST", payload);
  }
  report(id: string) {
    return this.request("/reports/" + uuid.parse(id));
  }
  async reportRows(url: string) {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      target.port ||
      !target.hostname.endsWith(".amazonaws.com")
    )
      throw Error(
        "Unsupported report-download host; review provider storage contract",
      );
    const response = await this.transport(target, {
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!response.ok) throw new VibeError(response.status);
    const text = await response.text();
    if (text.length > 5000000) throw Error("Report exceeds safe limit");
    const data = exactJSON(text);
    if (!Array.isArray(data))
      throw Error("Unsupported report JSON shape: reconciliation required");
    return data;
  }
}
