import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/http";
import { requireCreator } from "@/lib/platform/auth";
import { ownedInvoice } from "@/lib/platform/payments";
import { db } from "@/lib/server/db";
import { sol, dollars } from "@/lib/accounting";
export const GET = handle(async (r) => {
  const identity = await requireCreator(r),
    id = z.string().uuid().parse(r.nextUrl.searchParams.get("id")),
    i = await ownedInvoice(identity, id);
  const payment = (
    await db().query(
      "SELECT signature FROM campaign_payments WHERE invoice_id=$1",
      [id],
    )
  ).rows[0];
  const receipt = `AIRTIME CAMPAIGN INVOICE\nInvoice: ${id}\nCampaign: ${i.campaign_id}\nCreator wallet: ${i.creator_wallet}\nCoin mint: ${i.mint}\nMedia budget: ${dollars(i.media_budget_cents)}\nService fee: ${dollars(i.platform_fee_cents)} (${i.platform_fee_bps} BPS)\nTotal: ${dollars(i.total_usd_cents)}\nQuoted payment: ${sol(i.required_lamports)} SOL\nStatus: ${i.status}\nFinalized transaction: ${payment?.signature || "Not confirmed"}\nRefund status: ${i.refund_status}\nCreated: ${new Date(i.created_at).toISOString()}\n\nAIRTIME purchases reviewed media placements manually through advertising partners. A payment is not a guarantee of approval or results.\n`;
  return new NextResponse(receipt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="airtime-${id}.txt"`,
      "Cache-Control": "private, no-store",
    },
  });
}, false);
