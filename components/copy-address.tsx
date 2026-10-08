"use client";
import { useState } from "react";
export default function CopyAddress({ address }: { address: string }) {
  const [state, setState] = useState("Copy address");
  return (
    <button
      className="button outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setState("Copied ✓");
          setTimeout(() => setState("Copy address"), 2000);
        } catch {
          setState("Select address to copy");
        }
      }}
    >
      {state}
    </button>
  );
}
