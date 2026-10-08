import Link from "next/link";
import { Heading } from "./ui";
const content = {
  terms: [
    [
      "Advertising service",
      "AIRTIME sells reviewed television/CTV advertising services to verified Pump.fun coin creators. It is independent and is not affiliated with Pump.fun, Vibe or Roku. Connecting a wallet authenticates you; it does not authorize a transfer. Every claim and campaign payment requires a separate wallet signature.",
    ],
    [
      "Campaign orders and approval",
      "Quotes disclose the media budget, AIRTIME service fee, SOL/USD price, exact campaign lamports and expiration. Network fees are separate. A finalized payment does not guarantee placement. Creative, targeting, scheduling and cryptocurrency advertising require human, platform and legal approval. AIRTIME registers commercials for Vibe review before checkout and activates approved paid campaigns through the Vibe API once operator permissions are enabled. Placement depends on inventory, targeting and approval; no particular streaming application or channel is guaranteed.",
    ],
    [
      "Revision and refund policy — launch draft",
      "If a campaign is rejected before any placement or partner cost is incurred, the creator may revise the creative or request a full refund of the original campaign payment in SOL, including the AIRTIME service fee. Refunds are manually reviewed and require a finalized transfer from the payment wallet; AIRTIME does not automatically send them. Refund network fees are paid by the operator. SOL refunds use the original lamports, not a newly converted USD amount. Purchased, scheduled or delivered inventory may be non-refundable under partner terms; contact the operator before any such booking. Operator response/refund deadlines, legal entity and contact MUST be published after professional review before accepting real orders.",
    ],
    [
      "Creator responsibilities",
      "Creators must have authority over the coin and rights to their commercial, disclosures and destination content. Ads must comply with applicable law and platform rules. No misleading financial claims, guaranteed returns, prohibited content or targeting of minors is permitted. Submitted media remains private unless publication is explicitly authorized.",
    ],
    [
      "No guarantees or financial rights",
      "Reach, impressions, CPM forecasts and campaign dates are estimates or requests until recorded delivery. Advertising does not guarantee token price, campaign performance or returns. Memecoins are speculative, highly volatile and may lose all value. Buying tokens or advertising does not confer ownership, revenue rights or dividends.",
    ],
    [
      "Professional review required",
      "These terms are a responsible draft, not legal approval. Publish the actual operator, jurisdiction, support contact, review/refund deadlines and approved partner policies before launch.",
    ],
  ],
  privacy: [
    [
      "Creator accounts and data",
      "AIRTIME processes public wallet addresses and signed authentication challenges, private campaign briefs, commercials, targeting requests, invoices and creator messages. Creator sessions use secure HTTP-only cookies in production. Gasless nonces expire and are single-use. No seed phrase or wallet private key is requested or stored.",
    ],
    [
      "Access and providers",
      "Creator data is scoped to its authenticated owner; authorized administrators review submitted campaigns. Private storage uses short-lived signed media URLs. Supabase provides database/Auth/storage, Helius provides mainnet data and CoinGecko provides SOL pricing. Advertising partners receive only the information needed to fulfill approved orders.",
    ],
    [
      "Retention and privacy rights",
      "Blockchain payments are public and cannot be erased from Solana. AIRTIME retains invoice and review audit evidence; campaign media and account retention policies must be finalized by the operator before launch. Rate-limit identifiers are hashed. No marketing analytics are installed by default.",
    ],
    [
      "Professional review",
      "The operator must publish data-controller identity, hosting regions, subprocessors, retention periods, contact and applicable privacy rights after professional review. This draft does not claim compliance.",
    ],
  ],
  disclosures: [
    [
      "Independent creator advertising platform",
      "AIRTIME is not affiliated with Pump.fun, Vibe, Roku or any television network. No partner relationship or approval is claimed without actual written supporting evidence. Approved paid campaigns can be activated through Vibe only after AIRTIME has the required embedded-buying and cryptocurrency-advertising permissions.",
    ],
    [
      "Fee proceeds and wallet control",
      "Creators retain wallet control. AIRTIME cannot access creator fees without an explicit wallet signature. Official claims move fees to the verified recipients; a separate invoice payment goes to AIRTIME’s configured payment wallet. General wallet SOL is not described as creator-fee proceeds without proof. Many creator vaults are wallet-wide; shared or unsupported fee configurations may have unavailable exact balances.",
    ],
    [
      "Approval and forecasting",
      "Cryptocurrency ads may be rejected. Modeled CPM/impression ranges are illustrative estimates, not live inventory quotes or guarantees. Reach and audience availability are confirmed by partners. Funding does not guarantee approval, placement, token performance or financial returns.",
    ],
    [
      "Proof and payment",
      "AIRTIME verifies exact signed invoice transfers at finalized Solana commitment before marking them paid. Off-chain media delivery, receipts and performance metrics are supplied by the operator/partner. USD/SOL prices fluctuate, quoted payments expire, and unavailable pricing prevents new quotes.",
    ],
    [
      "Revision/refunds and review",
      "Rejected campaigns follow the published revision/refund policy. Legal entity, contact, deadlines and approved inventory policies must be finalized before real orders. Submitted ads must comply with applicable laws and platform rules. These disclosures require professional legal review.",
    ],
  ],
};
export default function Legal({ kind }: { kind: keyof typeof content }) {
  return (
    <main className="page-content">
      <Heading
        label="AIRTIME / TRUST & TRANSPARENCY"
        title={
          kind === "terms"
            ? "Terms of use"
            : kind === "privacy"
              ? "Privacy notice"
              : "Disclosures"
        }
        description="Clear expectations for wallet-authenticated campaign orders, reviewed advertising and on-chain payments."
      />
      <article className="panel docs-body">
        <p className="notice">
          DRAFT — PROFESSIONAL LEGAL REVIEW REQUIRED BEFORE LAUNCH
        </p>
        {content[kind].map(([title, text]) => (
          <section key={title}>
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ))}
        <Link className="text-link" href="/dashboard">
          Open the creator workspace ↗
        </Link>
      </article>
    </main>
  );
}
