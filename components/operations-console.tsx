"use client";
import VibeOperations from "./vibe-operations";
import { useState, useEffect, useCallback } from "react";
import type { CreatorCampaign, CreatorInvoice } from "@/lib/platform/model";
import { transitions } from "@/lib/platform/model";
import { Stat, Badge, Empty, Explorer, short } from "./ui";
import { api } from "./creator-wallet";
import { dollars, sol } from "@/lib/accounting";
type Order = Omit<CreatorCampaign, "invoices"> & {
  creator_wallet: string;
  coin_name: string;
  ticker: string;
  invoices: (CreatorInvoice & {
    refund_state?: string;
    refund_reason?: string;
    refund_id?: string;
    refund_lamports?: string;
  })[];
};
type State = {
  financials: {
    media_spend_cents: string;
    partner_cost_cents: string;
    service_fee_cents: string;
  };
  campaigns: Order[];
  audit: {
    id: string;
    actor: string;
    action: string;
    entity_id: string;
    created_at: string;
  }[];
  sync: {
    last_success_at: string | null;
    last_webhook_at: string | null;
    error: string | null;
    alert: string | null;
  };
  failures: { signature: string; error: string; attempts: number }[];
  maintenance: boolean;
  page: number;
};
const checks = [
  "authority",
  "payment",
  "creativeRights",
  "riskDisclosure",
  "legalReview",
  "platformApproval",
] as const;
export default function OperationsConsole() {
  const [state, setState] = useState<State | null>(null),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [target, setTarget] = useState(""),
    [checklist, setChecklist] = useState<Record<string, boolean>>({}),
    [proof, setProof] = useState(""),
    [proofId, setProofId] = useState(""),
    [proofKind, setProofKind] = useState("APPROVAL"),
    [proofFile, setProofFile] = useState<File | null>(null),
    [platform, setPlatform] = useState(""),
    [externalId, setExternalId] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [spend, setSpend] = useState("0"),
    [cost, setCost] = useState("0"),
    [impressions, setImpressions] = useState("0"),
    [reach, setReach] = useState("0"),
    [cpm, setCpm] = useState("0"),
    [signature, setSignature] = useState(""),
    [publicProof, setPublicProof] = useState(false);
  const load = useCallback(async () => {
    const data = await api("/api/admin/operations?page=" + page);
    setState(data);
  }, [page]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const campaign = state?.campaigns.find((c) => c.id === selected);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setNotice("Saved to the campaign audit trail.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string, extra: Record<string, unknown> = {}) {
    await task(async () => {
      await api("/api/admin/operations", {
        action,
        id: selected,
        note,
        ...extra,
      });
    });
  }
  function select(c: Order) {
    setSelected(c.id);
    setTarget(transitions[c.status][0] || "");
    setNote("");
    setChecklist({});
    setProof(c.approval_proof_url || "");
    setProofId("");
    setPlatform(c.external_platform || "");
    setExternalId(c.external_campaign_id || "");
    setStart(
      c.actual_start ? new Date(c.actual_start).toISOString().slice(0, 16) : "",
    );
    setEnd(
      c.actual_end ? new Date(c.actual_end).toISOString().slice(0, 16) : "",
    );
    setSpend(c.media_spend_cents);
    setCost(c.platform_cost_cents);
    setImpressions(c.impressions ?? "0");
    setReach(c.reach ?? "0");
    setCpm(c.cpm_cents || "0");
    setPublicProof(false);
  }
  if (!state)
    return (
      <section className="panel">
        <h2>Campaign operations</h2>
        <p>{error || "Loading the submission queue…"}</p>
        {error && (
          <button
            className="button"
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Retry
          </button>
        )}
      </section>
    );
  return (
    <div className="operations-console">
      <VibeOperations />
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
      <div className="stats-grid operations-stats">
        <Stat
          label="Recorded media spend"
          value={dollars(state.financials.media_spend_cents)}
          note="Partner/operator delivery records"
        />
        <Stat
          label="Recorded partner cost"
          value={dollars(state.financials.partner_cost_cents)}
          note="Off-chain placement costs"
        />
        <Stat
          label="Service fees recorded"
          value={dollars(state.financials.service_fee_cents)}
          note="Paid invoices, excluding pending/verified refunds"
        />
      </div>
      <div className="panel operations-health">
        <div>
          <h3>Wallet-payment verification</h3>
          <p>
            Last sync:{" "}
            {state.sync.last_success_at
              ? new Date(state.sync.last_success_at).toISOString()
              : "Not synchronized"}
            <br />
            Webhook:{" "}
            {state.sync.last_webhook_at
              ? new Date(state.sync.last_webhook_at).toISOString()
              : "Not received"}
          </p>
          {state.sync.error && (
            <p className="error-message">{state.sync.error}</p>
          )}
          {state.sync.alert && <p className="notice">{state.sync.alert}</p>}
        </div>
        <div className="button-row">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              task(async () => {
                await api("/api/admin/resync", {});
              })
            }
          >
            Reconcile blockchain
          </button>
          <button
            className="button outline"
            disabled={busy}
            onClick={() =>
              action("MAINTENANCE", { enabled: !state.maintenance })
            }
          >
            {state.maintenance
              ? "Resume platform"
              : "Pause submissions & payments"}
          </button>
          <button
            className="button outline"
            onClick={() =>
              task(async () => {
                await api("/api/auth/logout", {});
                window.location.reload();
              })
            }
          >
            Sign out
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="campaign-card-top">
          <h2>Campaign submission queue</h2>
          <span className="badge neutral">Manual partner fulfillment</span>
        </div>
        {state.campaigns.length ? (
          <div
            className="table-wrap"
            role="region"
            tabIndex={0}
            aria-label="Creator campaign submissions"
          >
            <table>
              <thead>
                <tr>
                  <th>Coin / campaign</th>
                  <th>Creator</th>
                  <th>Budget / service fee</th>
                  <th>Status</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {state.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>
                        ${c.brief.ticker} — {c.title}
                      </strong>
                      <small>
                        {c.brief.targeting.geography} · adults{" "}
                        {c.brief.targeting.minAge}+
                      </small>
                    </td>
                    <td>
                      {short(c.creator_wallet)}
                      <Explorer address={c.mint} label="Coin proof" />
                    </td>
                    <td>
                      {dollars(c.media_budget_cents)}
                      <small>
                        {c.invoices.find((i) => i.status === "PAID")
                          ? dollars(
                              c.invoices.find((i) => i.status === "PAID")!
                                .platform_fee_cents,
                            ) + " fee"
                          : "Not finalized"}
                        {c.invoices.some((i) => i.refund_status === "VERIFIED")
                          ? " · refunded"
                          : ""}
                      </small>
                    </td>
                    <td>
                      <Badge status={c.status} />
                    </td>
                    <td>
                      <button
                        className="button outline"
                        onClick={() => select(c)}
                      >
                        Review order
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No creator submissions yet"
            detail="Authenticated creators’ campaigns will appear here. No campaign history is fabricated."
          />
        )}
        <div className="button-row">
          <button
            className="button outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            className="button outline"
            disabled={state.campaigns.length < 50}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </section>
      {campaign && (
        <section className="panel operation-review">
          <div className="campaign-card-top">
            <h2>{campaign.title}</h2>
            <Badge status={campaign.status} />
          </div>
          <div className="review-grid">
            <div>
              <div className="video-frame">
                <video
                  controls
                  preload="metadata"
                  src={"/api/creator/media?id=" + campaign.brief.creativeId}
                />
              </div>
              <p>{campaign.brief.description}</p>
              <p className="address-text">
                Creator: {campaign.creator_wallet}
                <br />
                Mint: {campaign.mint}
              </p>
              <p>Disclosure: {campaign.brief.disclosure}</p>
              <p>
                Objective: {campaign.brief.objective}
                <br />
                Audience: {campaign.brief.targeting.geography}{" "}
                {campaign.brief.targeting.location}, ages{" "}
                {campaign.brief.targeting.minAge}–
                {campaign.brief.targeting.maxAge}
                <br />
                {campaign.brief.targeting.interests.join(", ")} ·{" "}
                {campaign.brief.targeting.devices.join(", ")}
              </p>
              <a
                className="text-link"
                href={campaign.brief.destinationUrl || ""}
                target="_blank"
                rel="noopener noreferrer"
              >
                Destination ↗
              </a>
              {campaign.invoices.map((i) => (
                <div className="notice" key={i.id}>
                  <p>
                    Invoice {short(i.id)} · {sol(i.required_lamports)} SOL ·{" "}
                    {i.status}
                  </p>
                  <Explorer
                    signature={i.signature || undefined}
                    label="Finalized payment"
                  />
                  {i.refund_state && (
                    <p>
                      Refund: {i.refund_state} · {i.refund_reason}
                      <br />
                      Refund ID: {i.refund_id}
                      <br />
                      Exact amount:{" "}
                      {i.refund_lamports ? sol(i.refund_lamports) : "—"} SOL
                      <br />
                      Memo: AIRTIME:REFUND:{i.refund_id}
                    </p>
                  )}
                  {i.refund_signature && (
                    <Explorer
                      signature={i.refund_signature}
                      label="Finalized refund"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="form-grid">
              <label className="span-two">
                Creator-facing review message
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button
                className="button outline"
                disabled={busy || !note.trim()}
                onClick={() => action("MESSAGE")}
              >
                Send message
              </button>
              <label className="span-two">
                Next status
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Select next state</option>
                  {transitions[campaign.status]
                    .filter(
                      (s) =>
                        !["REFUND_PENDING", "REFUNDED", "PAID"].includes(s),
                    )
                    .map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </select>
              </label>
              <fieldset className="span-two">
                <legend>Approval checklist (all required to approve)</legend>
                {checks.map((c) => (
                  <label key={c} className="check-label">
                    <input
                      type="checkbox"
                      checked={!!checklist[c]}
                      onChange={(e) =>
                        setChecklist({ ...checklist, [c]: e.target.checked })
                      }
                    />
                    {c.replace(/([A-Z])/g, " $1")}
                  </label>
                ))}
              </fieldset>
              <label className="span-two">
                Actual approval proof URL
                <input
                  type="url"
                  value={proof}
                  onChange={(e) => setProof(e.target.value)}
                />
              </label>
              <label>
                External advertising platform
                <input
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                />
              </label>
              <label>
                External campaign ID
                <input
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                />
              </label>
              <label>
                Actual start (UTC)
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Actual end (UTC)
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <button
                className="button span-two"
                disabled={busy || !target}
                onClick={() =>
                  action("REVIEW", {
                    status: target,
                    ...(target === "APPROVED"
                      ? {
                          checklist,
                          approvalProofUrl: proof || undefined,
                          ...(proofKind === "APPROVAL" && proofId
                            ? { proofId }
                            : {}),
                        }
                      : {}),
                    ...(target === "SCHEDULED"
                      ? {
                          platform,
                          externalId,
                          actualStart: start
                            ? new Date(start + "Z").toISOString()
                            : undefined,
                          actualEnd: end
                            ? new Date(end + "Z").toISOString()
                            : undefined,
                        }
                      : {}),
                  })
                }
              >
                Record reviewed status
              </button>
            </div>
          </div>
          <details>
            <summary>Campaign reporting and proof</summary>
            <div className="form-grid">
              <label>
                Media spend (USD cents)
                <input
                  inputMode="numeric"
                  value={spend}
                  onChange={(e) => setSpend(e.target.value)}
                />
              </label>
              <label>
                Partner cost (USD cents)
                <input
                  inputMode="numeric"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                />
              </label>
              <label>
                Impressions reported
                <input
                  inputMode="numeric"
                  value={impressions}
                  onChange={(e) => setImpressions(e.target.value)}
                />
              </label>
              <label>
                Reach reported
                <input
                  inputMode="numeric"
                  value={reach}
                  onChange={(e) => setReach(e.target.value)}
                />
              </label>
              <label>
                CPM (USD cents)
                <input
                  inputMode="numeric"
                  value={cpm}
                  onChange={(e) => setCpm(e.target.value)}
                />
              </label>
              <label>
                Placement proof URL
                <input
                  type="url"
                  value={proof}
                  onChange={(e) => setProof(e.target.value)}
                />
              </label>
              <label className="check-label span-two">
                <input
                  type="checkbox"
                  checked={publicProof}
                  onChange={(e) => setPublicProof(e.target.checked)}
                />
                Publish completed placement proof with creator permission.
                Receipts and billing remain private.
              </label>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  action("REPORT", {
                    mediaSpendCents: spend,
                    platformCostCents: cost,
                    impressions,
                    reach,
                    cpmCents: cpm,
                    placementProofUrl: proof || undefined,
                    publicProof,
                    ...(proofKind !== "APPROVAL" && proofId ? { proofId } : {}),
                  })
                }
              >
                Save reporting
              </button>
              <label>
                Proof kind
                <select
                  value={proofKind}
                  onChange={(e) => setProofKind(e.target.value)}
                >
                  {["APPROVAL", "PLACEMENT", "RECEIPT"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Proof upload
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                />
              </label>
              <button
                className="button outline"
                disabled={busy || !proofFile}
                onClick={() =>
                  task(async () => {
                    const form = new FormData();
                    form.set("id", selected);
                    form.set("kind", proofKind);
                    form.set("file", proofFile!);
                    const r = await fetch("/api/admin/operations/upload", {
                        method: "POST",
                        body: form,
                      }),
                      data = await r.json();
                    if (!r.ok) throw Error(data.error);
                    setProofId(data.id);
                  })
                }
              >
                Upload private evidence
              </button>
              {proofId && (
                <p>
                  Uploaded proof: {short(proofId)} · attach via the matching
                  review/report action.
                </p>
              )}
            </div>
          </details>
          <details>
            <summary>Payment recovery and refund workflow</summary>
            <p>
              Refunds require a separate manual transfer from the configured
              payment wallet. AIRTIME never holds its key or signs the refund.
            </p>
            <label>
              Original payment / refund signature
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                className="button outline"
                disabled={busy || !signature}
                onClick={() => action("VERIFY_PAYMENT", { signature })}
              >
                Verify original payment
              </button>
              <button
                className="button outline"
                disabled={
                  busy || campaign.status !== "REJECTED" || !note.trim()
                }
                onClick={() => action("REFUND_REQUEST")}
              >
                Queue full unspent-order refund
              </button>
              <button
                className="button outline"
                disabled={
                  busy || campaign.status !== "REFUND_PENDING" || !signature
                }
                onClick={() => action("REFUND_VERIFY", { signature })}
              >
                Verify finalized refund
              </button>
            </div>
            <p>
              Use a System SOL transfer plus a memo of{" "}
              <code>AIRTIME:REFUND:REFUND_ID</code>. Find the exact refund ID in
              the database/admin audit record; the launch guide gives the
              operator procedure.
            </p>
          </details>
          <div className="creator-messages">
            <h3>Creator conversation</h3>
            {campaign.messages.map((m, i) => (
              <div className="message" key={i}>
                <small>
                  {m.sender === "AIRTIME" ? "Review team" : short(m.sender)} ·{" "}
                  {new Date(m.created_at).toISOString()}
                </small>
                <p>{m.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <h3>Sync failures</h3>
        {state.failures.length ? (
          state.failures.map((f) => (
            <div key={f.signature}>
              <Explorer signature={f.signature} />
              <p>
                {f.error} · {f.attempts} attempts
              </p>
              <button
                className="button outline"
                disabled={busy}
                onClick={() =>
                  task(async () => {
                    await api("/api/admin/resync", { signature: f.signature });
                  })
                }
              >
                Retry verification only
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No recorded synchronization failures.</p>
        )}
      </section>
      <section className="panel">
        <h3>Administrative audit log</h3>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Administrative audit log"
        >
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Actor</th>
                <th>Record</th>
                <th>Time (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {state.audit.map((a) => (
                <tr key={a.id}>
                  <td>{a.action}</td>
                  <td>{short(a.actor)}</td>
                  <td>{short(a.entity_id)}</td>
                  <td>{new Date(a.created_at).toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
