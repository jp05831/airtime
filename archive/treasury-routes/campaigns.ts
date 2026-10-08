import { z } from "zod";
import { adminHandler } from "@/lib/server/admin";
import { body, HttpError } from "@/lib/server/http";
import { integer, optionalUrl } from "@/lib/validation";
import { db, transaction } from "@/lib/server/db";
import { audit } from "@/lib/server/campaigns";
const input = z
  .object({
    id: z.string().uuid().optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    title: z.string().min(1).max(160),
    description: z.string().max(4000),
    targetUsdCents: integer.refine((v) => BigInt(v) > 0n),
    platform: z.string().max(160),
    format: z.string().max(160),
    videoUrl: optionalUrl,
    approvalStatus: z.enum([
      "NOT SUBMITTED",
      "SUBMITTED FOR REVIEW",
      "APPROVED",
      "REJECTED",
    ]),
    approvalProofUrl: optionalUrl,
    plannedStart: z.string().datetime().nullable(),
    plannedEnd: z.string().datetime().nullable(),
    results: z.string().max(5000),
  })
  .refine(
    (v) => v.approvalStatus !== "APPROVED" || !!v.approvalProofUrl,
    "Approval requires evidence",
  );
export const POST = adminHandler(async (r, admin) => {
  const v = input.parse(await body(r));
  return transaction(async (c) => {
    if (v.id) {
      const { rows } = await c.query(
        "SELECT status,approval_status FROM campaigns WHERE id=$1 FOR UPDATE",
        [v.id],
      );
      if (rows[0]?.status === "COMPLETED")
        throw new HttpError(409, "Completed campaign records are locked");
    }
    const values = [
      v.slug,
      v.title,
      v.description,
      v.targetUsdCents,
      v.platform,
      v.format,
      v.videoUrl,
      v.approvalStatus,
      v.approvalProofUrl,
      v.plannedStart,
      v.plannedEnd,
      v.results,
    ];
    const result = v.id
      ? await c.query(
          "UPDATE campaigns SET slug=$1,title=$2,description=$3,target_usd_cents=$4,platform=$5,format=$6,video_url=$7,approval_status=$8,approval_proof_url=$9,planned_start=$10,planned_end=$11,results=$12 WHERE id=$13 RETURNING id",
          [...values, v.id],
        )
      : await c.query(
          "INSERT INTO campaigns(slug,title,description,target_usd_cents,platform,format,video_url,approval_status,approval_proof_url,planned_start,planned_end,results) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id",
          values,
        );
    await audit(
      admin.id,
      v.id ? "CAMPAIGN_EDIT" : "CAMPAIGN_CREATE",
      result.rows[0].id,
      { title: v.title },
      c,
    );
    return { id: result.rows[0].id };
  });
});
