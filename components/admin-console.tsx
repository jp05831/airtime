// Legacy treasury UI retained for historical reference; not used by the creator platform.
"use client";
import { useState, useEffect, useCallback } from "react";
import type { Dashboard, Campaign } from "@/lib/types";
import { statuses } from "@/lib/types";
import { sol } from "@/lib/accounting";
import { Badge, Explorer } from "./ui";
const blank = {
  id: undefined as string | undefined,
  slug: "",
  title: "",
  description: "",
  targetUsdCents: "",
  platform: "",
  format: "",
  videoUrl: "",
  approvalStatus: "NOT SUBMITTED",
  approvalProofUrl: "",
  plannedStart: "",
  plannedEnd: "",
  results: "",
};
type State = {
  data: Dashboard;
  ledgerPage: number;
  ledgerTotal: number;
  sync: {
    last_success_at: string | null;
    last_webhook_at: string | null;
    error: string | null;
    alert: string | null;
  };
  alerts: { id: string; kind: string; message: string }[];
  collections: {
    id: string;
    signature: string;
    amount_lamports: string;
    venue: string;
  }[];
  failures: {
    signature: string;
    status: string;
    attempts: number;
    error: string | null;
  }[];
  expenses: { id: string; campaign_id: string; amount_lamports: string }[];
};
export default function AdminConsole() {
  const [ledgerPage, setLedgerPage] = useState(1);
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState(blank),
    [selected, setSelected] = useState(""),
    [amount, setAmount] = useState(""),
    [status, setStatus] = useState("PLANNING"),
    [note, setNote] = useState(""),
    [transactionId, setTransactionId] = useState(""),
    [proofUrl, setProofUrl] = useState(""),
    [proofTitle, setProofTitle] = useState(""),
    [proofKind, setProofKind] = useState("RECEIPT"),
    [ledgerId, setLedgerId] = useState(""),
    [kind, setKind] = useState("FOUNDER_SEED"),
    [collectionId, setCollectionId] = useState(""),
    [refundId, setRefundId] = useState(""),
    [signature, setSignature] = useState(""),
    [commitKey, setCommitKey] = useState(() => crypto.randomUUID()),
    [expenseKey, setExpenseKey] = useState(() => crypto.randomUUID());
  const load = useCallback(async () => {
    const r = await fetch("/api/admin/state?page=" + ledgerPage, {
        cache: "no-store",
      }),
      data = await r.json();
    if (!r.ok) throw Error(data.error);
    setState(data);
  }, [ledgerPage]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  async function mutate(path: string, payload: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/" + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      setMessage("Saved. The public records will update automatically.");
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function edit(c: Campaign) {
    setForm({
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      targetUsdCents: c.target_usd_cents,
      platform: c.platform,
      format: c.format,
      videoUrl: c.video_url || "",
      approvalStatus: c.approval_status,
      approvalProofUrl: c.approval_proof_url || "",
      plannedStart: c.planned_start
        ? new Date(c.planned_start).toISOString().slice(0, 16)
        : "",
      plannedEnd: c.planned_end
        ? new Date(c.planned_end).toISOString().slice(0, 16)
        : "",
      results: c.results,
    });
    setSelected(c.id);
  }
  if (!state)
    return (
      <div className="panel admin-login">
        {error ? (
          <>
            <p className="error">{error}</p>
            <button
              className="button"
              onClick={() => load().catch((e) => setError(e.message))}
            >
              Retry
            </button>
          </>
        ) : (
          <p role="status">Loading operator controls…</p>
        )}
      </div>
    );
  const d = state.data;
  return (
    <div className="admin-console">
      <div className="admin-toolbar">
        <span>Authenticated administrator · TOTP verified</span>
        <button
          className="button outline"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            location.reload();
          }}
        >
          Sign out
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <section className="panel admin-section">
        <h2>Launch configuration</h2>
        <p>
          Public wallet addresses only. AIRTIME never requests or stores Solana
          private keys.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutate("settings", d.settings);
          }}
        >
          <div className="form-grid">
            {[
              ["mint", "Token mint"],
              ["creator", "Creator wallet"],
              ["treasury", "Advertising treasury"],
              ["pumpUrl", "Pump.fun coin URL"],
              ["axiomUrl", "Axiom token URL"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required
                  value={String(d.settings[key as keyof typeof d.settings])}
                  onChange={(e) =>
                    setState({
                      ...state,
                      data: {
                        ...d,
                        settings: { ...d.settings, [key]: e.target.value },
                      },
                    })
                  }
                />
              </label>
            ))}
            <label>
              Advertising allocation (BPS)
              <input
                type="number"
                min="0"
                max="10000"
                step="1"
                required
                value={d.settings.allocationBps}
                onChange={(e) =>
                  setState({
                    ...state,
                    data: {
                      ...d,
                      settings: {
                        ...d.settings,
                        allocationBps: Number(e.target.value),
                      },
                    },
                  })
                }
              />
            </label>
          </div>
          <div className="check-controls">
            <label>
              <input
                type="checkbox"
                checked={d.settings.paused}
                onChange={(e) =>
                  setState({
                    ...state,
                    data: {
                      ...d,
                      settings: { ...d.settings, paused: e.target.checked },
                    },
                  })
                }
              />{" "}
              Pause public status synchronization
            </label>
            <label>
              <input
                type="checkbox"
                checked={d.settings.maintenance}
                onChange={(e) =>
                  setState({
                    ...state,
                    data: {
                      ...d,
                      settings: {
                        ...d.settings,
                        maintenance: e.target.checked,
                      },
                    },
                  })
                }
              />{" "}
              Emergency maintenance mode
            </label>
          </div>
          <button className="button" disabled={busy}>
            Save configuration
          </button>
        </form>
      </section>
      <section className="panel admin-section">
        <h2>Campaign milestones</h2>
        <div className="admin-campaign-list">
          {d.campaigns.map((c) => (
            <button
              key={c.id}
              className="button outline"
              onClick={() => edit(c)}
            >
              {c.title} · {c.status}
            </button>
          ))}
          <button className="button outline" onClick={() => setForm(blank)}>
            New campaign
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutate("campaigns", {
              ...form,
              plannedStart: form.plannedStart
                ? new Date(form.plannedStart).toISOString()
                : null,
              plannedEnd: form.plannedEnd
                ? new Date(form.plannedEnd).toISOString()
                : null,
            });
          }}
        >
          <div className="form-grid">
            {[
              ["title", "Title"],
              ["slug", "Public URL slug"],
              ["targetUsdCents", "Target USD (integer cents)"],
              ["platform", "Platform / placement"],
              ["format", "Commercial format"],
              ["videoUrl", "Commercial URL (HTTPS MP4 or preview link)"],
              ["approvalProofUrl", "Written approval evidence URL"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required={["title", "slug", "targetUsdCents"].includes(key)}
                  value={String(form[key as keyof typeof form] || "")}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <label>
              Platform approval
              <select
                value={form.approvalStatus}
                onChange={(e) =>
                  setForm({ ...form, approvalStatus: e.target.value })
                }
              >
                {[
                  "NOT SUBMITTED",
                  "SUBMITTED FOR REVIEW",
                  "APPROVED",
                  "REJECTED",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Planned start
              <input
                type="datetime-local"
                value={form.plannedStart}
                onChange={(e) =>
                  setForm({ ...form, plannedStart: e.target.value })
                }
              />
            </label>
            <label>
              Planned end
              <input
                type="datetime-local"
                value={form.plannedEnd}
                onChange={(e) =>
                  setForm({ ...form, plannedEnd: e.target.value })
                }
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <label>
            Campaign results
            <textarea
              value={form.results}
              onChange={(e) => setForm({ ...form, results: e.target.value })}
            />
          </label>
          <button className="button" disabled={busy}>
            {form.id ? "Update campaign" : "Create milestone"}
          </button>
        </form>
      </section>
      <section className="panel admin-section">
        <h2>Reserve, record & publish</h2>
        <p>
          Available advertising funds: {sol(d.available)} SOL. These controls
          record commitments and off-chain media purchases; they do not send
          blockchain transactions.
        </p>
        <label>
          Campaign
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a campaign</option>
            {d.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Amount (integer lamports)
            <input
              value={amount}
              inputMode="numeric"
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Spend note / classification rationale
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label>
            Matching treasury outflow
            <select
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
            >
              <option value="">Off-chain record — no chain proof</option>
              {d.activity
                .filter((t) => t.direction === "OUT" && t.status === "VERIFIED")
                .map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.signature.slice(0, 10)} · {sol(t.amount_lamports)} SOL
                  </option>
                ))}
            </select>
          </label>
          <label>
            Campaign status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {statuses
                .filter((v) => v !== "FUNDED")
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
          </label>
        </div>
        <div className="admin-actions">
          <button
            className="button"
            disabled={busy || !selected || !amount}
            onClick={async () => {
              if (
                await mutate("campaign-action", {
                  action: "commit",
                  campaignId: selected,
                  amount,
                  idempotencyKey: commitKey,
                })
              )
                setCommitKey(crypto.randomUUID());
            }}
          >
            Commit funds
          </button>
          <button
            className="button outline"
            disabled={busy || !selected || !amount || !note}
            onClick={async () => {
              if (
                await mutate("campaign-action", {
                  action: "expense",
                  campaignId: selected,
                  amount,
                  transactionId: transactionId || null,
                  note,
                  idempotencyKey: expenseKey,
                })
              )
                setExpenseKey(crypto.randomUUID());
            }}
          >
            Record actual spend
          </button>
          <button
            className="button outline"
            disabled={busy || !selected}
            onClick={() =>
              mutate("campaign-action", {
                action: "status",
                campaignId: selected,
                status,
              })
            }
          >
            Update campaign status
          </button>
        </div>
        <h3>Commercials, receipts & placement proof</h3>
        <div className="form-grid">
          <label>
            Proof type
            <select
              value={proofKind}
              onChange={(e) => setProofKind(e.target.value)}
            >
              {["VIDEO", "RECEIPT", "PLACEMENT", "RESULTS"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input
              value={proofTitle}
              onChange={(e) => setProofTitle(e.target.value)}
            />
          </label>
          <label>
            Public HTTPS proof URL
            <input
              type="url"
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
            />
          </label>
        </div>
        <button
          className="button"
          disabled={busy || !selected || !proofUrl || !proofTitle}
          onClick={() =>
            mutate("campaign-action", {
              action: "proof",
              campaignId: selected,
              kind: proofKind,
              title: proofTitle,
              url: proofUrl,
            })
          }
        >
          Publish proof link
        </button>
        <label>
          Or upload MP4 (25 MB max), PDF / PNG / JPEG (10 MB max)
          <input
            type="file"
            accept="video/mp4,application/pdf,image/png,image/jpeg"
            disabled={!selected || busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError("");
              const body = new FormData();
              body.set("file", file);
              body.set("campaignId", selected);
              body.set("kind", proofKind);
              try {
                const r = await fetch("/api/admin/upload", {
                    method: "POST",
                    body,
                  }),
                  result = await r.json();
                if (!r.ok) throw Error(result.error);
                setMessage("Proof uploaded.");
                await load();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
                e.target.value = "";
              }
            }}
          />
        </label>
      </section>
      <section className="panel admin-section">
        <h2>Review treasury transfers</h2>
        <p>
          Unknown deposits never fund the meter automatically. Creator-fee
          allocations need verified collection evidence and sufficient indexed
          token-fee accrual.
        </p>
        <div className="form-grid">
          <label>
            Transaction
            <select
              value={ledgerId}
              onChange={(e) => setLedgerId(e.target.value)}
            >
              <option value="">Select transfer</option>
              {d.activity.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.signature.slice(0, 12)} · {t.direction}{" "}
                  {sol(t.amount_lamports)} SOL · {t.kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Classification
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {[
                "CREATOR_FEE_COLLECTION",
                "FOUNDER_SEED",
                "TREASURY_DEPOSIT",
                "CAMPAIGN_EXPENDITURE",
                "REFUND",
                "ADMINISTRATIVE_ADJUSTMENT",
                "INTERNAL_TRANSFER",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Verified collection evidence
            <select
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
            >
              <option value="">Select for creator-fee allocation</option>
              {state.collections.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.venue} · {sol(c.amount_lamports)} SOL ·{" "}
                  {c.signature.slice(0, 10)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Original refunded expense
            <select
              value={refundId}
              onChange={(e) => setRefundId(e.target.value)}
            >
              <option value="">Select for refund</option>
              {state.expenses.map((e) => (
                <option value={e.id} key={e.id}>
                  {e.id.slice(0, 8)} · {sol(e.amount_lamports)} SOL
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Review explanation (at least 10 characters)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button
          className="button"
          disabled={busy || !ledgerId || note.length < 10}
          onClick={() =>
            mutate("ledger", {
              id: ledgerId,
              kind,
              note,
              collectionId:
                kind === "CREATOR_FEE_COLLECTION" ? collectionId || null : null,
              refundExpenseId: kind === "REFUND" ? refundId || null : null,
            })
          }
        >
          Record reviewed classification
        </button>
      </section>
      <section className="panel admin-section">
        <h2>Synchronization & webhook health</h2>
        <dl className="health-grid">
          <div>
            <dt>Last successful sync</dt>
            <dd>{state.sync?.last_success_at || "Not synchronized"}</dd>
          </div>
          <div>
            <dt>Last authenticated webhook</dt>
            <dd>{state.sync?.last_webhook_at || "No webhook received"}</dd>
          </div>
          <div>
            <dt>Sync failure</dt>
            <dd>{state.sync?.error || "None recorded"}</dd>
          </div>
          <div>
            <dt>History coverage</dt>
            <dd>{state.sync?.alert || "No backlog recorded"}</dd>
          </div>
        </dl>
        <label>
          Optional signature to reconcile
          <input
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={busy}
          onClick={() => mutate("resync", signature ? { signature } : {})}
        >
          {busy ? "Synchronizing…" : "Run finalized blockchain reconciliation"}
        </button>
        {state.failures.length > 0 && (
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Failed synchronization records"
          >
            <table>
              <thead>
                <tr>
                  <th>Signature</th>
                  <th>Retries</th>
                  <th>Failure</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {state.failures.map((f) => (
                  <tr key={f.signature}>
                    <td>
                      <Explorer signature={f.signature} />
                      <small>{f.signature.slice(0, 12)}…</small>
                    </td>
                    <td>{f.attempts}/12</td>
                    <td>{f.error || "Verification needs review"}</td>
                    <td>
                      <button
                        className="button outline"
                        disabled={busy}
                        onClick={() => {
                          setSignature(f.signature);
                          setMessage(
                            "Signature selected. Investigate the failure, then run reconciliation.",
                          );
                        }}
                      >
                        Select to reconcile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state.alerts.map((alert) => (
          <p className="notice" key={alert.id}>
            {alert.kind}: {alert.message}
          </p>
        ))}
      </section>
      <section className="panel admin-section">
        <h2>Treasury review ledger</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>State</th>
                <th>Proof</th>
              </tr>
            </thead>
            <tbody>
              {d.activity.map((t) => (
                <tr key={t.id}>
                  <td>{t.kind}</td>
                  <td>{sol(t.amount_lamports)} SOL</td>
                  <td>
                    <Badge status={t.status} />
                  </td>
                  <td>
                    <Explorer signature={t.signature} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>
            Page {state.ledgerPage} of{" "}
            {Math.max(1, Math.ceil(state.ledgerTotal / 20))} ·{" "}
            {state.ledgerTotal} records
          </span>
          <button
            className="button outline"
            disabled={busy || ledgerPage <= 1}
            onClick={() => setLedgerPage(ledgerPage - 1)}
          >
            Previous
          </button>
          <button
            className="button outline"
            disabled={busy || ledgerPage * 20 >= state.ledgerTotal}
            onClick={() => setLedgerPage(ledgerPage + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
