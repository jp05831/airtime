import type { advertiserSchema } from "./client";
import type { z } from "zod";
export type VibeAdvertiser = z.infer<typeof advertiserSchema>;
export function resolveSoleAdvertiser(advertisers: VibeAdvertiser[]) {
  if (advertisers.length === 0)
    throw Error(
      "No Vibe advertiser is authorized for AIRTIME; check the private account and advertisers:read access",
    );
  if (advertisers.length > 1)
    throw Error(
      "Multiple Vibe advertisers are authorized; administrator selection is required before campaign processing",
    );
  return advertisers[0];
}
