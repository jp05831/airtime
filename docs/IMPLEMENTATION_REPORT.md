# Finalized review → payment → activation implementation

Project: `/home/jp05831/airtime`. The existing homepage, AIRTIME logo/TV artwork, blue/cyan identity, typography, layout and responsive styling are preserved. Wallet authentication, Pump coin/fee-authority verification, private commercial validation, audience selection, creator isolation and administrator TOTP remain in use.

## Final customer and worker behavior

1. Authenticate a creator wallet and verify coin authority server-side.
2. Upload a private technically validated commercial and choose supported adult US targeting.
3. Resolve AIRTIME’s single authorized account advertiser and store its ID against each project/coin before registering the commercial using Vibe’s documented upload operations. No campaign/strategy is created and no payment is requested at this point.
4. Poll official creative statuses through the durable worker. PROCESSING/PENDING_REVIEW keep checkout locked. BLOCKED records a safe rejection explanation and permits replacement; AUTHORIZED unlocks checkout automatically. No manual AIRTIME approval or embedded/crypto/operator flag is required.
5. Generate a unique five-minute $60 SOL quote: $50 media plus $10 service fee. Verify exact native SOL, authenticated sender, configured recipient, reference, successful mainnet finality, signature and quote timestamp independently. A browser closing does not cancel reconciliation.
6. In the finalized receipt transaction, mark the invoice paid, record separate $50/$10 settlement allocations and enqueue one durable provisioning job.
7. When VIBE_LIVE_MODE=false, hold the paid order at READY_TO_ACTIVATE without provider provisioning/publication. Free review polling and read-only connectivity are still available.
8. When explicitly enabled, recheck approval and receipt, create/recover one draft provider campaign and one inactive $50 GLOBAL lifetime strategy, attach the approved creative/audience, then publish/activate.
9. Reuse resource IDs and frozen requests on retries. An ambiguous create is never blindly repeated; list-based identity recovery is required. Bounded paid failures become PROVISIONING_FAILED with the receipt preserved and refund/manual-resolution review available.
10. Import owned reporting, reserve remaining media against actual spend and pause/complete the campaign when recorded lifetime spend reaches $50. Completed orders cannot automatically reactivate. The provider’s GLOBAL budget is the primary spend control; polling is not a promise of zero reporting delay or zero provider overshoot.

## State machine

Existing equivalent names are retained:

`DRAFT → SUBMITTED_FOR_REVIEW → CREATIVE_UPLOADING → CREATIVE_PENDING → APPROVED_AWAITING_PAYMENT → QUOTE_ACTIVE → PAYMENT_VERIFYING → PAID → ACTIVATING → UPCOMING/DELIVERING → COMPLETED`

Rejection: `CREATIVE_REJECTED → DRAFT` for replacement. Paid prelaunch hold: `READY_TO_ACTIVATE`. Recovery: `PROVISIONING_FAILED → ACTIVATING` using original identities, or `REFUND_REVIEW → REFUNDED` after independently verifying an operator-signed refund to the original payer. Invalid transitions, unpaid activation and concurrent stale transitions are rejected server-side.

## Files changed in this revision

- `.env.example`, `README.md`
- `supabase/migrations/005_private_vibe_advertiser.sql` — new forward-only migration; applied migrations 001–004 are unchanged
- `lib/vibe/config.ts`, `client.ts`, `workflow.ts`, `review.ts`, `reporting.ts`, `auth.ts`, new `advertisers.ts`
- `lib/platform/campaigns.ts`, `payments.ts`, `model.ts`, `worker.ts`, `operations.ts`
- `lib/server/http.ts`
- `app/api/admin/vibe/route.ts`
- `components/vibe-operations.tsx`, `campaign-builder.tsx`, `campaign-payment.tsx`, `creator-app.tsx`, `ui.tsx`
- `tests/platform.test.ts`, `tests/vibe.test.ts`
- `scripts/vibe-advertisers.ts` (new read-only credential check), `scripts/client-check.mjs`, `verify-build.mjs`, `secret-check.mjs`, and `browser-check.mjs`
- `docs/VIBE.md`, `PAYMENTS.md`, `OPERATIONS.md`, `LAUNCH_CHECKLIST.md`, `SUPABASE.md`, this report

004 preserves historical campaign/payment/provider records; creates unique paid-only provisioning jobs, protects immutable provider identities, adds safe provider review snapshots, permits the new hold/failure states and removes the old database operator flag. 005 makes embedded-only account IDs optional, allows per-coin AIRTIME records to reference the same authorized advertiser, and stores that provider UUID on each campaign. Existing SQL already enforces unique transaction signatures/references, one paid invoice per campaign, exact integer financial values and one strategy. All 46 tables have RLS and no public grants.

## Accounting and administration

Customer SOL receipts, $50 reserved media liability, $10 service revenue, reported delivered spend, remaining media, refunds, operator conversion/funding evidence and aggregated Vibe outstanding billing are separate records. The $50 reserve is not profit or an immediate payment to Vibe. Creative review itself does not incur campaign media spend. Vibe bills accumulated delivered spending and its first threshold may aggregate multiple $50 campaigns. AIRTIME must maintain sufficient billing capacity.

Authenticated operations show creator/coin identity, creative ID/review/rejection, quote/reference/expiration, receipt signature, provider IDs, failed attempts, status, actual spend, remaining budget, impressions, completed views, failed jobs/refund cases, settlement totals and the global live/test mode. Actions remain server-authorized, origin-protected and audited; repeat settlement recording is idempotent. Raw provider troubleshooting bodies and credentials are not returned to creators.

## Official API boundary

Revision: `2026-06-01`, from the vendored official public contracts. Existing explicit-scope OAuth, account-bound billing, single authorized advertiser resolution, signed upload/video registration, creative list, campaign/strategy creation and publication/actions, geography/age catalogs and async reporting endpoints remain implemented. No fictional review-submission endpoint is added. All customers use AIRTIME’s private Vibe account. `VIBE_ACCOUNT_ID` is optional/blank. AIRTIME never calls `/accounts`; it resolves exactly one authorized advertiser through `/advertisers`, persists its returned UUID, and fails on zero/multiple results.

The public reporting download schema does not document every exported JSON shape. The adapter accepts only owned, scoped array rows and fails closed on unsupported exports; actual account report fixtures still need validation. No dedicated advertiser-approval/card-failure endpoint or guaranteed network-placement mechanism is invented. The observed OAuth scope behavior informed this patch. Code verification used mock credentials only; no real credential was read or tested here.

## Verification

- `npm run test`: **151 passed**, including real ephemeral PostgreSQL migrations/constraints and fully mocked provider/storage/RPC integration.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `node scripts/layout-db.mjs`: applied 001–005 to a fresh isolated local database. A second migration-runner execution exited successfully with no changes. No remote database was touched.
- `scripts/vibe-advertisers.ts` (new read-only credential check), `scripts/client-check.mjs`, `verify-build.mjs`, `secret-check.mjs`, and `browser-check.mjs`: **80 demo/private checks + 45 public prelaunch checks**, widths 375/390/768/1024/1440, no horizontal overflow or uncaught page errors. Desktop/mobile screenshots visually inspected. Authenticated private fixtures are explicitly DEMO DATA — NOT LIVE; public prelaunch checks disable demo mode.
- `node scripts/verify-build.mjs`: passed: production build completed; ten server-secret client canaries absent from browser bundles.
- `node scripts/secret-check.mjs`: passed: repository/built-artifact scan found no detected credentials. The historical exposed value was never retrieved or reused, so no literal comparison against it is claimed.

Screenshot artifacts: `/tmp/airtime-vibe-layout/airtime-platform-prelaunch-1440.png` and `airtime-platform-prelaunch-390.png`; creator/builder captures in `/tmp/airtime-vibe-private-layout/`.

## Remaining owner-controlled setup

Follow [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) in order. Revoke the exposed credential; configure replacement OAuth client credentials in private local/hosting secrets while leaving `VIBE_ACCOUNT_ID`, `VIBE_ACCESS_TOKEN`, and its expiration blank; use `npm run vibe:advertisers` for a safe read-only check; provision production database/private storage and the final domain. The creator upload function includes static FFprobe; `FFPROBE_PATH` is an optional server-only override. Configure mainnet public receiving wallet, RPC/webhook/worker secrets and TOTP administrator; set up AIRTIME’s Vibe billing card/capacity; validate actual review/report exports and policy/compliance documents; then explicitly authorize a controlled $60 SOL / $50 lifetime-media pilot by changing VIBE_LIVE_MODE. No customer Vibe account or marketplace installation is required.

No real SOL transfer, Vibe campaign publication, card charge, cryptocurrency conversion or advertising spend occurred. Default VIBE_LIVE_MODE remains false. Passing automated checks is not a claim that owner-account onboarding or live delivery has already been validated.
