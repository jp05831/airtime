"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Wallet,
  Tv,
  Plus,
  Coins,
  LayoutDashboard,
  Receipt,
  User,
  LogOut,
  ArrowUpRight,
} from "lucide-react";
import type { CreatorState, CreatorCampaign } from "@/lib/platform/model";
import { dollars, sol } from "@/lib/accounting";
import { Badge, Empty, Explorer, Stat, short } from "./ui";
import { api, useCreatorWallet } from "./creator-wallet";
import CampaignBuilder from "./campaign-builder";
import CampaignPayment from "./campaign-payment";
export default function CreatorApp({
  initial,
  section,
  detail,
  selectedMint,
}: {
  initial: CreatorState;
  section: string;
  detail?: string;
  selectedMint?: string;
}) {
  const [state, setState] = useState(initial),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [mint, setMint] = useState(""),
    [message, setMessage] = useState("");
  const wallet = useCreatorWallet();
  const discoveryStarted = useRef(false);
  const load = useCallback(async (fees = false) => {
    const data = await api("/api/creator/state" + (fees ? "?fees=true" : ""));
    setState((old) => ({
      ...data,
      coins: fees
        ? data.coins
        : data.coins.map((c: any) => {
            const cached = old.coins.find((o) => o.mint === c.mint);
            return cached
              ? {
                  ...c,
                  authorityCurrent: cached.authorityCurrent,
                  claimableLamports: cached.claimableLamports,
                  curveLamports: cached.curveLamports,
                  ammLamports: cached.ammLamports,
                  claimedLamports: cached.claimedLamports,
                  claimable: cached.claimable,
                  feeNotice: cached.feeNotice,
                  sharing: cached.sharing,
                }
              : c;
          }),
    }));
  }, []);
  useEffect(() => {
    const timer = setInterval(
      () => load().catch((e) => setError(e.message)),
      20000,
    );
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (section !== "coins" || initial.coins.length || discoveryStarted.current)
      return;
    discoveryStarted.current = true;
    setBusy(true);
    api("/api/creator/coins", {})
      .then(async (result) => {
        setNotice(result.notice || "Coin discovery complete.");
        await load(true);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [section, initial.coins.length, load]);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function findCoin(auto = false) {
    await task(async () => {
      const result = await api("/api/creator/coins", auto ? {} : { mint });
      setNotice(result.notice || "Current coin authority verified.");
      setMint("");
      await load(true);
    });
  }
  const campaign = state.campaigns.find((c) => c.id === detail);
  const links = [
    ["", "Overview", LayoutDashboard],
    ["coins", "My Coins", Coins],
    ["campaigns", "Campaigns", Tv],
    ["create", "Create Campaign", Plus],
    ["billing", "Billing", Receipt],
    ["account", "Account", User],
  ] as const;
  function campaignCard(c: CreatorCampaign) {
    return (
      <article className="panel creator-campaign-card" key={c.id}>
        <div className="campaign-thumb">
          {c.brief.creativeId ? (
            <video
              preload="metadata"
              muted
              src={"/api/creator/media?id=" + c.brief.creativeId}
            />
          ) : (
            <Tv size={24} />
          )}
        </div>
        <div className="campaign-card-top">
          <span className="eyebrow">${c.brief.ticker}</span>
          <Badge status={c.status} />
        </div>
        <h3>{c.title}</h3>
        <p>
          {c.brief.targeting.geography} · Adults {c.brief.targeting.minAge}+ ·{" "}
          {c.duration_days} days
        </p>
        <dl>
          <div>
            <dt>Media budget</dt>
            <dd>{dollars(c.media_budget_cents)}</dd>
          </div>
          <div>
            <dt>Proposed start</dt>
            <dd>{String(c.proposed_start).slice(0, 10)}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>
              {c.submitted_at
                ? new Date(c.submitted_at).toISOString().slice(0, 10)
                : "Not submitted"}
            </dd>
          </div>
          <div>
            <dt>Impressions reported</dt>
            <dd>
              {c.impressions === null
                ? "Not available"
                : BigInt(c.impressions).toLocaleString("en-US")}
            </dd>
          </div>
        </dl>
        {c.messages.length > 0 && (
          <p className="notice">{c.messages.at(-1)?.body}</p>
        )}
        <Link className="button outline" href={"/dashboard/campaigns/" + c.id}>
          View Campaign <ArrowUpRight size={16} />
        </Link>
      </article>
    );
  }
  return (
    <main className="page-content creator-app">
      <div className="app-heading">
        <div>
          <span className="eyebrow">AIRTIME / CREATOR WORKSPACE</span>
          <h1>
            {section === "create"
              ? "Create your TV campaign."
              : campaign
                ? campaign.title
                : links.find((l) => l[0] === section)?.[1] || "Overview"}
          </h1>
        </div>
        <span className="wallet-chip">
          <Wallet size={16} />
          {short(state.identity.wallet)}
        </span>
      </div>
      <div className="app-layout">
        <aside className="panel app-sidebar">
          <nav aria-label="Creator dashboard navigation">
            {links.map(([slug, label, Icon]) => (
              <Link
                key={slug}
                href={"/dashboard" + (slug ? "/" + slug : "")}
                className={section === slug ? "active" : ""}
              >
                <Icon size={18} />
                {label}
              </Link>
            ))}
            <button
              onClick={() =>
                wallet.disconnect().catch((e) => setError(e.message))
              }
            >
              <LogOut size={18} />
              Disconnect
            </button>
          </nav>
          <small>
            Only your wallet’s coins, uploads and campaigns appear here.
          </small>
        </aside>
        <div className="app-main">
          {state.notice && <p className="notice">{state.notice}</p>}
          {state.config.maintenance && (
            <p className="notice">
              Campaign submissions and payments are paused for maintenance.
            </p>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {section === "" && (
            <>
              <div className="stats-grid creator-stats">
                <Stat
                  label="Eligible coins"
                  value={String(state.coins.length)}
                  note="Reverified before a new campaign"
                />
                <Stat
                  label="Active campaigns"
                  value={String(
                    state.campaigns.filter((c) =>
                      ["UPCOMING", "DELIVERING"].includes(c.status),
                    ).length,
                  )}
                  note="Recorded placements"
                />
                <Stat
                  label="In review"
                  value={String(
                    state.campaigns.filter((c) =>
                      [
                        "SUBMITTED_FOR_REVIEW",
                        "CREATIVE_PENDING",
                        "CREATIVE_UPLOADING",
                      ].includes(c.status),
                    ).length,
                  )}
                  note="Human compliance review"
                />
                <Stat
                  label="Total media spend"
                  value={dollars(
                    state.campaigns.reduce(
                      (n, c) => n + BigInt(c.media_spend_cents),
                      0n,
                    ),
                  )}
                  note="Administrator-recorded delivery spend"
                />
              </div>
              <div className="panel creator-welcome">
                <div>
                  <span className="eyebrow">YOUR NEXT BIG-SCREEN DEBUT</span>
                  <h2>
                    From your coin
                    <br />
                    <em>to their living room.</em>
                  </h2>
                  <p>
                    Verify a coin, build a campaign, and review every payment
                    before you sign.
                  </p>
                </div>
                <Link className="button" href="/dashboard/create">
                  <Plus size={18} />
                  Create Campaign
                </Link>
              </div>
              <div className="panel">
                <div className="campaign-card-top">
                  <h3>Recent campaign updates</h3>
                  <span>
                    {state.campaigns
                      .reduce((n, c) => n + BigInt(c.impressions ?? 0), 0n)
                      .toLocaleString("en-US")}{" "}
                    impressions reported
                  </span>
                </div>
                {state.campaigns.length ? (
                  <div className="status-list">
                    {state.campaigns.slice(0, 5).map((c) => (
                      <Link key={c.id} href={"/dashboard/campaigns/" + c.id}>
                        <div>
                          <strong>{c.title}</strong>
                          <small>
                            {c.messages.at(-1)?.body ||
                              "Your campaign status is recorded here."}
                          </small>
                        </div>
                        <Badge status={c.status} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Your first campaign starts here"
                    detail="Verify the wallet behind your coin, then create a reviewed television advertising request."
                  />
                )}
              </div>
            </>
          )}
          {section === "coins" && (
            <>
              <div className="panel coin-search">
                <h2>
                  Your coins. <em>Verified.</em>
                </h2>
                <p>
                  Discovery is a starting point. Current on-chain authority is
                  always checked before a campaign or claim.
                </p>
                <div className="button-row">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => findCoin(true)}
                  >
                    {busy ? "Checking…" : "Discover my Pump coins"}
                  </button>
                  <button
                    className="button outline"
                    disabled={busy}
                    onClick={() => task(() => load(true))}
                  >
                    Refresh fee balances
                  </button>
                </div>
                <label>
                  Manual mint verification
                  <div className="input-action">
                    <input
                      value={mint}
                      onChange={(e) => setMint(e.target.value)}
                      placeholder="Paste a Pump.fun mint address"
                    />
                    <button
                      className="button"
                      disabled={busy || !mint}
                      onClick={() => findCoin()}
                    >
                      Verify mint
                    </button>
                  </div>
                </label>
              </div>
              {state.coins.length ? (
                <div className="coin-grid">
                  {state.coins.map((c) => (
                    <article className="panel coin-card" key={c.mint}>
                      <div className="coin-identity">
                        {c.image_url ? (
                          <Image
                            unoptimized
                            src={c.image_url}
                            width={48}
                            height={48}
                            alt=""
                          />
                        ) : (
                          <span className="coin-placeholder">
                            <Coins size={24} />
                          </span>
                        )}
                        <div>
                          <span className="eyebrow">${c.ticker}</span>
                          <h3>{c.name}</h3>
                        </div>
                      </div>
                      <Badge
                        status={
                          c.authorityCurrent ? "VERIFIED" : "REVERIFY AUTHORITY"
                        }
                      />
                      <p>
                        {c.role.replaceAll("_", " ")} · {c.venue}
                      </p>
                      <dl>
                        <div>
                          <dt>Claimable vault funds</dt>
                          <dd>
                            {c.claimableLamports === null
                              ? "Exact amount unavailable"
                              : sol(c.claimableLamports) + " SOL"}
                          </dd>
                        </div>
                        <div>
                          <dt>Claims verified through AIRTIME</dt>
                          <dd>
                            {c.claimedLamports === null
                              ? "Not synchronized"
                              : sol(c.claimedLamports) + " SOL"}
                          </dd>
                        </div>
                        <div>
                          <dt>Market cap</dt>
                          <dd>
                            {c.market_cap_usd_cents
                              ? dollars(c.market_cap_usd_cents)
                              : "Unavailable"}
                          </dd>
                        </div>
                      </dl>
                      <small>
                        {c.feeNotice} Claim history is wallet-wide and includes
                        only AIRTIME-recorded claims.
                      </small>
                      <p className="address-text">Mint: {short(c.mint)}</p>
                      <Explorer address={c.mint} label="Mint explorer" />
                      <Link
                        className="button"
                        href={"/dashboard/create?mint=" + c.mint}
                      >
                        Create TV Campaign
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="panel">
                  <Empty
                    title="No verified coins yet"
                    detail="Try discovery or paste your mint. Only wallets with proven current authority can create a campaign."
                  />
                </div>
              )}
            </>
          )}
          {section === "create" &&
            (state.coins.length ? (
              <CampaignBuilder
                key={detail || selectedMint || "new"}
                state={state}
                selectedMint={selectedMint}
                existing={
                  detail
                    ? state.campaigns.find((c) => c.id === detail)
                    : undefined
                }
                onSaved={() => load().catch((e) => setError(e.message))}
              />
            ) : (
              <div className="panel">
                <Empty
                  title="Verify your first coin"
                  detail="Connect the wallet behind your coin and verify its mint before building a campaign."
                />
                <Link className="button" href="/dashboard/coins">
                  Go to My Coins
                </Link>
              </div>
            ))}
          {section === "campaigns" &&
            !detail &&
            (state.campaigns.length ? (
              <div className="creator-campaign-grid">
                {state.campaigns.map(campaignCard)}
              </div>
            ) : (
              <div className="panel">
                <Empty
                  title="No campaigns yet"
                  detail="Your private campaign drafts, reviews and delivery reports will appear here."
                />
                <Link className="button" href="/dashboard/create">
                  Create Campaign
                </Link>
              </div>
            ))}
          {section === "campaigns" &&
            detail &&
            (campaign ? (
              <>
                <div className="panel campaign-detail">
                  <div className="campaign-card-top">
                    <h2>${campaign.brief.ticker}</h2>
                    <Badge status={campaign.status} />
                  </div>
                  <div className="video-frame">
                    <video
                      controls
                      preload="metadata"
                      src={"/api/creator/media?id=" + campaign.brief.creativeId}
                    />
                  </div>
                  <p>{campaign.brief.description}</p>
                  <dl>
                    <div>
                      <dt>Media budget</dt>
                      <dd>{dollars(campaign.media_budget_cents)}</dd>
                    </div>
                    <div>
                      <dt>Targeting</dt>
                      <dd>
                        {campaign.brief.targeting.geography} ·{" "}
                        {campaign.brief.targeting.minAge}–
                        {campaign.brief.targeting.maxAge}
                      </dd>
                    </div>
                    <div>
                      <dt>Proposed dates</dt>
                      <dd>
                        {String(campaign.proposed_start).slice(0, 10)} ·{" "}
                        {campaign.duration_days} days
                      </dd>
                    </div>
                    <div>
                      <dt>External placement</dt>
                      <dd>
                        {campaign.external_platform || "Awaiting approval"}{" "}
                        {campaign.external_campaign_id || ""}
                      </dd>
                    </div>
                    <div>
                      <dt>Impressions / reach</dt>
                      <dd>
                        {campaign.impressions === null
                          ? "Not available"
                          : BigInt(campaign.impressions).toLocaleString(
                              "en-US",
                            )}{" "}
                        /{" "}
                        {campaign.reach === null
                          ? "Not available"
                          : BigInt(campaign.reach).toLocaleString("en-US")}
                      </dd>
                    </div>
                  </dl>
                  {campaign.placement_proof_url && (
                    <a
                      className="text-link"
                      href={campaign.placement_proof_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Placement proof ↗
                    </a>
                  )}
                  {["DRAFT", "CHANGES_REQUESTED", "CREATIVE_REJECTED"].includes(
                    campaign.status,
                  ) && (
                    <Link
                      className="button outline"
                      href={"/dashboard/create/" + campaign.id}
                    >
                      Edit campaign
                    </Link>
                  )}
                  {["DRAFT", "CHANGES_REQUESTED", "CREATIVE_REJECTED"].includes(
                    campaign.status,
                  ) && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        task(async () => {
                          await api("/api/creator/campaigns", {
                            action: "submit",
                            id: campaign.id,
                          });
                          setNotice(
                            "Submitted for Vibe creative review. Payment follows approval.",
                          );
                          await load();
                        })
                      }
                    >
                      Submit for review
                    </button>
                  )}
                </div>
                {[
                  "APPROVED_AWAITING_PAYMENT",
                  "QUOTE_ACTIVE",
                  "PAYMENT_VERIFYING",
                ].includes(campaign.status) && (
                  <CampaignPayment
                    key={campaign.id}
                    campaignId={campaign.id}
                    invoice={campaign.invoices.find((i) =>
                      ["OPEN", "VERIFYING", "PAID"].includes(i.status),
                    )}
                    coin={state.coins.find((c) => c.mint === campaign.mint)}
                    onUpdate={() => load().catch((e) => setError(e.message))}
                  />
                )}
                {["PAID", "READY_TO_ACTIVATE", "ACTIVATING"].includes(
                  campaign.status,
                ) && (
                  <p className="notice">
                    Payment confirmed. AIRTIME is preparing your $50 television
                    campaign.
                  </p>
                )}
                {campaign.status === "CREATIVE_PENDING" && (
                  <p className="notice">
                    Your commercial is under review. Most reviews are completed
                    quickly. You will only be asked to pay after approval.
                  </p>
                )}
                {campaign.status === "CREATIVE_REJECTED" && (
                  <p className="notice">
                    Your commercial needs changes before it can run. No payment
                    has been collected.
                  </p>
                )}
                {campaign.status === "DELIVERING" && (
                  <p className="notice">Your commercial is live.</p>
                )}
                {campaign.vibe && (
                  <div className="panel">
                    <h3>Vibe review & reporting</h3>
                    <p>
                      {campaign.vibe.review_status ||
                        "Review awaiting synchronization"}{" "}
                      · {campaign.vibe.delivery_status || "Not activated"}
                    </p>
                    {campaign.vibe.review_reason && (
                      <p>{campaign.vibe.review_reason}</p>
                    )}
                    <p>
                      Last synchronized:{" "}
                      {campaign.vibe.last_synced_at
                        ? new Date(
                            campaign.vibe.last_synced_at,
                          ).toLocaleString()
                        : "Awaiting first synchronization"}
                    </p>
                    <dl className="invoice-summary">
                      {[
                        "spend_microusd",
                        "impressions",
                        "completed_views",
                        "households",
                        "view_through_rate",
                        "cpm",
                        "frequency",
                      ].map((key) => (
                        <div key={key}>
                          <dt>
                            {key === "spend_microusd"
                              ? "Media spend (USD)"
                              : key.replaceAll("_", " ")}
                          </dt>
                          <dd>
                            {campaign.vibe?.metrics?.[key] == null
                              ? "Not available"
                              : key === "spend_microusd"
                                ? dollars(
                                    (BigInt(campaign.vibe.metrics[key]) +
                                      5000n) /
                                      10000n,
                                  )
                                : campaign.vibe.metrics[key]}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {campaign.vibe.channels.length > 0 && (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Channel / geography</th>
                              <th>Impressions</th>
                              <th>Spend (USD)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {campaign.vibe.channels.map((row: any) => (
                              <tr key={row.id}>
                                <td>
                                  {row.dimension} · {row.label}
                                </td>
                                <td>
                                  {row.metrics.impressions ?? "Not available"}
                                </td>
                                <td>{row.metrics.spend ?? "Not available"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                <div className="panel creator-messages">
                  <h3>Campaign messages</h3>
                  {campaign.messages.length ? (
                    campaign.messages.map((m, i) => (
                      <div className="message" key={i}>
                        <span className="eyebrow">
                          {m.sender === "AIRTIME"
                            ? "AIRTIME review team"
                            : "You"}{" "}
                          · {new Date(m.created_at).toISOString().slice(0, 10)}
                        </span>
                        <p>{m.body}</p>
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      Review updates and requests for changes will appear here.
                    </p>
                  )}
                  <label>
                    Message the review team
                    <textarea
                      rows={3}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </label>
                  <button
                    className="button"
                    disabled={busy || !message.trim()}
                    onClick={() =>
                      task(async () => {
                        await api("/api/creator/campaigns", {
                          action: "message",
                          id: campaign.id,
                          message,
                        });
                        setMessage("");
                        await load();
                      })
                    }
                  >
                    Send campaign message
                  </button>
                </div>
              </>
            ) : (
              <div className="panel">
                <Empty
                  title="Campaign not found"
                  detail="This campaign does not belong to the connected account."
                />
              </div>
            ))}
          {section === "billing" && (
            <div className="panel">
              <h2>Invoices & on-chain proof</h2>
              <p>
                Fixed-price invoices, finalized payments and verified refunds
                for your wallet.
              </p>
              {state.invoices.length ? (
                <div
                  className="table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Your campaign billing"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Media / service fee</th>
                        <th>Total / SOL</th>
                        <th>Status</th>
                        <th>Proof & receipt</th>
                        <th>Refund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.invoices.map((i) => (
                        <tr key={i.id}>
                          <td>
                            <Link
                              href={"/dashboard/campaigns/" + i.campaign_id}
                            >
                              {short(i.id)}
                            </Link>
                            <small>
                              {new Date(i.created_at)
                                .toISOString()
                                .slice(0, 10)}
                            </small>
                          </td>
                          <td>
                            {dollars(i.media_budget_cents)}
                            <small>
                              {dollars(i.platform_fee_cents)} AIRTIME fee
                            </small>
                          </td>
                          <td>
                            {dollars(i.total_usd_cents)}
                            <small>{sol(i.required_lamports)} SOL</small>
                          </td>
                          <td>
                            <Badge status={i.status} />
                          </td>
                          <td>
                            {i.signature ? (
                              <Explorer
                                signature={i.signature}
                                label="Payment proof"
                              />
                            ) : (
                              <small>Not finalized</small>
                            )}
                            <a
                              className="text-link"
                              href={"/api/creator/receipt?id=" + i.id}
                            >
                              Download invoice ↗
                            </a>
                          </td>
                          <td>
                            {i.refund_status}
                            <Explorer
                              signature={i.refund_signature || undefined}
                              label="Refund proof"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="No invoices yet"
                  detail="An approved commercial unlocks your five-minute fixed SOL quote."
                />
              )}
            </div>
          )}
          {section === "account" && (
            <div className="panel account-panel">
              <h2>Your creator account</h2>
              <p className="address-text">{state.identity.wallet}</p>
              <p>
                Access is authenticated by an expiring gasless signature.
                Campaign payments always require a new wallet approval. AIRTIME
                never asks for your seed phrase or stores your wallet key.
              </p>
              <div className="button-row">
                <button className="button" onClick={wallet.open}>
                  Reconnect signing wallet
                </button>
                <button
                  className="button outline"
                  onClick={() =>
                    wallet.disconnect().catch((e) => setError(e.message))
                  }
                >
                  Disconnect & sign out
                </button>
              </div>
              <Explorer address={state.identity.wallet} />
              <Link className="text-link" href="/privacy">
                Privacy notice ↗
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
