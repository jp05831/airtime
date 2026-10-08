import Link from "next/link";
import { db } from "@/lib/server/db";
import { Heading, Empty } from "@/components/ui";
import { ConnectWallet } from "@/components/creator-wallet";
import { dollars } from "@/lib/accounting";
export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns" };
export default async function Page() {
  let campaigns: any[] = [],
    unavailable = false;
  if (process.env.DATABASE_URL) {
    try {
      campaigns = (
        await db().query(
          "SELECT id,title,brief->>'ticker' ticker,media_budget_cents,external_platform,actual_start,actual_end FROM ad_campaigns WHERE status='COMPLETED' AND public_proof AND placement_proof_url IS NOT NULL ORDER BY updated_at DESC LIMIT 50",
        )
      ).rows;
    } catch {
      unavailable = true;
    }
  }
  return (
    <main className="page-content">
      <Heading
        label="AIRTIME / CAMPAIGNS"
        title="Real campaigns. Published proof."
        description="Completed placements are shared only with creator permission. Drafts, targeting, payments and receipts stay inside the creator’s private workspace."
      />
      <div className="panel">
        <div className="campaign-card-top">
          <h2>Your campaigns live in your dashboard.</h2>
          <ConnectWallet />
        </div>
        <p>
          Connect your creator wallet to see drafts, review updates, run dates
          and reporting.
        </p>
      </div>
      <section className="section-block">
        <h2>Completed campaign proof</h2>
        {campaigns.length ? (
          <div className="creator-campaign-grid">
            {campaigns.map((c) => (
              <article className="panel campaign-card" key={c.id}>
                <span className="eyebrow">${c.ticker} / COMPLETED</span>
                <h3>{c.title}</h3>
                <p>
                  {c.external_platform} · {dollars(c.media_budget_cents)} media
                  budget
                </p>
                <Link className="button outline" href={"/campaigns/" + c.id}>
                  View placement proof ↗
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="panel">
            <Empty
              title={
                unavailable
                  ? "Campaign proof temporarily unavailable"
                  : "No published placements yet"
              }
              detail="Approved campaigns will appear here after completion and creator-authorized publication. No campaign history is fabricated."
            />
          </div>
        )}
      </section>
    </main>
  );
}
