import { z } from "zod";
import { address, optionalUrl, tradeUrl } from "@/lib/validation";
export const campaignStates = [
  "DRAFT",
  "CREATIVE_UPLOADING",
  "SUBMITTED_FOR_REVIEW",
  "CREATIVE_PENDING",
  "CHANGES_REQUESTED",
  "CREATIVE_REJECTED",
  "APPROVED_AWAITING_PAYMENT",
  "QUOTE_ACTIVE",
  "PAYMENT_VERIFYING",
  "PAID",
  "READY_TO_ACTIVATE",
  "PROVISIONING_FAILED",
  "ACTIVATING",
  "UPCOMING",
  "DELIVERING",
  "PAUSED",
  "COMPLETED",
  "ACTIVATION_FAILED",
  "REFUND_REVIEW",
  "REFUNDED",
  // Historical manual orders are readable only and never eligible for automatic activation.
  "AWAITING_PAYMENT",
  "COMPLIANCE_REVIEW",
  "APPROVED",
  "SCHEDULING",
  "SCHEDULED",
  "LIVE",
  "REJECTED",
  "REFUND_PENDING",
] as const;
export type CampaignStatus = (typeof campaignStates)[number];
export const transitions: Record<CampaignStatus, readonly CampaignStatus[]> = {
  DRAFT: ["SUBMITTED_FOR_REVIEW"],
  SUBMITTED_FOR_REVIEW: [
    "CREATIVE_UPLOADING",
    "CREATIVE_PENDING",
    "CREATIVE_REJECTED",
    "APPROVED_AWAITING_PAYMENT",
  ],
  CREATIVE_UPLOADING: [
    "PAID",
    "CREATIVE_PENDING",
    "CREATIVE_REJECTED",
    "APPROVED_AWAITING_PAYMENT",
  ],
  CREATIVE_PENDING: [
    "CREATIVE_UPLOADING",
    "CREATIVE_REJECTED",
    "CHANGES_REQUESTED",
    "APPROVED_AWAITING_PAYMENT",
    "PAID",
  ],
  CHANGES_REQUESTED: ["DRAFT", "SUBMITTED_FOR_REVIEW", "CREATIVE_REJECTED"],
  CREATIVE_REJECTED: ["DRAFT", "SUBMITTED_FOR_REVIEW", "PAID"],
  APPROVED_AWAITING_PAYMENT: [
    "CREATIVE_UPLOADING",
    "QUOTE_ACTIVE",
    "CREATIVE_REJECTED",
    "CREATIVE_PENDING",
  ],
  QUOTE_ACTIVE: [
    "CREATIVE_PENDING",
    "CREATIVE_UPLOADING",
    "APPROVED_AWAITING_PAYMENT",
    "PAYMENT_VERIFYING",
    "PAID",
    "CREATIVE_REJECTED",
  ],
  PAYMENT_VERIFYING: [
    "CREATIVE_PENDING",
    "APPROVED_AWAITING_PAYMENT",
    "PAID",
    "CREATIVE_REJECTED",
  ],
  PAID: [
    "READY_TO_ACTIVATE",
    "ACTIVATING",
    "ACTIVATION_FAILED",
    "PROVISIONING_FAILED",
    "REFUND_REVIEW",
  ],
  READY_TO_ACTIVATE: ["ACTIVATING", "PROVISIONING_FAILED", "REFUND_REVIEW"],
  PROVISIONING_FAILED: [
    "ACTIVATING",
    "UPCOMING",
    "DELIVERING",
    "PAUSED",
    "COMPLETED",
    "REFUND_REVIEW",
  ],
  ACTIVATING: [
    "PROVISIONING_FAILED",
    "UPCOMING",
    "DELIVERING",
    "PAUSED",
    "COMPLETED",
    "ACTIVATION_FAILED",
  ],
  UPCOMING: [
    "DELIVERING",
    "PAUSED",
    "COMPLETED",
    "ACTIVATION_FAILED",
    "REFUND_REVIEW",
  ],
  DELIVERING: ["PAUSED", "COMPLETED", "ACTIVATION_FAILED"],
  PAUSED: [
    "UPCOMING",
    "DELIVERING",
    "COMPLETED",
    "ACTIVATION_FAILED",
    "REFUND_REVIEW",
  ],
  ACTIVATION_FAILED: [
    "ACTIVATING",
    "UPCOMING",
    "DELIVERING",
    "PAUSED",
    "COMPLETED",
    "REFUND_REVIEW",
  ],
  REFUND_REVIEW: ["REFUNDED"],
  COMPLETED: [],
  REFUNDED: [],
  AWAITING_PAYMENT: [],
  COMPLIANCE_REVIEW: [],
  APPROVED: [],
  SCHEDULING: [],
  SCHEDULED: [],
  LIVE: [],
  REJECTED: [],
  REFUND_PENDING: [],
};
export function canTransition(from: CampaignStatus, to: CampaignStatus) {
  return transitions[from]?.includes(to) ?? false;
}
const url = optionalUrl.refine((v) => !!v, "A public HTTPS URL is required");
export const objectives = [
  "Awareness",
  "Website visits",
  "Community growth",
  "Product launch",
] as const;
export const targetingInput = z
  .object({
    geography: z.enum(["United States", "State", "City / DMA"]),
    location: z.string().max(200),
    geoType: z.enum(["REGION", "CITY", "METRO"]).optional(),
    minAge: z.literal(21),
    maxAge: z.literal(100),
    // Kept in the stored brief for compatibility; no unsupported interest/device filters are sent.
    interests: z.array(z.string()).max(0),
    devices: z.array(z.string()).max(0),
  })
  .superRefine((v, c) => {
    if (v.geography !== "United States" && !v.location.trim())
      c.addIssue({
        code: "custom",
        message: "Choose a Vibe-verified location",
      });
  });
export const campaignInput = z
  .object({
    id: z.string().uuid().optional(),
    mint: address,
    title: z.string().trim().min(3).max(120),
    coinName: z.string().trim().min(1).max(80),
    ticker: z.string().trim().min(1).max(20),
    pumpUrl: z.string().max(2000),
    website: url,
    destinationUrl: url,
    description: z.string().trim().min(20).max(3000),
    objective: z.literal("Awareness"),
    contactEmail: z.string().email().max(254),
    websiteVisible: z.literal(true),
    creativeId: z.string().uuid(),
    headline: z.string().trim().min(3).max(120),
    cta: z.string().trim().min(2).max(80),
    disclosure: z.string().trim().min(20).max(2000),
    qrUrl: url,
    targeting: targetingInput,
    mediaBudgetCents: z.string().regex(/^\d{1,12}$/),
    durationDays: z.number().int().min(1).max(90),
    proposedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    publicProofConsent: z.boolean().default(false),
    rightsConfirmed: z.literal(true),
    policyConfirmed: z.literal(true),
  })
  .superRefine((v, c) => {
    try {
      tradeUrl("pump", v.pumpUrl, v.mint);
      const day = new Date(v.proposedStart + "T00:00:00Z");
      if (
        !Number.isFinite(day.getTime()) ||
        day.toISOString().slice(0, 10) !== v.proposedStart
      )
        throw Error("Date invalid");
    } catch {
      c.addIssue({ code: "custom", message: "Check Pump URL and start date" });
    }
  });
export type CampaignInput = z.infer<typeof campaignInput>;
export function invoiceAmounts(media: bigint, bps: number, price: bigint) {
  if (
    media <= 0n ||
    price <= 0n ||
    !Number.isInteger(bps) ||
    bps < 0 ||
    bps > 10000
  )
    throw Error("Invalid invoice");
  const fee = (media * BigInt(bps)) / 10000n,
    total = media + fee;
  const lamports = (total * 10000000000000n + price - 1n) / price;
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Invoice too large");
  return { media, fee, total, lamports };
}
export type CreatorIdentity = { userId: string; wallet: string };
export type CoinView = {
  mint: string;
  name: string;
  ticker: string;
  image_url: string | null;
  role: string;
  venue: string;
  current_creator: string;
  market_cap_usd_cents: string | null;
  authorityCurrent: boolean | null;
  claimableLamports: string | null;
  curveLamports: string | null;
  ammLamports: string | null;
  claimedLamports: string | null;
  feeNotice: string;
  sharing: boolean;
  claimable: boolean;
};
export type CreatorCampaign = {
  id: string;
  mint: string;
  title: string;
  status: CampaignStatus;
  brief: CampaignInput;
  media_budget_cents: string;
  duration_days: number;
  proposed_start: string;
  submitted_at: string | null;
  created_at: string;
  external_platform: string | null;
  external_campaign_id: string | null;
  actual_start: string | null;
  actual_end: string | null;
  media_spend_cents: string;
  platform_cost_cents: string;
  approval_proof_url: string | null;
  placement_proof_url: string | null;
  impressions: string | null;
  reach: string | null;
  cpm_cents: string | null;
  product_version: number;
  vibe?: {
    review_status: string | null;
    review_reason: string | null;
    delivery_status: string | null;
    last_synced_at: string | null;
    last_error: string | null;
    metrics: Record<string, any> | null;
    channels: any[];
  };
  messages: { body: string; sender: string; created_at: string }[];
  invoices: CreatorInvoice[];
};
export type CreatorInvoice = {
  id: string;
  campaign_id: string;
  payment_reference: string;
  media_budget_cents: string;
  platform_fee_cents: string;
  total_usd_cents: string;
  platform_fee_bps: number;
  required_lamports: string;
  creator_wallet: string;
  recipient_wallet: string;
  mint: string;
  price_usd_micros: string;
  price_source: string;
  price_fetched_at: string;
  expires_at: string;
  status: string;
  refund_status: string;
  signature: string | null;
  refund_signature: string | null;
  created_at: string;
};
export type CreatorState = {
  identity: CreatorIdentity;
  coins: CoinView[];
  campaigns: CreatorCampaign[];
  invoices: CreatorInvoice[];
  uploads: {
    id: string;
    original_name: string;
    metadata: {
      duration: number;
      width: number;
      height: number;
      audio: boolean;
    };
  }[];
  config: {
    minimumCents: string;
    serviceFeeCents: string;
    totalCents: string;
    feeBps: number;
    paymentConfigured: boolean;
    uploadsConfigured: boolean;
    maintenance: boolean;
  };
  notice: string | null;
};
