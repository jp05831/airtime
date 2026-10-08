"use client";
import { useState } from "react";
import { Wallet, ShieldCheck } from "lucide-react";
import { api, useCreatorWallet } from "./creator-wallet";
import { dollars, sol } from "@/lib/accounting";
import { Badge, Explorer, short } from "./ui";
import type { CreatorInvoice, CoinView } from "@/lib/platform/model";
type Prepared = {
  id: string;
  kind: "PAYMENT" | "CLAIM";
  transaction: string;
  description: string;
};
export default function CampaignPayment({
  campaignId,
  invoice: initial,
  coin,
  onUpdate,
}: {
  campaignId: string;
  invoice?: CreatorInvoice;
  coin?: CoinView;
  onUpdate: () => void;
}) {
  const wallet = useCreatorWallet(),
    [invoice, setInvoice] = useState(initial),
    [prepared, setPrepared] = useState<Prepared | null>(null),
    [pending, setPending] = useState<{
      id: string;
      kind: "PAYMENT" | "CLAIM";
      signature: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [manualSignature, setManualSignature] = useState("");
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
  async function quote() {
    await task(async () => {
      const data = await api("/api/creator/quote", { id: campaignId });
      setInvoice(data.invoice);
      onUpdate();
    });
  }
  async function prepare(kind: "PAYMENT" | "CLAIM", venue?: "CURVE" | "AMM") {
    await task(async () => {
      setPrepared(
        await api(
          "/api/creator/prepare",
          kind === "PAYMENT"
            ? { kind, id: invoice?.id }
            : { kind, mint: coin?.mint, venue },
        ),
      );
      setNotice(
        "Review every instruction below. This will require your explicit wallet signature.",
      );
    });
  }
  async function approve() {
    if (!prepared) return;
    await task(async () => {
      const reviewed = prepared;
      const signed = await wallet.sign(reviewed.transaction);
      const result = await api("/api/creator/broadcast", {
        id: reviewed.id,
        kind: reviewed.kind,
        transaction: signed,
      });
      setPending({
        id: reviewed.id,
        kind: reviewed.kind,
        signature: result.signature,
      });
      setPrepared(null);
      setNotice(
        result.notice ||
          "Signed transaction submitted. Payment is not complete until finalized verification.",
      );
      onUpdate();
    });
  }
  async function verify() {
    await task(async () => {
      const id = pending?.id || invoice?.id,
        kind = pending?.kind || "PAYMENT",
        signature = pending?.signature || manualSignature || invoice?.signature;
      const result = await api("/api/creator/verify", {
        id,
        kind,
        ...(kind === "PAYMENT" ? { signature } : {}),
      });
      setNotice(
        result.notice ||
          "Finalized campaign payment verified. Submit the campaign for human review next.",
      );
      setPending(null);
      onUpdate();
      if (kind === "PAYMENT")
        setInvoice((old) =>
          old ? { ...old, status: "PAID", signature: signature || null } : old,
        );
    });
  }
  return (
    <section className="panel checkout-panel">
      <div className="campaign-card-top">
        <h3>Review and fund</h3>
        {invoice && <Badge status={invoice.status} />}
      </div>
      <p>
        Pay $60 in SOL — $50 funds your television campaign and $10 is AIRTIME’s
        service fee.
      </p>
      {!invoice ? (
        <button className="button" disabled={busy} onClick={quote}>
          Get fixed SOL quote
        </button>
      ) : (
        <>
          <dl className="invoice-summary">
            <div>
              <dt>Media budget</dt>
              <dd>{dollars(invoice.media_budget_cents)}</dd>
            </div>
            <div>
              <dt>AIRTIME service fee ({invoice.platform_fee_bps / 100}%)</dt>
              <dd>{dollars(invoice.platform_fee_cents)}</dd>
            </div>
            <div className="invoice-total">
              <dt>Total campaign price</dt>
              <dd>{dollars(invoice.total_usd_cents)}</dd>
            </div>
            <div>
              <dt>Quoted SOL/USD</dt>
              <dd>
                {dollars(BigInt(invoice.price_usd_micros) / 10000n)} / SOL
              </dd>
            </div>
            <div>
              <dt>Exact campaign payment</dt>
              <dd>{sol(invoice.required_lamports)} SOL</dd>
            </div>
            <div>
              <dt>Quote expires (UTC)</dt>
              <dd>
                {new Date(invoice.expires_at)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19)}
              </dd>
            </div>
            <div>
              <dt>Payment recipient</dt>
              <dd>
                <span className="address-text">
                  {short(invoice.recipient_wallet)}
                </span>
                <Explorer address={invoice.recipient_wallet} />
              </dd>
            </div>
          </dl>
          <small>
            Invoice {invoice.id}
            <br />
            {invoice.price_source} quote. Solana network fees are separate from
            the exact campaign payment.
          </small>
          {["OPEN", "VERIFYING"].includes(invoice.status) && (
            <div className="funding-options">
              <div>
                <Wallet size={20} />
                <h4>Available wallet SOL</h4>
                <p>A separate, exact transfer. Your wallet approves it.</p>
                <button
                  className="button"
                  onClick={() => prepare("PAYMENT")}
                  disabled={
                    busy || invoice.status !== "OPEN" || !!pending || !!prepared
                  }
                >
                  Review campaign payment
                </button>
              </div>
              <div>
                <ShieldCheck size={20} />
                <h4>Claim creator fees first</h4>
                <p>
                  Claim into your wallet, wait for finality, then separately
                  approve the invoice payment.
                </p>
                <div className="button-row">
                  <button
                    className="button outline"
                    onClick={() => prepare("CLAIM", "CURVE")}
                    disabled={
                      busy || !coin?.claimable || !!pending || !!prepared
                    }
                  >
                    Review Pump claim
                  </button>
                  <button
                    className="button outline"
                    onClick={() => prepare("CLAIM", "AMM")}
                    disabled={
                      busy || !coin?.claimable || !!pending || !!prepared
                    }
                  >
                    Review PumpSwap claim
                  </button>
                </div>
                <small>
                  {coin?.feeNotice ||
                    "Refresh fee balances in My Coins to check claim eligibility."}
                </small>
              </div>
            </div>
          )}
          {invoice.signature && (
            <Explorer
              signature={invoice.signature}
              label="Finalized payment proof"
            />
          )}
        </>
      )}
      {prepared && (
        <div className="signed-review">
          <span className="eyebrow">EXPLICIT WALLET APPROVAL REQUIRED</span>
          <p>{prepared.description}</p>
          <div className="button-row">
            <button className="button" disabled={busy} onClick={approve}>
              {busy
                ? "Waiting for wallet…"
                : prepared.kind === "PAYMENT"
                  ? "Approve exact payment in wallet"
                  : "Approve claim in wallet"}
            </button>
            <button
              className="button outline"
              disabled={busy}
              onClick={() => setPrepared(null)}
            >
              Cancel signature request
            </button>
          </div>
          <button className="text-link" onClick={wallet.open}>
            Reconnect signing wallet
          </button>
        </div>
      )}
      {pending && (
        <div className="notice">
          <p>
            Awaiting finalized confirmation. AIRTIME never automatically resends
            payments.
          </p>
          <Explorer
            signature={pending.signature}
            label="Check submitted transaction"
          />
          <button className="button" disabled={busy} onClick={verify}>
            Check finalized confirmation
          </button>
        </div>
      )}
      {invoice &&
        ["OPEN", "VERIFYING"].includes(invoice.status) &&
        !pending && (
          <details className="payment-recovery">
            <summary>Already paid or interrupted?</summary>
            <p>
              Paste the original signature to verify it. Do not send another
              payment.
            </p>
            <input
              aria-label="Original payment signature"
              placeholder="Transaction signature"
              value={manualSignature}
              onChange={(e) => setManualSignature(e.target.value)}
            />
            <button
              className="button outline"
              disabled={busy || !manualSignature}
              onClick={verify}
            >
              Verify original payment
            </button>
            <button
              className="button outline"
              disabled={busy}
              onClick={() =>
                task(async () => {
                  const result = await api("/api/creator/quote", {
                    id: campaignId,
                    action: "release-expired",
                  });
                  setNotice(result.notice || "Payment was already finalized.");
                  if (result.status === "CANCELLED") {
                    setInvoice(undefined);
                    setPrepared(null);
                    setPending(null);
                  }
                  onUpdate();
                })
              }
            >
              Check expired unpaid quote recovery
            </button>
          </details>
        )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
