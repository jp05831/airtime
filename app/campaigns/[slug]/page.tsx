import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/server/db";
import { Heading, Badge } from "@/components/ui";
import { dollars } from "@/lib/accounting";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[0-9a-f-]{36}$/.test(slug) || !process.env.DATABASE_URL)
    return { title: "Campaign proof" };
  const c = (
    await db().query(
      "SELECT title FROM ad_campaigns WHERE id=$1 AND status='COMPLETED' AND public_proof",
      [slug],
    )
  ).rows[0];
  return { title: c?.title || "Campaign proof" };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[0-9a-f-]{36}$/.test(slug) || !process.env.DATABASE_URL) notFound();
  const c = (
    await db().query(
      "SELECT c.id,c.title,c.brief->>'ticker' ticker,c.brief->>'coinName' coin_name,c.media_budget_cents,c.media_spend_cents,c.external_platform,c.actual_start,c.actual_end,c.placement_proof_url,m.impressions,m.reach,m.cpm_cents,m.source FROM ad_campaigns c LEFT JOIN campaign_metrics m ON m.campaign_id=c.id WHERE c.id=$1 AND c.status='COMPLETED' AND c.public_proof AND c.placement_proof_url IS NOT NULL",
      [slug],
    )
  ).rows[0];
  if (!c) notFound();
  return (
    <main className="page-content">
      <Heading
        label={"COMPLETED / $" + c.ticker}
        title={c.title}
        description={`${c.coin_name} — a reviewed streaming-TV placement purchased by AIRTIME.`}
      />
      <article className="panel campaign-detail">
        <Badge status="COMPLETED" />
        <h2>
          From your coin <em>to the big screen.</em>
        </h2>
        <dl>
          <div>
            <dt>Placement</dt>
            <dd>{c.external_platform}</dd>
          </div>
          <div>
            <dt>Media budget / recorded spend</dt>
            <dd>
              {dollars(c.media_budget_cents)} / {dollars(c.media_spend_cents)}
            </dd>
          </div>
          <div>
            <dt>Impressions / reach</dt>
            <dd>
              {BigInt(c.impressions || 0).toLocaleString("en-US")} /{" "}
              {BigInt(c.reach || 0).toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt>Run dates (UTC)</dt>
            <dd>
              {c.actual_start
                ? new Date(c.actual_start).toISOString().slice(0, 10)
                : "Not recorded"}{" "}
              —{" "}
              {c.actual_end
                ? new Date(c.actual_end).toISOString().slice(0, 10)
                : "Not recorded"}
            </dd>
          </div>
        </dl>
        <a
          className="button"
          href={c.placement_proof_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View placement evidence ↗
        </a>
        <p>
          Off-chain delivery records are supplied by the administrator and
          advertising partner. These results are not a guarantee of future reach
          or token performance. Private billing and receipts are not published.
        </p>
      </article>
      <Link className="text-link" href="/campaigns">
        All published campaigns ↗
      </Link>
    </main>
  );
}
