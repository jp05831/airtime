// Legacy treasury UI retained for historical reference; not used by the creator platform.
import { Radio, ArrowUpRight, MonitorPlay, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { dollars, sol, usdCents, percentBps } from "@/lib/accounting";
import type { Dashboard } from "@/lib/types";
import { Explorer, short, Badge } from "./ui";
export function fundingProgress(d: Dashboard) {
  const c = d.campaigns.find(
    (c) => !["COMPLETED", "REJECTED", "SCHEDULED", "LIVE"].includes(c.status),
  );
  const funds =
    BigInt(d.available) +
    (c ? BigInt(c.committed_lamports) - BigInt(c.spent_lamports) : 0n);
  const cents = d.price ? usdCents(funds, BigInt(d.price.micros)) : null;
  return {
    c,
    funds,
    cents,
    bps:
      c && cents !== null ? percentBps(cents, BigInt(c.target_usd_cents)) : 0,
  };
}
export function Terminal({ data: d }: { data: Dashboard }) {
  const { c, bps } = fundingProgress(d),
    live = !!d.settings.mint && !d.notice && !d.demo;
  const video = c?.video_url;
  return (
    <div className="terminal broadcast-terminal">
      <div className="terminal-bar">
        <span className="terminal-logo">AIRTIME / Broadcast desk</span>
        <span className="terminal-status">
          <i className={"dot " + (live ? "neutral" : "amber")} />
          {d.demo
            ? "Demo preview"
            : live
              ? "Tracking mainnet"
              : d.settings.paused || d.settings.maintenance
                ? "Updates paused"
                : d.settings.mint && d.settings.treasury
                  ? "Sync delayed"
                  : "Awaiting launch"}
        </span>
      </div>
      <div className="terminal-tabs">
        <span className="selected">Next transmission</span>
        <Link href="/campaigns">Campaign archive ↗</Link>
      </div>
      <div className="terminal-body">
        <div className="broadcast-screen">
          {video && /\.mp4(?:\?|$)/i.test(video) ? (
            <video
              controls
              preload="metadata"
              src={video}
              aria-label="Campaign commercial preview"
            />
          ) : (
            <>
              <MonitorPlay size={48} strokeWidth={1} />
              <span>
                {c ? "Creative preview pending" : "Your next real-world moment"}
              </span>
              <small>
                {c
                  ? "Commercial will appear when uploaded."
                  : "An ad. A public budget. Proof you can watch."}
              </small>
            </>
          )}
        </div>
        <div className="broadcast-identity">
          <span className="eyebrow">UP NEXT</span>
          <h3>{c?.title || "Next campaign pending"}</h3>
          <p>{c?.format || "Television · streaming · real-world media"}</p>
        </div>
        <div className="terminal-metrics">
          <div>
            <span>Advertising allocation</span>
            <strong>{d.settings.allocationBps / 100}%</strong>
            <small>of eligible verified creator fees</small>
          </div>
          <div>
            <span>Platform review</span>
            <strong className="review-value" data-status={c?.approval_status}>
              {c?.approval_status === "APPROVED"
                ? "Approved"
                : c?.approval_status === "REJECTED"
                  ? "Rejected"
                  : c?.approval_status === "SUBMITTED FOR REVIEW"
                    ? "Submitted"
                    : "Pending"}
            </strong>
            <small>{c?.platform || "Placement not yet selected"}</small>
          </div>
        </div>
        <div className="terminal-record">
          <div className="terminal-subtitle">
            <h4>
              <Radio size={16} /> Campaign readiness
            </h4>
            <span>{d.price ? (bps / 100).toFixed(2) + "%" : "—"}</span>
          </div>
          <div
            className="meter dark"
            role="progressbar"
            aria-label="Campaign funding"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bps / 100}
          >
            <span style={{ width: bps / 100 + "%" }} />
          </div>
          <small>Funding and written platform approval are required.</small>
        </div>
        <div className="terminal-foot">
          <span>
            <ShieldCheck size={13} /> Read-only treasury tracking
          </span>
          <span>No holder returns</span>
        </div>
      </div>
    </div>
  );
}
export default function Funding({ data: d }: { data: Dashboard }) {
  const { c, funds, cents, bps } = fundingProgress(d);
  const remaining =
    c && cents !== null
      ? BigInt(c.target_usd_cents) > cents
        ? BigInt(c.target_usd_cents) - cents
        : 0n
      : null;
  return (
    <section id="live-funding" className="panel funding-card">
      <div className="funding-top">
        <div>
          <span className="eyebrow">NEXT AIRTIME DROP</span>
          <h2>
            {c?.title ||
              (d.campaigns.length
                ? "The next campaign starts here."
                : "The first campaign starts here.")}
          </h2>
          <p>
            {c
              ? c.format || "Media format to be confirmed"
              : "Campaign milestones will appear when the launch plan is published."}
          </p>
        </div>
        <Badge status={c?.status || "PLANNING"} />
      </div>
      <div className="funding-values">
        <div>
          <strong>{cents === null ? "—" : dollars(cents)}</strong>
          <span>available toward this campaign{d.demo ? " · Demo" : ""}</span>
        </div>
        <div>
          <strong>{c ? dollars(c.target_usd_cents) : "—"}</strong>
          <span>campaign target</span>
        </div>
        <div className="funding-percentage">
          <strong>{d.price && c ? (bps / 100).toFixed(2) + "%" : "—"}</strong>
          <span>funded at current SOL price</span>
        </div>
      </div>
      <div
        className="meter"
        role="progressbar"
        aria-label="Next campaign funding"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bps / 100}
      >
        <span style={{ width: bps / 100 + "%" }} />
      </div>
      <div className="funding-detail">
        <span>
          <b>{sol(funds)} SOL</b> available for this campaign
        </span>
        <span>
          <b>{remaining === null ? "USD unavailable" : dollars(remaining)}</b>{" "}
          remaining
        </span>
        <span>
          {!c
            ? "Awaiting launch milestone"
            : bps === 10000
              ? "Target reached · operator review required"
              : "Building the advertising budget"}
        </span>
      </div>
      <div className="funding-bottom">
        <div>
          <small>PUBLIC ADVERTISING TREASURY</small>
          {d.settings.treasury ? (
            <>
              <span>{short(d.settings.treasury)}</span>{" "}
              <Explorer address={d.settings.treasury} />
            </>
          ) : (
            <span>Address published at launch</span>
          )}
        </div>
        <div>
          <small>LAST SYNCHRONIZED</small>
          <span>
            {d.syncAt
              ? new Date(d.syncAt).toLocaleString("en-US", {
                  timeZone: "UTC",
                }) + " UTC"
              : "Tracking begins at launch"}
          </span>
        </div>
        <Link className="text-link" href="/treasury">
          Full treasury ledger <ArrowUpRight size={16} />
        </Link>
      </div>
      {!d.price && (
        <p className="funding-price-note">
          USD pricing is temporarily unavailable. Verified SOL values remain
          visible.
        </p>
      )}
      {d.demo && (
        <p className="funding-price-note">
          Illustrative founder funding only. No live transactions or platform
          approval.
        </p>
      )}
    </section>
  );
}
