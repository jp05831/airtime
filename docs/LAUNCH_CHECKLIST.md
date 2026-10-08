# Controlled $50 campaign pilot

Creative approval first → customer payment second → campaign activation third. No real publication, SOL transfer or advertising spend was performed during implementation.

- [ ] Revoke the historical exposed credential; create a replacement OAuth client through the official Vibe developer dashboard. Never reuse or paste the old credential.
- [ ] Create Supabase/Postgres and run migrations 001 → 002 → 003 → 004 → 005. Preserve existing data and keep RLS enabled.
- [ ] Configure `DATABASE_URL` with the Supabase session pooler hostname on port 5432 and `sslmode=verify-full`; download the project CA certificate, base64-encode the PEM, and set it as `DATABASE_CA_CERT_BASE64` in Vercel. Production refuses direct/transaction-pooler URLs and verifies the TLS CA and hostname.
- [ ] Configure private storage and hosting able to process the configured video size; the Vercel upload function includes the bundled static FFprobe binary. Set `FFPROBE_PATH` only if intentionally overriding it.
- [ ] Configure APP_ORIGIN, server-only database/auth/storage secrets and allowlisted administrator with TOTP AAL2.
- [ ] Configure mainnet RPC, authenticated Helius webhook, public campaign-payment wallet and a unique server-side `WORKER_SECRET` (at least 32 characters).
- [ ] On Vercel Hobby, configure cron-job.org to send `POST https://FINAL_DOMAIN/api/worker` every five minutes with `Authorization: Bearer <WORKER_SECRET>`. Store the secret in Vercel environment settings and cron-job.org protected request headers. Vercel Cron is not configured.
- [ ] Configure fixed 5000 media / 1000 fee / 6000 total cents and 300-second quote TTL.
- [ ] Store replacement OAuth client ID/secret in local/hosting secret storage; leave VIBE_ACCESS_TOKEN, VIBE_ACCESS_TOKEN_EXPIRES_AT and optional VIBE_ACCOUNT_ID blank; pin revision 2026-06-01.
- [ ] Keep VIBE_LIVE_MODE=false during configuration, mocked testing and free creative review. There are no embedded/crypto/operator approval flags.
- [ ] Run `npm run vibe:advertisers` to verify exactly one authorized advertiser; output contains only name and ID. The check reads `/advertisers` and does not publish, upload or spend.
- [ ] Configure AIRTIME’s billing card directly in Vibe and ensure payment capacity for accumulated delivered spend. Confirm account thresholds, which may aggregate several $50 orders.
- [ ] Verify the selected US/adult targeting and $50 GLOBAL lifetime budget on the account.
- [ ] Verify creator wallet and coin authority; privately upload a compliant commercial. Confirm actual review polling, pending/rejection behavior, replacement and AUTHORIZED approval without payment/campaign creation.
- [ ] Obtain actual scoped JSON report/export fixtures and validate aggregate/channel/geography parsing; unsupported exports must fail closed.
- [ ] Complete professional review of advertising compliance, terms, privacy, disclosures and revision/refund policy. No specific network placement is promised.
- [ ] Run tests, lint, typecheck, production build, migration validation and repository/client secret scans; verify desktop/mobile and creator-data isolation. Confirm demo mode is off in production.
- [ ] Obtain explicit authorization for the controlled paid pilot, then set VIBE_LIVE_MODE=true. This authorizes publishing only after approved creative and finalized payment.
- [ ] Generate one five-minute $60 SOL quote only after approval; have the creator explicitly sign the exact payment. Verify mainnet finality, sender, recipient, amount and unique reference.
- [ ] Observe one durable provisioning job, one inactive Vibe campaign and one $50 GLOBAL strategy, followed by worker publication/activation. No individual campaigns are manually created by the operator.
- [ ] Confirm $50 reserved media / $10 service revenue separately from actual spend; verify real reporting, remaining media budget and stop/completion at $50.
- [ ] Monitor review failures, unpaid/expired quotes, failed provisioning, UNKNOWN operations, account billing balance, worker freshness and settlement discrepancies.
- [ ] Reconcile customer SOL receipts and Vibe delivered-spend billing separately; record operator-side conversion/funding evidence.
- [ ] Rehearse recovery/refund review and emergency rollback: set VIBE_LIVE_MODE=false, separately PAUSE active strategies, preserve all receipts/audit history.
