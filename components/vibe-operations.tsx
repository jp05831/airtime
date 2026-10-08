"use client";
import { useEffect, useState } from "react";
import { api } from "./creator-wallet";
import { Stat } from "./ui";
import { dollars, sol } from "@/lib/accounting";
export default function VibeOperations() {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [invoice, setInvoice] = useState(""),
    [reference, setReference] = useState(""),
    [status, setStatus] = useState("CONVERTED");
  async function load() {
    const r = await fetch("/api/admin/vibe");
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    setState(data);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function action(payload: any) {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/vibe", payload);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel operations-health">
      <h2>Automated Vibe operations</h2>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {!state ? (
        <p>Loading provider health…</p>
      ) : (
        <>
          <p className="notice">
            {state.gates.blocked ||
              "Activation enabled for approved, finalized paid orders."}
          </p>
          <Stat
            label="Global activation"
            value={state.gates.live ? "Live mode" : "Prelaunch / test mode"}
            note="Creative review is available before payment. Only live mode permits publishing."
          />
          <div className="button-row">
            <button
              className="button outline"
              disabled={busy}
              onClick={() => action({ action: "CONNECTIVITY" })}
            >
              Check read-only connection
            </button>
            <button
              className="button outline"
              disabled={busy}
              onClick={() => action({ action: "SYNC" })}
            >
              Synchronize campaigns
            </button>
          </div>
          <h3>Campaign queue</h3>
          <div className="status-list">
            {state.counts.map((r: any) => (
              <p key={r.status}>
                {r.status.replaceAll("_", " ")} <strong>{r.count}</strong>
              </p>
            ))}
            {!state.counts.length && <p>No automated campaigns yet.</p>}
          </div>
          <h3>Campaign operations</h3>
          {(state.orders || []).map((r: any) => (
            <article
              className="panel"
              key={r.id}
              style={{ overflowWrap: "anywhere" }}
            >
              <h4>
                {r.coin_name} · {r.coin_symbol} ·{" "}
                {r.status.replaceAll("_", " ")}
              </h4>
              <p>
                Creator: {r.wallet}
                <br />
                Mint: {r.mint}
              </p>
              <p>
                Creative: {r.creative_id || "Awaiting upload"} ·{" "}
                {r.approval_status || "Not reviewed"} {r.rejection_reason}
              </p>
              <p>
                Quote: {r.invoice_id || "Not issued"} · expires{" "}
                {r.quote_expires_at || "—"}
                <br />
                {r.amount_lamports
                  ? sol(r.amount_lamports) + " SOL / $60.00"
                  : "No payment requested"}{" "}
                · reference {r.payment_reference || "—"}
              </p>
              <p>Verified payment: {r.payment_signature || "Not received"}</p>
              <p>
                $50 reserved media · $10 service fee (recorded after confirmed
                payment)
              </p>
              <p>
                Vibe campaign: {r.vibe_campaign_id || "Not provisioned"}
                <br />
                Strategy: {r.strategy_id || "Not provisioned"}
              </p>
              <p>
                Provisioning: {r.job_status || "Not queued"} ·{" "}
                {r.provisioning_attempts || 0} failed attempts · {r.job_error}
              </p>
              <p>
                Reported spend:{" "}
                {r.spend_microusd == null
                  ? "Unavailable"
                  : dollars((BigInt(r.spend_microusd) + 9999n) / 10000n)}{" "}
                · Remaining media:{" "}
                {r.payment_signature
                  ? dollars(
                      (BigInt(r.remaining_media_microusd) + 9999n) / 10000n,
                    )
                  : "Not reserved"}
                <br />
                Impressions: {r.impressions ?? "Unavailable"} · Completed views:{" "}
                {r.completed_views ?? "Unavailable"}
              </p>
            </article>
          ))}
          <h3>Settlements</h3>
          {state.settlements.map((r: any) => (
            <p key={r.status}>
              {r.status}: {sol(r.sol_collected_lamports)} SOL collected ·{" "}
              {dollars(r.media_allocation_cents)} media allocation ·{" "}
              {dollars(r.service_fee_cents)} AIRTIME fees ·{" "}
              {dollars((BigInt(r.media_liability_microusd) + 9999n) / 10000n)}{" "}
              remaining media liability · {sol(r.refunded_lamports)} SOL
              refunded
            </p>
          ))}
          <p>
            Vibe billing is aggregated across campaigns. Account balance is an
            outstanding billing amount, not a per-campaign card charge.
          </p>
          {state.balance.map((r: any) => (
            <p key={r.account_id}>
              {r.currency} outstanding:{" "}
              {r.balance_cents == null
                ? "Unavailable"
                : dollars(r.balance_cents)}{" "}
              · {r.last_synced_at || "Not synchronized"}
            </p>
          ))}
          <div className="form-grid">
            <label>
              Invoice ID
              <input
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
              />
            </label>
            <label>
              Settlement stage
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {["CONVERTED", "VIBE_FUNDED", "RECONCILED", "FAILED"].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              External settlement evidence/reference
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <button
              className="button outline"
              disabled={busy || !invoice || !reference}
              onClick={() =>
                action({
                  action: "SETTLEMENT",
                  invoiceId: invoice,
                  status,
                  reference,
                })
              }
            >
              Record settlement
            </button>
          </div>
          <h3>Alerts</h3>
          {state.alerts.length ? (
            state.alerts.map((r: any) => (
              <p className="notice" key={r.id}>
                {r.kind}: {r.message}
              </p>
            ))
          ) : (
            <p>
              No recorded alerts. This does not imply provider connectivity has
              been tested.
            </p>
          )}
          <h3>Worker history</h3>
          {state.runs.map((r: any) => (
            <p key={r.id}>
              {r.status} · {r.started_at} · {r.processed} processed {r.error}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
