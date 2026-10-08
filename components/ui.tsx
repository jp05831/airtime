import Link from "next/link";
import { Radio, ArrowUpRight } from "lucide-react";
import { sol, dollars } from "@/lib/accounting";
import type { Campaign, LedgerRow } from "@/lib/types";
export function short(value: string) {
  return value.length > 12 ? value.slice(0, 6) + "…" + value.slice(-5) : value;
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <Radio size={24} />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
export function Heading({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description: string;
}) {
  return (
    <header className="page-heading">
      <span className="eyebrow">{label}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}
export function Section({ label, title }: { label: string; title: string }) {
  return (
    <div className="section-title">
      <span className="eyebrow">{label}</span>
      <h2>{title}</h2>
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  const tone = [
    "VERIFIED",
    "CONFIRMED",
    "APPROVED",
    "COMPLETED",
    "APPROVED_AWAITING_PAYMENT",
    "DELIVERING",
    "PAID",
  ].includes(status)
    ? "success"
    : [
          "REJECTED",
          "FAILED",
          "CREATIVE_REJECTED",
          "ACTIVATION_FAILED",
          "PROVISIONING_FAILED",
        ].includes(status)
      ? "failure"
      : "pending";
  return (
    <span className={"badge " + tone}>
      {(
        {
          CREATIVE_PENDING: "Under review",
          CREATIVE_UPLOADING: "Uploading commercial",
          APPROVED_AWAITING_PAYMENT: "Approved — ready to launch",
          READY_TO_ACTIVATE: "Payment confirmed",
          PROVISIONING_FAILED: "Preparation needs attention",
        } as Record<string, string>
      )[status] || status.replaceAll("_", " ")}
    </span>
  );
}
export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="stat-card">
      <div>
        {label}
        <ArrowUpRight size={14} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
export function Explorer({
  signature,
  address,
  label = "Solscan proof",
}: {
  signature?: string;
  address?: string;
  label?: string;
}) {
  return signature || address ? (
    <a
      className="text-link"
      href={
        "https://solscan.io/" +
        (signature ? "tx/" + signature : "account/" + address)
      }
      target="_blank"
      rel="noopener noreferrer"
    >
      {label} ↗
    </a>
  ) : null;
}
export function Activity({ rows }: { rows: LedgerRow[] }) {
  if (!rows.length)
    return (
      <Empty
        title="No verified treasury activity yet"
        detail="Finalized transfers will appear here with public transaction proof."
      />
    );
  return (
    <div
      className="table-wrap"
      role="region"
      aria-label="Treasury ledger"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th>Activity</th>
            <th>SOL amount</th>
            <th>Recorded USD</th>
            <th>Status</th>
            <th>Proof</th>
            <th>Time (UTC)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{row.kind.replaceAll("_", " ")}</strong>
                <small>
                  {row.classification_source === "ADMIN_REVIEW"
                    ? "Blockchain transfer · admin classification"
                    : "Finalized RPC evidence · classification pending"}
                </small>
              </td>
              <td>
                {row.direction === "OUT" ? "−" : "+"}
                {sol(row.amount_lamports)}
              </td>
              <td>{dollars(row.usd_cents)}</td>
              <td>
                <Badge status={row.status} />
              </td>
              <td>
                <Explorer signature={row.signature} />
                <small>{short(row.signature)}</small>
              </td>
              <td>
                <time dateTime={new Date(row.block_time).toISOString()}>
                  {new Date(row.block_time).toLocaleString("en-US", {
                    timeZone: "UTC",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function CampaignCard({
  campaign: c,
  funding,
}: {
  campaign: Campaign;
  funding?: { bps: number; cents: bigint | null };
}) {
  return (
    <article className="panel campaign-card">
      <div className="campaign-card-top">
        <span className="eyebrow">{c.format || "Media placement pending"}</span>
        <Badge status={c.status} />
      </div>
      <h3>{c.title}</h3>
      <p>{c.description}</p>
      <dl>
        <div>
          <dt>Proposed budget</dt>
          <dd>{dollars(c.target_usd_cents)}</dd>
        </div>
        <div>
          <dt>Spend recorded</dt>
          <dd>{sol(c.spent_lamports)} SOL</dd>
        </div>
        <div>
          <dt>Placement</dt>
          <dd>{c.platform || "Not selected"}</dd>
        </div>
        <div>
          <dt>Platform review</dt>
          <dd>{c.approval_status}</dd>
        </div>
      </dl>
      <Link className="button outline" href={"/campaigns/" + c.slug}>
        {c.status === "COMPLETED"
          ? "View campaign proof"
          : "View campaign plan"}{" "}
        <ArrowUpRight size={16} />
      </Link>
    </article>
  );
}
