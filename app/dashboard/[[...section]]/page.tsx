import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCreator } from "@/lib/platform/auth";
import { creatorState } from "@/lib/platform/campaigns";
import CreatorApp from "@/components/creator-app";
import { ConnectWallet } from "@/components/creator-wallet";
import { Heading } from "@/components/ui";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Creator dashboard",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ mint?: string }>;
}) {
  const segments = (await params).section || [],
    section = segments[0] || "",
    detail = segments[1];
  if (
    !["", "coins", "campaigns", "create", "billing", "account"].includes(
      section,
    ) ||
    segments.length > 2 ||
    (detail && !/^[0-9a-f-]{36}$/.test(detail))
  )
    notFound();
  let identity;
  try {
    identity = await requireCreator();
  } catch {
    return (
      <main className="page-content">
        <Heading
          label="AIRTIME / CREATOR ACCESS"
          title="Your coin. Your campaign."
          description="Connect the wallet controlling your Pump.fun coin to enter your private campaign workspace."
        />
        <section className="panel access-panel">
          <ConnectWallet />
          <p>
            No seed phrases. No private keys. Every payment requires your wallet
            approval.
          </p>
        </section>
      </main>
    );
  }
  try {
    return (
      <CreatorApp
        key={identity.wallet}
        initial={await creatorState(
          identity,
          ["coins", "create", "campaigns"].includes(section),
        )}
        section={section}
        detail={detail}
        selectedMint={(await searchParams).mint}
      />
    );
  } catch {
    return (
      <main className="page-content">
        <Heading
          label="CREATOR WORKSPACE"
          title="We’re reconnecting."
          description="Campaign records are temporarily unavailable. No payment has been requested or sent."
        />
        <Link className="button" href="/dashboard">
          Try again
        </Link>
      </main>
    );
  }
}
