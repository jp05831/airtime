/** Boundary for future real CTV partners. No network API is currently configured. */
export const fulfillmentMode = "MANUAL" as const;
export type ApprovedMediaOrder = {
  campaignId: string;
  mediaBudgetCents: string;
  creativeAccessUrl: string;
  targeting: unknown;
  plannedStart: string;
  durationDays: number;
  writtenApprovalEvidence: string;
};
export type PartnerDelivery = {
  externalCampaignId: string;
  state: "SCHEDULED" | "LIVE" | "COMPLETED" | "REJECTED";
  impressions: string;
  reach: string;
  mediaSpendCents: string;
  proofUrl: string | null;
};
export interface AdvertisingPartnerAdapter {
  submitApprovedOrder(
    order: ApprovedMediaOrder,
    idempotencyKey: string,
  ): Promise<{ externalCampaignId: string }>;
  readDelivery(externalCampaignId: string): Promise<PartnerDelivery>;
  requestCancellation(
    externalCampaignId: string,
    idempotencyKey: string,
  ): Promise<{ accepted: boolean; refundableMediaCents: string | null }>;
}
// An implementation may only be selected after a real signed partner agreement,
// server-side credentials, compliance approval and provider contract tests.
// Current scheduling stores the operator's externally purchased placement evidence.
