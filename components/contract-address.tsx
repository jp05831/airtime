"use client";

import { useEffect, useRef, useState } from "react";

export function ContractAddress({ address }: { address: string | null }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setError("");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Unable to copy. Select the address to copy it.");
    }
  }

  return (
    <section
      className="contract-address"
      aria-labelledby="contract-address-heading"
    >
      <div className="contract-address-details">
        <h2 id="contract-address-heading">Contract Address</h2>
        {address ? (
          <p
            className="contract-address-value"
            aria-label={address}
            title={address}
          >
            <span className="contract-address-full" aria-hidden="true">
              {address}
            </span>
            <span className="contract-address-mobile" aria-hidden="true">
              {address.slice(0, 8)}…{address.slice(-8)}
            </span>
          </p>
        ) : (
          <p className="contract-address-pending">Coming at launch</p>
        )}
      </div>
      <div className="contract-address-actions">
        <button className="button outline" disabled={!address} onClick={copy}>
          {copied ? "Copied" : "Copy CA"}
        </button>
        {address && (
          <>
            <a
              className="text-link"
              href={`https://pump.fun/coin/${address}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Pump.fun ↗
            </a>
            <a
              className="text-link"
              href={`https://axiom.trade/t/${address}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Trade on Axiom ↗
            </a>
          </>
        )}
      </div>
      <span className="contract-address-status" role="status">
        {error || (copied ? "Address copied" : "")}
      </span>
    </section>
  );
}
