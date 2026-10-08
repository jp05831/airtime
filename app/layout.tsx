import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import Nav from "@/components/nav";
import Logo from "@/components/logo";
import { WalletProvider } from "@/components/creator-wallet";
import { requireCreator } from "@/lib/platform/auth";
import { demoEnabled } from "@/lib/server/config";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN || "http://localhost:3200"),
  title: { default: "AIRTIME — Put Your Coin on TV", template: "%s | AIRTIME" },
  description:
    "Turn Pump.fun creator fees into reviewed streaming-TV advertising campaigns.",
  openGraph: {
    title: "AIRTIME — Put Your Coin on TV",
    description:
      "Turn Pump.fun creator fees into reviewed streaming-TV advertising campaigns.",
  },
  twitter: {
    card: "summary_large_image",
    title: "AIRTIME — Put Your Coin on TV",
    description:
      "Turn Pump.fun creator fees into reviewed streaming-TV advertising campaigns.",
  },
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  let identity = null;
  try {
    identity = await requireCreator();
  } catch {}
  return (
    <html lang="en">
      <body>
        <WalletProvider
          initial={identity}
          configured={!!process.env.DATABASE_URL}
        >
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <div className="site-shell">
            <Nav />
            {demoEnabled() && (
              <div className="demo-banner" role="status">
                DEMO DATA — NOT LIVE
              </div>
            )}
            <div id="main-content">{children}</div>
            <footer>
              <div className="footer-top">
                <Link className="logo" href="/" aria-label="AIRTIME home">
                  <Logo />
                </Link>
                <span>Put your coin on TV.</span>
                <div>
                  <Link href="/dashboard">Creator dashboard ↗</Link>
                  <Link href="/#pricing">Transparent pricing ↗</Link>
                </div>
              </div>
              <div className="footer-bottom">
                <p>
                  AIRTIME is an independent advertising service. Placement
                  requires review and platform approval. No guaranteed
                  impressions, reach, token performance or financial returns.
                </p>
                <div className="footer-legal">
                  <Link href="/terms">Terms</Link>
                  <Link href="/privacy">Privacy</Link>
                  <Link href="/disclosures">Disclosures</Link>
                </div>
              </div>
            </footer>
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
