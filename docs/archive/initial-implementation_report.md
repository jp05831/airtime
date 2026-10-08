# AIRTIME implementation report

Project: `/home/jp05831/airtime`, sibling of `/home/jp05831/cut`. All application, database and administrative code is separate. CUT's design CSS/configuration conventions were reused; its branding, affiliate system, attribution tables, wallet adapter, worker and payout service were not copied. Official upstream Pump IDL assets are independently verified.

## Completed implementation

- CUT-style cobalt/cyan/pale-blue gradient, Arial/Georgia headline, floating black navigation, responsive terminal, broadcast/television logo, rounded translucent cards and footer.
- Homepage, live funding meter, real database statistics, ledger, campaign preview, FAQ and disclosures.
- Campaign archive, public campaign proof pages, commercial/receipt/placement evidence, results, dates, linked expenses and social preview images.
- Treasury page with copy-address control, Solscan proof, available balance, separate accrued/claimed/seed/spend records and paginated ledger.
- Supabase password authentication plus mandatory provider-verified TOTP AAL2, allowlisted email, encrypted HTTP-only cookies and authorization on every admin endpoint.
- Settings, campaign CRUD, approval evidence, atomic/idempotent commitments, expense recording, file/link proofs, unknown-transfer classification, pause/maintenance, reconciliation, sync failure/target alerts and retry review.
- PostgreSQL migration `supabase/migrations/001_airtime.sql`: 15 isolated AIRTIME tables with foreign keys, uniqueness, indexes, RLS, append-only audit/accounting evidence and funding/expense guards.
- Authenticated Helius notifications, finalized mainnet RPC verification, official event decoding, canonical PumpSwap pool checks, paginated historical reconciliation, bounded retries/deadline, wallet snapshots and health endpoint.
- Integer-only lamport/price/allocation accounting, sourced CoinGecko prices, caching and honest unavailable USD states.
- Global local-demo warning; production rejects demo mode and incomplete/invalid required configuration. No seeded transactions, invented production wallets or automatic SOL transfers.
- CSRF/origin checks, rate limiting, bounded bodies, MIME/size/magic-byte upload checks, URL allowlists, constant-time webhook/worker secret comparison, sanitized errors, structured logs, security headers and nonce CSP.
- Complete environment template, Supabase/Helius/admin guides and ordered launch checklist.

## Fee evidence implemented

Pump TradeEvent.creator_fee and canonical SOL/WSOL PumpSwap BuyEvent/SellEvent.coin_creator_fee are decoded from official complete IDL layouts after the original successful transaction is fetched finalized from mainnet. Program log context / event-CPI caller and event authority are checked. Stored evidence includes revision, event name, program and bytes; the original finalized RPC payload is retained. Canonical pool owner/PDA/mint/creator/quote are verified. Holder rewards and cashback routing are excluded.

Exact collections use Pump CollectCreatorFeeEvent and WSOL-proven PumpSwap CollectCoinCreatorFeeEvent. Claims are wallet-wide and are never described as independently token-specific. Ordinary deposits remain UNCLASSIFIED. Reviewed advertising allocations require exact linked collection evidence, proven creator forwarding or same-signature collection, correct chronology and sufficient indexed token accrual. Collections are linked once, conservatively excluding split/uncertain claims until reconciliation. No fee-percentage estimate is substituted.

The official repository HEAD and all three vendored JSON files were verified on October 7, 2026 at revision cb188ce08b5069196eef1f3e4a0c43b70099793b. Signed virtual reserves and documented zero defaults for appended legacy Pool fields are supported; nonzero unknown extensions fail closed.

## Verification performed

| Check                                             | Result                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm install                                       | Passed; separate AIRTIME lockfile                                                                                                                         |
| Migration on safe local/test database             | Passed in temporary PGlite PostgreSQL, using the actual SQL file                                                                                          |
| npm run test                                      | 63 passed, including live-route contracts using mocked Auth/RPC transport                                                                                 |
| npm run lint                                      | Passed                                                                                                                                                    |
| npm run typecheck                                 | Passed                                                                                                                                                    |
| npm run build                                     | Passed, optimized Next.js production output                                                                                                               |
| Client-bundle scan                                | Passed with seven random server-secret canaries during build and scan                                                                                     |
| Production startup without required configuration | Rejected with exit 1 and sanitized missing-configuration error                                                                                            |
| CUT tests                                         | 66 passed                                                                                                                                                 |
| CUT protection hash check                         | All 219 protected source/assets files unchanged                                                                                                           |
| Responsive browser checks                         | See artifacts/browser-demo.json and artifacts/browser-prelaunch.json; widths 375, 390, 768, 1024, 1440                                                    |
| Screenshots                                       | artifacts/airtime-demo-_.png and artifacts/airtime-prelaunch-_.png                                                                                        |
| Dependency audit                                  | Eight remaining advisories: five high in development lint/glob dependencies, three moderate through SDK/RPC dependencies; artifacts/dependency-audit.json |

Build/preview verification was run sequentially after a Next.js development manifest race during concurrent preview/build was observed. Development and production use separate generated caches. No production deployment, creator-fee claim, media purchase, mainnet transfer or wallet signing was performed.

## Owner-controlled steps and remaining blockers

Follow docs/LAUNCH_CHECKLIST.md in order. Supply a separate PostgreSQL/Supabase project and Auth credentials; run production migrations; provision the allowlisted administrator and enable TOTP; configure mint, creator/treasury wallets, trading URLs and advertising allocation; set final HTTPS domain and distinct secrets; configure Helius mainnet RPC/webhook and authenticated cron; configure private proof storage or external HTTPS evidence hosting; fund/collect externally; obtain written media-platform approval; upload a finished/redacted commercial and evidence; complete legal review; and test the actual providers/mainnet tracking before launch.

Live Supabase Auth/Storage and real configured-mint RPC/webhook flows cannot be validated without those credentials. Automated provider contracts use realistic mocked transports, not claimed live approval. Full authenticated admin browser flow remains an owner acceptance test after provisioning. Mainnet archival completeness, unsupported protocol/configuration changes, wallet-wide multi-token claims and split deposits require reconciliation, not estimates. External alert delivery is not implemented; connect a monitor to the health endpoint and review stored admin alerts.

Review the eight dependency advisories before launch. The compatible UUID security override is applied; breaking forced upgrades were not substituted into the stable Solana/Next stack. Current Vercel Hobby scheduling uses cron-job.org to POST to `/api/worker`; Vercel Cron is not configured. Vercel function payload limits require smaller uploads or externally hosted commercial links. Proof upload validation is not a full malware scanner. Terms/privacy/disclosures are drafts for professional review. AIRTIME is a tested implementation candidate, not a claim of completed production onboarding or legal/media approval.
