import { z } from "zod";
import { adminHandler } from "@/lib/server/admin";
import { body } from "@/lib/server/http";
import { integer, optionalUrl } from "@/lib/validation";
import { statuses } from "@/lib/types";
import {
  commitCampaign,
  recordExpense,
  transition,
  audit,
} from "@/lib/server/campaigns";
import { transaction } from "@/lib/server/db";
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("commit"),
    campaignId: z.string().uuid(),
    amount: integer,
    idempotencyKey: z.string().uuid(),
  }),
  z.object({
    action: z.literal("status"),
    campaignId: z.string().uuid(),
    status: z.enum(statuses),
  }),
  z.object({
    action: z.literal("expense"),
    campaignId: z.string().uuid(),
    amount: integer,
    transactionId: z.string().uuid().nullable(),
    note: z.string().min(1).max(1000),
    idempotencyKey: z.string().uuid(),
  }),
  z.object({
    action: z.literal("proof"),
    campaignId: z.string().uuid(),
    kind: z.enum(["VIDEO", "RECEIPT", "PLACEMENT", "RESULTS"]),
    title: z.string().min(1).max(160),
    url: optionalUrl.refine(Boolean),
  }),
]);
export const POST = adminHandler(async (r, a) => {
  const v = input.parse(await body(r));
  if (v.action === "commit")
    return commitCampaign(
      v.campaignId,
      BigInt(v.amount),
      a.id,
      v.idempotencyKey,
    );
  if (v.action === "status") return transition(v.campaignId, v.status, a.id);
  if (v.action === "expense") return recordExpense(v, a.id);
  return transaction(async (c) => {
    await c.query(
      "INSERT INTO campaign_proof(campaign_id,kind,title,url) VALUES($1,$2,$3,$4)",
      [v.campaignId, v.kind, v.title, v.url],
    );
    await audit(a.id, "PROOF_LINK", v.campaignId, { kind: v.kind }, c);
    return { saved: true };
  });
});
