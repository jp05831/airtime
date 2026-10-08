# AIRTIME — creator fees to streaming TV

The existing platform now supports verified coin → private commercial → adult US targeting → Vibe creative review → fixed $60 SOL checkout → $50 lifetime campaign activation → private reporting.

**Creative approval first → customer payment second → campaign activation third.** All ads run under AIRTIME’s own Vibe account; creators never connect a Vibe account or install a marketplace application. `VIBE_LIVE_MODE=false` prevents real publishing/activation, while allowing free creative upload/review and status synchronization. Replacement credentials and real account/report validation remain owner-controlled setup items. No real SOL or advertising spend was used in verification.

## Exact setup order

1. Run `npm install`, copy `.env.example` to `.env.local`, and keep `VIBE_LIVE_MODE=false`.
2. Configure Supabase/Postgres and private storage using [docs/SUPABASE.md](docs/SUPABASE.md); run `npm run db:migrate` (001 → 002 → 003 → 004 → 005, forward-only).
3. Configure final domain, server secrets, mainnet RPC and campaign payment wallet. Never store wallet private keys in AIRTIME.
4. Install maintained ffprobe and set `FFPROBE_PATH`; select hosting that supports binary execution and configured video uploads (default 25 MB). Small serverless payload limits require different hosting or an additional signed-upload transport.
5. Follow [docs/HELIUS.md](docs/HELIUS.md) and schedule authenticated POST `/api/worker` through cron-job.org every five minutes on Vercel Hobby. Set a private `WORKER_SECRET`; no Vercel Cron job is configured.
6. Create the allowlisted Supabase administrator and require TOTP AAL2.
7. Revoke the exposed Vibe credential and follow [docs/VIBE.md](docs/VIBE.md) to create/store a replacement OAuth client. Leave optional `VIBE_ACCOUNT_ID` blank for AIRTIME’s private account-bound app; pin the revision.
8. Run `npm run dev` at http://localhost:3200. Missing configuration shows honest empty states; no fake production records are substituted.
9. Run `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run check:client`, and `node scripts/secret-check.mjs`.
10. Complete [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md), including creative approval and read-only connectivity, before explicitly enabling a controlled pilot.

## Fixed product

5000 cents media + 1000 cents service = 6000 cents paid in integer lamports. Quotes last 300 seconds. No editable budget, DAILY strategy or open-ended placement. Exactly one GLOBAL $50 strategy with a finite seven-day window is used. Creator-fee claiming and campaign payment require separate wallet approvals.

Read [payments](docs/PAYMENTS.md) for finality, quote recovery, allocation and refunds; [operations](docs/OPERATIONS.md) for settlement, pause and failed-activation recovery.

Run the safe advertiser lookup with `npm run vibe:advertisers`. It uses the private client-credentials flow and prints only the single authorized advertiser name and ID. It does not call `/accounts` or mutate Vibe.

## Honest integration limits

The pinned public API exposes creative registration and status polling, not a dedicated submit-review endpoint or advertiser approval status. Creative registration initiates Vibe review without creating a campaign or strategy. Validate a real creative’s returned review status on the owner account before the pilot. No specific streaming app, channel, impression count or financial result is guaranteed. Report exports must contain the requested owned campaign/advertiser identifiers; unsupported formats fail closed. Channel/geography breakdown ingestion is implemented with strict owned-row validation; real export-fixture validation remains required. Account balance is aggregated outstanding billing, not one $50 card charge per order.

Local tests use isolated PostgreSQL/PGlite, synthetic keys and injected provider/RPC/storage responses. `scripts/layout-db.mjs` creates only a clearly labeled local demo fixture. Historical treasury/manual-campaign data is preserved in earlier tables and excluded from automated activation.
