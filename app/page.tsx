import Link from "next/link";
import Image from "next/image";
import {
  ShieldCheck,
  Wallet,
  Globe,
  ArrowUpRight,
  FileVideo,
  BarChart3,
} from "lucide-react";
import { ConnectWallet } from "@/components/creator-wallet";
import { platformConfig } from "@/lib/platform/config";
import { dollars } from "@/lib/accounting";
export const dynamic = "force-dynamic";
export default function Home() {
  const config = platformConfig();
  return (
    <main>
      <section className="hero creator-hero">
        <div className="hero-copy">
          <span className="eyebrow hero-label">
            <span className="dot" />
            STREAMING TV FOR PUMP.FUN CREATORS
          </span>
          <h1>
            <span>Use creator fees to</span>
            <em>put your coin</em>
            <span>on TV.</span>
          </h1>
          <p className="hero-description">
            Connect your creator wallet, upload your commercial and launch a $50
            streaming-TV campaign through AIRTIME.
          </p>
          <div className="hero-buttons">
            <ConnectWallet label="Launch a TV Campaign" />
            <Link className="button outline" href="#how-it-works">
              See How It Works <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
        <div className="hero-artwork">
          <Image
            src="/airtime-tv-transparent.png"
            alt="AIRTIME promotional artwork on a television screen"
            width={1536}
            height={1024}
            sizes="(max-width: 1024px) 100vw, 50vw"
            priority
          />
        </div>
      </section>
      <div className="homepage-flow">
        <section id="how-it-works" className="section-block flow-how">
          <header className="flow-heading">
            <span className="eyebrow">FROM YOUR WALLET TO THEIR SCREEN</span>
            <h2>
              One campaign.
              <br />
              <em>Four simple steps.</em>
            </h2>
            <p>You bring the coin and the commercial. We guide the rest.</p>
          </header>
          <div className="how-grid creator-how">
            {[
              [
                "01",
                "Connect",
                "Connect the wallet controlling your Pump.fun coin. Authority is verified on-chain.",
              ],
              [
                "02",
                "Create",
                "Upload your commercial and choose a simple adult US audience. Submit for creative review before paying.",
              ],
              [
                "03",
                "Fund",
                "Approve the exact campaign invoice using creator-fee proceeds or available wallet SOL.",
              ],
              [
                "04",
                "Go live",
                "After approval and finalized payment, AIRTIME activates your campaign through Vibe.",
              ],
            ].map(([n, t, d]) => (
              <article className="step-card" key={n}>
                <span className="flow-step-number">{n}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="for-creators" className="section-block creator-product">
          <div>
            <header className="flow-heading">
              <span className="eyebrow">BUILT AROUND YOUR CAMPAIGN</span>
              <h2>
                Less setup.
                <br />
                <em>More screen time.</em>
              </h2>
            </header>
            <p>
              Pick your coin, preview your commercial and find your audience.
              Keep the brief, budget and delivery reports together in one
              workspace.
            </p>
            <ConnectWallet className="button outline" />
          </div>
          <div className="product-stages flow-workspace">
            <header>
              <span className="eyebrow">AIRTIME / YOUR WORKSPACE</span>
              <h3>From first brief to final report.</h3>
            </header>
            {[
              [
                Wallet,
                "Your coin",
                "Verify current creator or fee-recipient authority.",
              ],
              [
                FileVideo,
                "Your commercial",
                "Preview a technically validated 5–90 second commercial.",
              ],
              [
                Globe,
                "Your audience",
                "Choose adult audiences and supported US locations.",
              ],
              [
                BarChart3,
                "Your budget & results",
                "See the invoice upfront and delivery results after launch.",
              ],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Wallet;
              return (
                <div key={String(t)}>
                  <I size={23} />
                  <div>
                    <h3>{String(t)}</h3>
                    <p>{String(d)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section
          id="pricing"
          className="section-block pricing-panel flow-pricing"
        >
          <div>
            <span className="eyebrow">A CLEAR PRICE BEFORE YOU SIGN</span>
            <h2>
              The $50 campaign.
              <br />
              <em>One clear service fee.</em>
            </h2>
            <p>
              One fixed product: $50 in streaming-TV media, simple targeting,
              commercial compliance review, on-chain SOL checkout and live
              campaign reporting. No monthly subscription.
            </p>
          </div>
          <div className="pricing-details">
            <div>
              <span>Streaming-TV media</span>
              <strong>{dollars(config.minimumCents)}</strong>
            </div>
            <div>
              <span>AIRTIME service fee</span>
              <strong>{dollars(config.serviceFeeCents)}</strong>
            </div>
            <small>
              Customer total: $60 equivalent in SOL. Network fees are separate.
              USD/SOL quotes expire; no guaranteed impressions or results.
            </small>
            <ConnectWallet label="Launch a TV Campaign" />
          </div>
        </section>
        <section className="section-block compliance-panel flow-review">
          <ShieldCheck size={28} />
          <div>
            <span className="eyebrow">BEFORE YOUR FIRST PLACEMENT</span>
            <h2>Creative review, then a real placement.</h2>
            <p>
              Vibe reviews your creative before payment is requested.
              Cryptocurrency ads remain subject to network, platform and legal
              approval. Placement depends on inventory, targeting and approval.
              No particular streaming application or channel is guaranteed.
              Payment does not guarantee token performance.
            </p>
            <Link className="text-link" href="/terms">
              Read the revision and refund policy ↗
            </Link>
          </div>
        </section>
        <section className="section-block final-cta flow-finale">
          <span className="eyebrow">FROM YOUR WALLET TO THEIR LIVING ROOM</span>
          <h2>
            Your coin belongs
            <br />
            <em>on the big screen.</em>
          </h2>
          <ConnectWallet label="Launch a TV Campaign" />
          <p>
            AIRTIME is independent and is not affiliated with Pump.fun, Vibe or
            Roku.
          </p>
        </section>
      </div>
    </main>
  );
}
