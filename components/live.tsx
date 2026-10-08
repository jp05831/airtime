// Legacy treasury UI retained for historical reference; not used by the creator platform.
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Radio,
  Wallet,
  MonitorPlay,
  ScanLine,
} from "lucide-react";
import type { Dashboard } from "@/lib/types";
import { sol, dollars } from "@/lib/accounting";
import Funding, { Terminal, fundingProgress } from "./funding";
import { Stat, Section, Activity, Empty, CampaignCard } from "./ui";
export const DISCLOSURE =
  "Advertising placements are subject to platform approval and availability. If a planned placement is rejected, committed funds roll into another approved television, streaming or real-world media campaign. AIRTIME is a speculative token and does not provide ownership, revenue rights or guaranteed returns.";
export default function Live({ initial }: { initial: Dashboard }) {
  const [d, setData] = useState(initial),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/public", { cache: "no-store" });
        if (!response.ok) throw Error();
        setData(await response.json());
        setError("");
      } catch {
        setError("Live refresh is unavailable. Last loaded records are shown.");
      }
    }, 20000);
    return () => clearInterval(timer);
  }, []);
  const progress = fundingProgress(d);
  const live = !!d.settings.mint && !d.notice && !d.demo;
  const campaign = d.campaigns.find(
    (c) => !["COMPLETED", "REJECTED", "SCHEDULED", "LIVE"].includes(c.status),
  );
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow hero-label">
            <i className="dot" /> THE PUBLIC ADVERTISING TREASURY
          </span>
          <h1>
            <span>Every trade</span>
            <em>buys airtime.</em>
          </h1>
          <p className="hero-description">
            Creator fees build a public advertising treasury. When the meter
            fills, AIRTIME launches its next real-world campaign.
          </p>
          <div className="hero-buttons">
            {d.settings.mint &&
            (d.settings.axiomUrl || d.settings.pumpUrl) &&
            !d.settings.maintenance ? (
              <a className="button" href="/api/trade">
                Trade $AIRTIME <ArrowUpRight size={18} />
              </a>
            ) : (
              <button className="button" disabled>
                Trade $AIRTIME <ArrowUpRight size={18} />
              </button>
            )}
            <Link className="button outline" href="/treasury">
              View Live Treasury <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="broadcast-status">
            <i className={"dot " + (live ? "neutral" : "amber")} />
            <span>
              {d.demo
                ? "DEMO — Illustrative campaign funding"
                : live
                  ? "LIVE — Creator fees are accumulating"
                  : d.settings.paused || d.settings.maintenance
                    ? "PAUSED — Last verified records are shown"
                    : d.settings.mint && d.settings.treasury
                      ? "SYNC DELAYED — Last verified records are shown"
                      : "PRE-LAUNCH — Treasury tracking begins at launch"}
            </span>
          </div>
          <div className="hero-proof">
            <span>✓ Public treasury</span>
            <span>✓ Real-world media</span>
            <span>✓ Published proof</span>
          </div>
          <div className="stats-grid">
            <Stat
              label="Verified accrued fees"
              value={sol(d.accrued) + " SOL"}
              note="Indexed eligible token trades"
            />
            <Stat
              label="Treasury balance"
              value={d.balance === null ? "—" : sol(d.balance) + " SOL"}
              note="Finalized wallet snapshot"
            />
            <Stat
              label="Advertising spend"
              value={sol(d.spent) + " SOL"}
              note="Recorded spend, net refunds"
            />
            <Stat
              label="Campaigns completed"
              value={String(d.completed)}
              note="Published campaign records"
            />
          </div>
        </div>
        <div className="hero-terminal">
          <Terminal data={d} />
        </div>
      </section>
      {((!d.demo && d.notice) || error) && (
        <div className="config-notice" role="status">
          <i className="dot amber" />
          <span>{error || d.notice}</span>
          <Link href="/treasury">Accounting details ↗</Link>
        </div>
      )}
      <Funding data={d} />
      <section className="how-section" id="how-it-works">
        <div>
          <span className="eyebrow">FROM THE CHART TO THE SCREEN</span>
          <h2>
            Trade. Build.
            <br />
            <em>Launch. Prove.</em>
          </h2>
          <p>
            Creator fees accrue in protocol vaults. Verified collections and
            reviewed advertising allocations fund a public treasury.
          </p>
        </div>
        <ol>
          {[
            [
              "01",
              "Trade",
              "Eligible Pump.fun and canonical PumpSwap trades generate creator fees.",
              Radio,
            ],
            [
              "02",
              "Build",
              "Collected creator fees are allocated to advertising. Founder funding is labeled separately.",
              Wallet,
            ],
            [
              "03",
              "Launch",
              "An administrator purchases a funded placement after written platform approval.",
              MonitorPlay,
            ],
            [
              "04",
              "Prove",
              "Commercials, dates, spend, receipts and placement evidence are published.",
              ScanLine,
            ],
          ].map(([n, title, text, Icon]: any) => (
            <li key={n}>
              <span className="step-number">{n}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
              <Icon size={22} />
            </li>
          ))}
        </ol>
      </section>
      <section className="panel feed-panel">
        <Section
          label="EVERY TRANSFER, ACCOUNTED FOR"
          title="Follow the funding."
        />
        <div className="panel-toolbar">
          <span>Finalized treasury transfers · reviewed classifications</span>
          <Link href="/treasury">Full ledger ↗</Link>
        </div>
        <Activity rows={d.activity.slice(0, 6)} />
      </section>
      <section className="airtime-stats">
        <div className="section-intro">
          <span className="eyebrow">SIX NUMBERS. ONE PUBLIC BUDGET.</span>
          <h2>The treasury, clearly.</h2>
        </div>
        <div className="stats-grid six">
          <Stat
            label="Lifetime verified creator fees"
            value={sol(d.accrued) + " SOL"}
            note="Accrued in indexed token history"
          />
          <Stat
            label="Currently available"
            value={sol(d.available) + " SOL"}
            note="Uncommitted, wallet-balance capped"
          />
          <Stat
            label="Committed to campaigns"
            value={sol(d.committed) + " SOL"}
            note="Reserved, unspent allocations"
          />
          <Stat
            label="Total advertising spend"
            value={sol(d.spent) + " SOL"}
            note="Manual and linked records, net refunds"
          />
          <Stat
            label="Campaigns completed"
            value={String(d.completed)}
            note="With spend and public evidence"
          />
          <Stat
            label="Current SOL price"
            value={d.price ? dollars(BigInt(d.price.micros) / 10000n) : "—"}
            note={
              d.price
                ? d.price.source +
                  " · " +
                  new Date(d.price.at).toLocaleTimeString("en-US", {
                    timeZone: "UTC",
                    hour: "2-digit",
                    minute: "2-digit",
                  }) +
                  " UTC"
                : "USD temporarily unavailable"
            }
          />
        </div>
      </section>
      <section className="panel preview-section">
        <Section
          label="THE NEXT REAL-WORLD MOMENT"
          title="From funding to the big screen."
        />
        {campaign ? (
          <CampaignCard campaign={campaign} funding={progress} />
        ) : (
          <Empty
            title={
              d.campaigns.length
                ? "The next campaign is being planned"
                : "The first campaign is being planned"
            }
            detail="A real milestone, commercial and approval status will be published here. No placement has been approved yet."
          />
        )}
      </section>
      <section className="limitations">
        <b>A budget you can follow.</b>
        <p>{DISCLOSURE}</p>
        <Link href="/disclosures">Read the disclosures ↗</Link>
      </section>
      <section className="faq">
        <div>
          <span className="eyebrow">BEFORE YOU TRADE</span>
          <h2>
            Clear records.
            <br />
            <em>Clear expectations.</em>
          </h2>
        </div>
        <div>
          {[
            [
              "Does holding AIRTIME give me treasury ownership?",
              "No. Holders have no ownership, revenue, dividend or profit rights. AIRTIME is speculative.",
            ],
            [
              "Do fees arrive automatically in the treasury?",
              "No. Fees may accrue in protocol-controlled creator vaults. Collection and treasury allocation are separately recorded; the operator handles collection and advertising purchases.",
            ],
            [
              "Is a planned platform already approved?",
              "Only a recorded approval with supporting evidence counts. Platforms may reject cryptocurrency advertising. Proposed placements are clearly marked.",
            ],
            [
              "What happens if a placement is rejected?",
              "Unspent commitments are released for another approved campaign. Actual spend and any refund remain in the public records.",
            ],
            [
              "Are all campaign records on-chain?",
              "Wallet transfers have transaction proof. Media receipts, placement evidence and campaign results are supplied by the administrator and labeled separately.",
            ],
            [
              "Why does the USD meter change?",
              "SOL’s market price changes. Current USD values use a recent sourced price; each ledger entry retains the price recorded at the time.",
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span>+</span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
