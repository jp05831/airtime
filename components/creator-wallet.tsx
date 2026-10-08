"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import bs58 from "bs58";
import Link from "next/link";
import { X, Wallet, ShieldCheck } from "lucide-react";
import type { CreatorIdentity } from "@/lib/platform/model";
import { short } from "./ui";
export async function api(path: string, payload?: unknown) {
  const r = await fetch(path, {
    method: payload === undefined ? "GET" : "POST",
    headers:
      payload === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Request failed");
  return data;
}
type Provider = {
  publicKey?: { toString(): string };
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
  signMessage(
    bytes: Uint8Array,
    display?: string,
  ): Promise<Uint8Array | { signature: Uint8Array }>;
  signTransaction(t: Transaction): Promise<Transaction>;
  on?: (name: string, fn: () => void) => void;
  removeListener?: (name: string, fn: () => void) => void;
  isPhantom?: boolean;
};
type WalletWindow = Window & {
  phantom?: { solana?: Provider };
  solana?: Provider;
  solflare?: Provider;
};
const Context = createContext<{
  identity: CreatorIdentity | null;
  open: () => void;
  disconnect: () => Promise<void>;
  sign: (encoded: string) => Promise<string>;
}>({
  identity: null,
  open: () => {},
  disconnect: async () => {},
  sign: async () => {
    throw Error("Connect wallet");
  },
});
export function WalletProvider({
  children,
  initial,
  configured,
}: {
  children: React.ReactNode;
  initial: CreatorIdentity | null;
  configured: boolean;
}) {
  const [identity, setIdentity] = useState(initial),
    [modal, setModal] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const provider = useRef<Provider | null>(null),
    modalRef = useRef<HTMLDivElement>(null),
    router = useRouter(),
    pathname = usePathname();
  useEffect(() => {
    if (!modal) return;
    const focus = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(false);
      if (e.key === "Tab") {
        const items = modalRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href]",
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      focus?.focus();
    };
  }, [modal]);
  async function disconnect() {
    try {
      await api("/api/creator/logout", {});
      await provider.current?.disconnect();
    } finally {
      provider.current = null;
      setIdentity(null);
      router.push("/");
      router.refresh();
    }
  }
  async function connect(kind: "Phantom" | "Solflare") {
    setBusy(true);
    setError("");
    try {
      const win = window as WalletWindow;
      const p =
        kind === "Phantom"
          ? win.phantom?.solana ||
            (win.solana?.isPhantom ? win.solana : undefined)
          : win.solflare;
      if (!p)
        throw Error(
          `${kind} is not available. Install its extension or open AIRTIME in the wallet’s mobile browser.`,
        );
      await p.connect();
      const wallet = p.publicKey?.toString();
      if (!wallet) throw Error("Wallet did not connect");
      const challenge = await api("/api/creator/challenge", { wallet });
      const result = await p.signMessage(
        new TextEncoder().encode(challenge.message),
        "utf8",
      );
      const signature =
        result instanceof Uint8Array ? result : result.signature;
      const session = await api("/api/creator/authenticate", {
        id: challenge.id,
        wallet,
        signature: bs58.encode(signature),
      });
      provider.current = p;
      setIdentity({ userId: session.userId || "", wallet: session.wallet });
      setModal(false);
      if (!pathname.startsWith("/dashboard")) router.push("/dashboard/coins");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const p = provider.current;
    if (!p || !identity) return;
    const changed = () => {
      if (p.publicKey?.toString() !== identity.wallet) {
        api("/api/creator/logout", {})
          .catch(() => {})
          .finally(() => {
            provider.current = null;
            setIdentity(null);
            router.push("/");
            router.refresh();
          });
      }
    };
    p.on?.("accountChanged", changed);
    p.on?.("disconnect", changed);
    return () => {
      p.removeListener?.("accountChanged", changed);
      p.removeListener?.("disconnect", changed);
    };
  }, [identity, router]);
  async function sign(encoded: string) {
    if (
      !identity ||
      !provider.current ||
      provider.current.publicKey?.toString() !== identity.wallet
    )
      throw Error(
        "Reconnect the authenticated wallet before approving a transaction.",
      );
    const signed = await provider.current.signTransaction(
      Transaction.from(Buffer.from(encoded, "base64")),
    );
    return signed.serialize().toString("base64");
  }
  return (
    <Context.Provider
      value={{
        identity,
        open: () => {
          setError("");
          setModal(true);
        },
        disconnect,
        sign,
      }}
    >
      {children}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <div
            className="panel wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-title"
            tabIndex={-1}
            ref={modalRef}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close wallet selection"
              onClick={() => setModal(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">AIRTIME / CREATOR ACCESS</span>
            <h2 id="wallet-title">
              Your wallet. <em>Your coin.</em>
            </h2>
            <p>
              Sign a gasless authentication message to manage your campaigns. No
              funds move when you connect.
            </p>
            {!configured ? (
              <div className="notice">
                Creator access is being configured.
                <br />
                Wallet sign-in will open when the platform is connected.
              </div>
            ) : (
              <div className="wallet-options">
                {(["Phantom", "Solflare"] as const).map((name) => (
                  <button
                    key={name}
                    className="button"
                    disabled={busy}
                    onClick={() => connect(name)}
                  >
                    <Wallet size={18} />
                    {busy ? "Waiting for wallet…" : name}
                  </button>
                ))}
              </div>
            )}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <small>
              <ShieldCheck size={14} /> Never share a seed phrase or private
              key.
            </small>
            <div className="wallet-install">
              <a
                href="https://phantom.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get Phantom ↗
              </a>
              <a
                href="https://solflare.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get Solflare ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </Context.Provider>
  );
}
export const useCreatorWallet = () => useContext(Context);
export function ConnectWallet({
  className = "button",
  label = "Connect Creator Wallet",
}: {
  className?: string;
  label?: string;
}) {
  const wallet = useCreatorWallet();
  return wallet.identity ? (
    <Link className={className} href="/dashboard">
      {label === "Connect Wallet"
        ? short(wallet.identity.wallet)
        : "Open Creator Dashboard"}{" "}
      ↗
    </Link>
  ) : (
    <button className={className} onClick={wallet.open}>
      <Wallet size={16} />
      {label}
    </button>
  );
}
