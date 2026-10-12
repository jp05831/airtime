"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./creator-wallet";
import { Explorer } from "./ui";
import { sol } from "@/lib/accounting";
import {
  signReviewedTransaction,
  type TransactionWallet,
} from "@/lib/browser-wallet";
export function SmokeExplorer({ signature }: { signature: string }) {
  return (
    <a
      className="text-link"
      href={"https://explorer.solana.com/tx/" + encodeURIComponent(signature)}
      target="_blank"
      rel="noopener noreferrer"
    >
      Mainnet Solana Explorer ↗
    </a>
  );
}
type Provider = TransactionWallet & { connect(): Promise<unknown> };
type Invoice = {
  id: string;
  phase: string;
  status: string;
  payer: string;
  recipient: string;
  lamports: string;
  expiresAt: string;
  reference: string;
  signature: string | null;
  transaction: string | null;
  record_kind: "TEST";
};
type State = { enabled: boolean; warning: string; invoices: Invoice[] };
export default function PaymentSmokeTest() {
  const [state, setState] = useState<State | null>(null),
    [payer, setPayer] = useState(""),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const provider = useRef<Provider | null>(null);
  const current =
    state?.invoices.find((i) => ["OPEN", "VERIFYING"].includes(i.status)) ||
    state?.invoices[0];
  const load = useCallback(async () => {
    setState(await api("/api/admin/payment-smoke"));
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      load().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function connect(kind: "Phantom" | "Solflare") {
    await task(async () => {
      const win = window as Window & {
        phantom?: { solana?: Provider };
        solana?: Provider & { isPhantom?: boolean };
        solflare?: Provider;
      };
      const wallet =
        kind === "Phantom"
          ? win.phantom?.solana ||
            (win.solana?.isPhantom ? win.solana : undefined)
          : win.solflare;
      if (!wallet)
        throw Error(`Install ${kind} or open AIRTIME in its wallet browser.`);
      await wallet.connect();
      const address = wallet.publicKey?.toString();
      if (!address) throw Error("Wallet did not connect");
      provider.current = wallet;
      setPayer(address);
    });
  }
  async function action(action: string, extra: Record<string, unknown> = {}) {
    await task(async () => {
      const result = await api("/api/admin/payment-smoke", {
        action,
        ...(action === "quote" ? { wallet: payer } : { id: current?.id }),
        ...extra,
      });

      setNotice(result.notice || "");
      if (action === "quote") setAck(false);
    });
  }
  async function sign() {
    if (!current?.transaction || !provider.current || !ack) return;
    await task(async () => {
      const encoded = await signReviewedTransaction(
        provider.current!,
        current.transaction!,
        current.payer,
      );
      const result = await api("/api/admin/payment-smoke", {
        action: "broadcast",
        id: current.id,
        transaction: encoded,
      });

      setNotice(
        result.notice ||
          "Broadcast. Check finality; never send a second transfer.",
      );
    });
  }
  if (!state)
    return (
      <section className="panel">
        <h3>TEST — mainnet payment smoke test</h3>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  const open = current && ["OPEN", "VERIFYING"].includes(current.status);
  const expired = current ? Date.parse(current.expiresAt) <= Date.now() : false;
  return (
    <section className="panel">
      <span className="eyebrow">
        ADMIN + TWO-FACTOR AUTHENTICATION / TEST ONLY
      </span>
      <h3>$1 mainnet payment smoke test</h3>
      <p className="notice">{state.warning}</p>
      <p>
        Commercial upload is not required. Media budget and platform revenue:
        $0. TEST payments cannot create or activate campaigns.
      </p>
      {!state.enabled && (
        <p>
          New TEST payments are disabled. Existing transfers remain available
          for finalized verification and audit.
        </p>
      )}
      <div className="button-row">
        <button
          className="button outline"
          disabled={busy || !state.enabled}
          onClick={() => connect("Phantom")}
        >
          Connect Phantom payer
        </button>
        <button
          className="button outline"
          disabled={busy || !state.enabled}
          onClick={() => connect("Solflare")}
        >
          Connect Solflare payer
        </button>
        <button
          className="button"
          disabled={busy || !state.enabled || !payer || !!open}
          onClick={() => action("quote")}
        >
          Create $1 TEST quote
        </button>
      </div>
      {payer && (
        <p>
          Payer: <code className="address-text">{payer}</code>
        </p>
      )}
      {current && (
        <>
          <h4>TEST — {current.phase}</h4>
          <dl className="invoice-summary">
            <div>
              <dt>Exact payment</dt>
              <dd>
                {sol(current.lamports)} SOL ({current.lamports} lamports), plus
                network fees
              </dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>
                <code className="address-text">{current.recipient}</code>
                <Explorer address={current.recipient} />
              </dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>
                <code>{current.reference}</code>
              </dd>
            </div>
            <div>
              <dt>Quote expires</dt>
              <dd>{new Date(current.expiresAt).toISOString()}</dd>
            </div>
          </dl>
          {open && current.status === "OPEN" && !expired && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              I understand this is real mainnet SOL and is not automatically
              refunded.
            </label>
          )}
          <div className="button-row">
            {current.status === "OPEN" && !current.transaction && (
              <button
                className="button"
                disabled={
                  busy ||
                  !state.enabled ||
                  expired ||
                  !ack ||
                  payer !== current.payer
                }
                onClick={() => action("prepare")}
              >
                Prepare TEST payment
              </button>
            )}
            {current.status === "OPEN" && current.transaction && (
              <button
                className="button"
                disabled={
                  busy ||
                  !state.enabled ||
                  expired ||
                  !ack ||
                  payer !== current.payer
                }
                onClick={sign}
              >
                Review and sign exact TEST transfer in wallet
              </button>
            )}
            {current.signature && current.status !== "PAID" && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  action("verify", { signature: current.signature })
                }
              >
                Check finalized confirmation
              </button>
            )}
            {open && expired && (
              <button
                className="button outline"
                disabled={busy}
                onClick={() => action("release-expired")}
              >
                Safely check expired quote
              </button>
            )}
          </div>
          {current.signature && <SmokeExplorer signature={current.signature} />}
        </>
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
      {!!state.invoices.length && (
        <details>
          <summary>Preserved TEST audit records</summary>
          {state.invoices.map((i) => (
            <p key={i.id}>
              TEST {i.id} — {i.phase} — {sol(i.lamports)} SOL{" "}
              {i.signature && <SmokeExplorer signature={i.signature} />}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
