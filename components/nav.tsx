"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import Logo from "./logo";
import { ConnectWallet } from "./creator-wallet";
export default function Nav() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  return (
    <>
      <nav className="nav">
        <Link href="/" className="logo" aria-label="AIRTIME home">
          <Logo />
        </Link>
        <div
          id="primary-navigation"
          className={"nav-links " + (open ? "open" : "")}
        >
          {[
            ["/#how-it-works", "How It Works"],
            ["/#for-creators", "For Creators"],
            ["/campaigns", "Campaigns"],
            ["/#pricing", "Pricing"],
          ].map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </Link>
          ))}
        </div>
        <div className="nav-end">
          <ConnectWallet className="nav-trade" label="Connect Wallet" />
          <button
            className="menu"
            aria-label="Toggle navigation"
            aria-controls="primary-navigation"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>
      <div className="subnav">
        <Link href="/disclosures">
          Independent platform. Human-reviewed campaigns. ↗
        </Link>
      </div>
    </>
  );
}
