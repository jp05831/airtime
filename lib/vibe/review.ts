import { db } from "@/lib/server/db";
import { ownedCampaign } from "@/lib/platform/campaigns";
import { HttpError, redact } from "@/lib/server/http";
import type { CreatorIdentity } from "@/lib/platform/model";
import { VibeClient } from "./client";
export async function assertCreativeApproved(
  campaignId: string,
  userId?: string,
  client = new VibeClient(),
) {
  const campaign = (
    await db().query("SELECT * FROM ad_campaigns WHERE id=$1", [campaignId])
  ).rows[0];
  if (
    !campaign ||
    campaign.product_version !== 2 ||
    (userId && campaign.user_id !== userId)
  )
    throw new HttpError(404, "Campaign not found");
  const creative = (
    await db().query(
      "SELECT cr.*,a.external_id advertiser_external_id FROM vibe_creatives cr JOIN vibe_campaigns vc ON vc.campaign_id=cr.campaign_id JOIN vibe_advertisers a ON a.id=vc.advertiser_id WHERE cr.campaign_id=$1 AND cr.creative_id=$2 AND cr.user_id=$3",
      [campaignId, campaign.brief.creativeId, campaign.user_id],
    )
  ).rows[0];
  if (!creative?.external_id || creative.approval_status !== "AUTHORIZED")
    throw new HttpError(
      409,
      "Your commercial must be approved by Vibe before payment",
    );
  const live = (await client.creatives(creative.advertiser_external_id)).find(
    (v) => v.id === creative.external_id,
  );
  if (!live || live.advertiser_id !== creative.advertiser_external_id)
    throw new HttpError(409, "Creative ownership cannot be verified");
  await db().query(
    "UPDATE vibe_creatives SET approval_status=$2,approval_details=$3,provider_review_snapshot=$4,last_synced_at=now() WHERE id=$1",
    [
      creative.id,
      live.approval_status,
      live.approval_details ? redact(new Error(live.approval_details)) : null,
      JSON.stringify({ id: live.id, approval_status: live.approval_status }),
    ],
  );
  if (live.approval_status !== "AUTHORIZED")
    throw new HttpError(
      409,
      "Creative approval is no longer active. Payment is blocked.",
    );
  return { creative, live };
}
export async function ownedVibeCampaign(identity: CreatorIdentity, id: string) {
  await ownedCampaign(identity, id);
  const row = (
    await db().query(
      "SELECT * FROM vibe_campaigns WHERE campaign_id=$1 AND user_id=$2",
      [id, identity.userId],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "Vibe campaign not found");
  return row;
}
