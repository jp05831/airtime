"use client";
import { useState } from "react";
import Link from "next/link";
import { Tv, Upload, ArrowRight, Check } from "lucide-react";
import type {
  CampaignInput,
  CreatorState,
  CreatorCampaign,
} from "@/lib/platform/model";

import { dollars } from "@/lib/accounting";
import { api } from "./creator-wallet";
import CampaignPayment from "./campaign-payment";
const steps = ["Coin", "Commercial", "Audience", "Approval", "Payment"];
export function centsInput(value: string) {
  if (!/^\d+(\.\d{0,2})?$/.test(value))
    throw Error("Enter a USD amount with up to two decimal places");
  const [w, f = ""] = value.split(".");
  return (BigInt(w) * 100n + BigInt(f.padEnd(2, "0"))).toString();
}
export default function CampaignBuilder({
  state,
  selectedMint,
  existing,
  onSaved,
}: {
  state: CreatorState;
  selectedMint?: string;
  existing?: CreatorCampaign;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(0),
    [data, setData] = useState<CampaignInput>(
      existing?.brief || {
        mint: selectedMint || state.coins[0]?.mint || "",
        title: "",
        coinName:
          state.coins.find((c) => c.mint === selectedMint)?.name ||
          state.coins[0]?.name ||
          "",
        ticker:
          state.coins.find((c) => c.mint === selectedMint)?.ticker ||
          state.coins[0]?.ticker ||
          "",
        pumpUrl: selectedMint
          ? "https://pump.fun/coin/" + selectedMint
          : state.coins[0]
            ? "https://pump.fun/coin/" + state.coins[0].mint
            : "",
        website: "",
        destinationUrl: "",
        description: "",
        objective: "Awareness",
        contactEmail: "",
        websiteVisible: true,
        creativeId: "",
        headline: "",
        cta: "Learn more",
        disclosure:
          "Cryptocurrency is speculative and highly volatile. No guaranteed returns.",
        qrUrl: "",
        targeting: {
          geography: "United States",
          location: "",
          minAge: 21,
          maxAge: 100,
          interests: [],
          devices: [],
        },
        mediaBudgetCents: state.config.minimumCents,
        durationDays: 7,
        proposedStart: new Date(Date.now() + 7 * 86400000)
          .toISOString()
          .slice(0, 10),
        publicProofConsent: false,
        rightsConfirmed: true,
        policyConfirmed: true,
      },
    ),
    [budget] = useState(
      existing
        ? dollars(existing.media_budget_cents).replace(/[$,]/g, "")
        : dollars(state.config.minimumCents).replace(/[$,]/g, ""),
    ),
    [file, setFile] = useState<File | null>(null),
    [thumbnail, setThumbnail] = useState<File | null>(null),
    [uploadName, setUploadName] = useState(
      state.uploads.find((u) => u.id === existing?.brief.creativeId)
        ?.original_name || "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [id, setId] = useState(existing?.id || ""),
    [rights, setRights] = useState(!!existing),
    [policy, setPolicy] = useState(!!existing),
    [websiteVisible, setWebsiteVisible] = useState(!!existing);
  const coin = state.coins.find((c) => c.mint === data.mint),
    invoice = state.invoices.find(
      (i) =>
        i.campaign_id === id &&
        ["OPEN", "VERIFYING", "PAID"].includes(i.status),
    );
  function patch(values: Partial<CampaignInput>) {
    setData((old) => ({ ...old, ...values }));
    setError("");
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      if (thumbnail) form.set("thumbnail", thumbnail);
      const r = await fetch("/api/creator/upload", {
          method: "POST",
          body: form,
        }),
        result = await r.json();
      if (!r.ok) throw Error(result.error);
      patch({ creativeId: result.id });
      setUploadName(result.name);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (!rights || !policy || !websiteVisible)
        throw Error(
          "Confirm creative rights and advertising policy acknowledgments",
        );
      const result = await api("/api/creator/campaigns", {
        ...data,
        mediaBudgetCents: centsInput(budget),
        rightsConfirmed: rights,
        policyConfirmed: policy,
        ...(id ? { id } : {}),
      });
      setId(result.id);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function next() {
    setError("");
    if (
      step === 0 &&
      (!coin ||
        !data.title ||
        !data.website ||
        !data.destinationUrl ||
        data.description.length < 20)
    ) {
      setError("Select a verified coin and complete the project details.");
      return;
    }
    if (
      step === 1 &&
      (!data.creativeId ||
        !data.headline ||
        !data.qrUrl ||
        data.disclosure.length < 20)
    ) {
      setError(
        "Upload a technically validated commercial and complete the creative details.",
      );
      return;
    }
    try {
      patch({ mediaBudgetCents: centsInput(budget) });
      setStep(Math.min(4, step + 1));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="campaign-builder">
      <div className="builder-steps" aria-label="Campaign creation steps">
        {steps.map((s, i) => (
          <button
            key={s}
            className={step === i ? "active" : step > i ? "complete" : ""}
            onClick={() => setStep(i)}
            aria-current={step === i ? "step" : undefined}
          >
            <span>{step > i ? <Check size={14} /> : i + 1}</span>
            {s}
          </button>
        ))}
      </div>
      <div className="builder-content">
        <section className="panel builder-form">
          <span className="eyebrow">
            STEP {step + 1} / {steps[step].toUpperCase()}
          </span>
          <h2>
            {
              [
                "Choose your coin.",
                "Your commercial, on screen.",
                "Find your audience.",
                "Submit for creative approval.",
                "Approve the exact payment.",
              ][step]
            }
          </h2>
          {step === 0 && (
            <div className="form-grid">
              <label className="span-two">
                Verified coin
                <select
                  value={data.mint}
                  onChange={(e) => {
                    const c = state.coins.find(
                      (c) => c.mint === e.target.value,
                    );
                    patch({
                      mint: e.target.value,
                      coinName: c?.name || "",
                      ticker: c?.ticker || "",
                      pumpUrl: "https://pump.fun/coin/" + e.target.value,
                    });
                  }}
                  disabled={!!existing}
                >
                  <option value="">Select a verified coin</option>
                  {state.coins.map((c) => (
                    <option key={c.mint} value={c.mint}>
                      ${c.ticker} — {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Coin name
                <input
                  value={data.coinName}
                  onChange={(e) => patch({ coinName: e.target.value })}
                />
              </label>
              <label>
                Ticker
                <input
                  value={data.ticker}
                  onChange={(e) => patch({ ticker: e.target.value })}
                />
              </label>
              <label className="span-two">
                Mint
                <input value={data.mint} readOnly className="address-text" />
              </label>
              <label className="span-two">
                Campaign title
                <input
                  value={data.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder="Our first streaming-TV campaign"
                />
              </label>
              <label>
                Pump.fun URL
                <input
                  type="url"
                  value={data.pumpUrl}
                  onChange={(e) => patch({ pumpUrl: e.target.value })}
                />
              </label>
              <label>
                Project website
                <input
                  type="url"
                  value={data.website || ""}
                  onChange={(e) => patch({ website: e.target.value })}
                  placeholder="https://yourproject.com"
                />
              </label>
              <label className="span-two">
                Advertisement destination URL
                <input
                  type="url"
                  value={data.destinationUrl || ""}
                  onChange={(e) => patch({ destinationUrl: e.target.value })}
                  placeholder="https://yourproject.com/about"
                />
              </label>
              <label className="span-two">
                Project description
                <textarea
                  rows={4}
                  value={data.description}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </label>
              <label>
                Campaign objective
                <select
                  value={data.objective}
                  onChange={(e) =>
                    patch({
                      objective: e.target.value as CampaignInput["objective"],
                    })
                  }
                >
                  {["Awareness"].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              <Link className="text-link" href="/dashboard/coins">
                Verify another coin ↗
              </Link>
            </div>
          )}
          {step === 1 && (
            <>
              <div className="creative-upload">
                <Upload size={28} />
                <h3>Upload your finished commercial</h3>
                <p>
                  5–90 seconds · H.264 MP4 · 16:9 · 720p minimum · 2,500 kbps ·
                  constant frame rate · audio required · up to 25 MB
                </p>
                <label>
                  Commercial
                  <input
                    type="file"
                    accept="video/mp4"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
                <label>
                  Thumbnail (optional, PNG/JPEG ≤2 MB)
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => setThumbnail(e.target.files?.[0] || null)}
                  />
                </label>
                <button
                  className="button"
                  disabled={busy || !file || !state.config.uploadsConfigured}
                  onClick={upload}
                >
                  {busy ? "Validating commercial…" : "Upload and validate"}
                </button>
                {!state.config.uploadsConfigured && (
                  <p className="notice">
                    Private commercial storage is awaiting operator
                    configuration.
                  </p>
                )}
                {uploadName && (
                  <p className="creative-valid">
                    <Check size={16} /> {uploadName} · technical format checked
                  </p>
                )}
              </div>
              {state.uploads.length > 0 && (
                <label>
                  Or reuse an unassigned commercial
                  <select
                    value={data.creativeId}
                    onChange={(e) => {
                      patch({ creativeId: e.target.value });
                      setUploadName(
                        state.uploads.find((u) => u.id === e.target.value)
                          ?.original_name || "",
                      );
                    }}
                  >
                    <option value="">Select upload</option>
                    {state.uploads.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.original_name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="form-grid">
                <label>
                  Headline
                  <input
                    value={data.headline}
                    onChange={(e) => patch({ headline: e.target.value })}
                  />
                </label>
                <label>
                  Call to action
                  <input
                    value={data.cta}
                    onChange={(e) => patch({ cta: e.target.value })}
                  />
                </label>
                <label className="span-two">
                  Required disclosure text
                  <textarea
                    value={data.disclosure}
                    onChange={(e) => patch({ disclosure: e.target.value })}
                  />
                </label>
                <label className="span-two">
                  QR-code destination
                  <input
                    type="url"
                    value={data.qrUrl || ""}
                    onChange={(e) => patch({ qrUrl: e.target.value })}
                    placeholder="https://yourproject.com"
                  />
                </label>
              </div>
              <button className="button outline" disabled>
                Create my commercial for me · Coming soon
              </button>
              <div className="notice">
                <strong>Creative review required</strong>
                <p>
                  Submitting a commercial does not guarantee placement.
                  Cryptocurrency advertising is subject to network, platform and
                  legal approval. Audio loudness and prohibited content are
                  checked manually.
                </p>
              </div>
            </>
          )}
          {step === 2 && (
            <div className="form-grid">
              <label>
                Geography
                <select
                  value={data.targeting.geography}
                  onChange={(e) =>
                    patch({
                      targeting: {
                        ...data.targeting,
                        geography: e.target
                          .value as CampaignInput["targeting"]["geography"],
                        location: "",
                      },
                    })
                  }
                >
                  {["United States", "State", "City / DMA"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              {data.targeting.geography !== "United States" && (
                <label>
                  Official Vibe location ID
                  <input
                    value={data.targeting.location}
                    placeholder="Select an ID from the location catalog below"
                    onChange={(e) =>
                      patch({
                        targeting: {
                          ...data.targeting,
                          location: e.target.value,
                          geoType:
                            data.targeting.geography === "State"
                              ? "REGION"
                              : "METRO",
                        },
                      })
                    }
                  />
                  <AudienceCatalog
                    onSelect={(id, type) =>
                      patch({
                        targeting: {
                          ...data.targeting,
                          location: id,
                          geoType: type,
                        },
                      })
                    }
                  />
                </label>
              )}
              <div className="notice span-two">
                Adults 21+ · Broad awareness. Placement depends on inventory,
                targeting and approval. No guaranteed delivery on any particular
                app or channel.
              </div>
            </div>
          )}
          {step === 3 && (
            <>
              <h3>The $50 campaign</h3>
              <p>
                {dollars(state.config.minimumCents)} media +{" "}
                {dollars(state.config.serviceFeeCents)} AIRTIME fee. Pay only
                after creative approval.
              </p>
              <label>
                Contact email
                <input
                  type="email"
                  value={data.contactEmail}
                  onChange={(e) => patch({ contactEmail: e.target.value })}
                />
              </label>
              <label>
                Proposed start
                <input
                  type="date"
                  value={data.proposedStart}
                  onChange={(e) => patch({ proposedStart: e.target.value })}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={websiteVisible}
                  onChange={(e) => setWebsiteVisible(e.target.checked)}
                />
                My website URL remains visible throughout the commercial. Vibe
                review must confirm compliance.
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(e) => setRights(e.target.checked)}
                />
                I hold all rights to this commercial.
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={policy}
                  onChange={(e) => setPolicy(e.target.checked)}
                />
                I accept the{" "}
                <Link href="/terms">terms and revision/refund policy</Link>.
              </label>
              <button
                className="button"
                disabled={busy || !websiteVisible}
                onClick={save}
              >
                {busy ? "Saving…" : "Save campaign draft"}
              </button>
              {id && (
                <button
                  className="button outline"
                  disabled={
                    busy ||
                    ![
                      "DRAFT",
                      "CHANGES_REQUESTED",
                      "CREATIVE_REJECTED",
                    ].includes(
                      state.campaigns.find((c) => c.id === id)?.status ||
                        "DRAFT",
                    )
                  }
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api("/api/creator/campaigns", {
                        action: "submit",
                        id,
                      });
                      onSaved();
                      setStep(4);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Submit for Vibe review
                </button>
              )}
              <p className="notice">
                {state.campaigns.find((c) => c.id === id)?.vibe
                  ?.review_reason ||
                  (
                    {
                      CREATIVE_PENDING:
                        "Your commercial is under review. Most reviews are completed quickly. You will only be asked to pay after approval.",
                      CREATIVE_REJECTED:
                        "Your commercial needs changes before it can run. No payment has been collected.",
                      APPROVED_AWAITING_PAYMENT:
                        "Your commercial is approved and ready to launch.",
                      PAID: "Payment confirmed. AIRTIME is preparing your $50 television campaign.",
                      READY_TO_ACTIVATE:
                        "Payment confirmed. AIRTIME is preparing your $50 television campaign.",
                      DELIVERING: "Your commercial is live.",
                    } as Record<string, string>
                  )[state.campaigns.find((c) => c.id === id)?.status || ""] ||
                  "Upload your commercial. Vibe reviews it before you pay."}
              </p>
            </>
          )}
          {step === 4 && (
            <>
              <dl className="invoice-summary">
                <div>
                  <dt>Media budget</dt>
                  <dd>{dollars(state.config.minimumCents)}</dd>
                </div>
                <div>
                  <dt>AIRTIME service fee</dt>
                  <dd>{dollars(state.config.serviceFeeCents)}</dd>
                </div>
                <div>
                  <dt>Total</dt>
                  <dd>{dollars(state.config.totalCents)} equivalent in SOL</dd>
                </div>
              </dl>
              {id &&
              [
                "APPROVED_AWAITING_PAYMENT",
                "QUOTE_ACTIVE",
                "PAYMENT_VERIFYING",
                "PAID",
              ].includes(
                state.campaigns.find((c) => c.id === id)?.status || "",
              ) ? (
                <CampaignPayment
                  campaignId={id}
                  invoice={invoice}
                  coin={coin}
                  onUpdate={onSaved}
                />
              ) : (
                <div className="notice">
                  Payment is locked until your commercial is approved.{" "}
                  {
                    state.campaigns.find((c) => c.id === id)?.vibe
                      ?.review_reason
                  }
                </div>
              )}
              <button className="button outline" onClick={onSaved}>
                Refresh review status
              </button>
              {id && (
                <Link className="text-link" href={"/dashboard/campaigns/" + id}>
                  View campaign and reporting ↗
                </Link>
              )}
            </>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="builder-controls">
            {step > 0 && (
              <button
                className="button outline"
                onClick={() => setStep(step - 1)}
              >
                Back
              </button>
            )}
            {step < 4 && (
              <button className="button" onClick={next}>
                Continue <ArrowRight size={16} />
              </button>
            )}
          </div>
        </section>
        <aside className="terminal builder-summary">
          <div className="terminal-header">CAMPAIGN PREVIEW</div>
          <div className="tv-preview">
            <div className="tv-screen">
              {data.creativeId ? (
                <video
                  controls
                  preload="metadata"
                  src={"/api/creator/media?id=" + data.creativeId}
                />
              ) : (
                <>
                  <Tv size={36} />
                  <span>
                    Your commercial
                    <br />
                    <em>belongs here.</em>
                  </span>
                </>
              )}
            </div>
          </div>
          <h3>${data.ticker || "YOURCOIN"}</h3>
          <p>{data.headline || "Your next big-screen debut"}</p>
          <dl>
            <div>
              <dt>Media budget</dt>
              <dd>
                {(() => {
                  try {
                    return dollars(centsInput(budget));
                  } catch {
                    return "Enter a budget";
                  }
                })()}
              </dd>
            </div>
            <div>
              <dt>Service fee</dt>
              <dd>{dollars(state.config.serviceFeeCents)}</dd>
            </div>
          </dl>
          <small>
            No forecast is shown without a provider-supported estimate. Reach,
            impressions, targeting availability and results are not guaranteed.
          </small>
        </aside>
      </div>
    </div>
  );
}

function AudienceCatalog({
  onSelect,
}: {
  onSelect: (id: string, type: "REGION" | "CITY" | "METRO") => void;
}) {
  const [search, setSearch] = useState(""),
    [type, setType] = useState<"REGION" | "CITY" | "METRO">("REGION"),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  return (
    <div>
      <select
        value={type}
        onChange={(e) => setType(e.target.value as typeof type)}
      >
        {["REGION", "CITY", "METRO"].map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search official locations"
      />
      <button
        type="button"
        className="button outline"
        onClick={async () => {
          try {
            const r = await fetch(
              "/api/creator/audience?type=" +
                type +
                "&search=" +
                encodeURIComponent(search),
            );
            const v = await r.json();
            if (!r.ok) throw Error(v.error);
            setRows(Array.isArray(v) ? v : v.data || []);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Search catalog
      </button>
      {rows.map((r) => (
        <button
          type="button"
          className="button outline"
          key={r.id}
          onClick={() => onSelect(String(r.id), type)}
        >
          {r.name || r.label || r.id}
        </button>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
