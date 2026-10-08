import type { CampaignStatus } from "@/lib/platform/model";
import type { VibeCreative, VibeCampaign } from "./client";
/** Only statuses documented by the pinned Vibe revision are accepted. */
export class VibeStatusMapper {
  static creative(status: VibeCreative["approval_status"]): CampaignStatus {
    const states = {
      PROCESSING: "CREATIVE_UPLOADING",
      PENDING_REVIEW: "CREATIVE_PENDING",
      AUTHORIZED: "APPROVED_AWAITING_PAYMENT",
      BLOCKED: "CREATIVE_REJECTED",
    } as const;
    if (!states[status]) throw Error("Unknown Vibe creative status");
    return states[status];
  }
  static delivery(c: VibeCampaign): CampaignStatus {
    if (c.status !== "PUBLISHED") throw Error("Campaign is not published");
    switch (c.state) {
      case "DELIVERING":
        return "DELIVERING";
      case "COMPLETED":
        return "COMPLETED";
      case "UPCOMING":
      case "PENDING_REVIEW":
        return "UPCOMING";
      case "PAUSED":
      case "INACTIVE":
        return "PAUSED";
      case "BLOCKED":
      case "PAYMENT_ISSUE":
      case "ARCHIVED":
        return "ACTIVATION_FAILED";
      default:
        throw Error("Vibe has not supplied a supported delivery state");
    }
  }
}
