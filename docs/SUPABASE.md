# PostgreSQL, authentication and private storage

1. Create a separate AIRTIME Supabase project. Do not use CUT’s database or keys.
2. Set `DATABASE_URL` to an appropriate session pool/direct connection, with `sslmode=verify-full` in production. The backend role must access the isolated `airtime` schema. Keep migration credentials server-side.
3. Copy `.env.example` to `.env.local` and run `npm run db:migrate`. The migration runner applies ordered SQL in transactions, records `public.airtime_migrations` and uses an advisory lock. Existing installations apply only unapplied migrations; 003 adds Vibe automation and 004 adds paid-only durable provisioning and immutable provider identities; 005 makes embedded-only account IDs optional and binds each campaign to the single private AIRTIME advertiser. The original treasury schema is preserved. New installations apply 001 → 002 → 003 → 004 → 005. Back up real data first.
4. Migration 002 adds 19 tables: users, wallets, authentication challenges/sessions, coins/authority evidence, creator campaigns, creatives, targeting, invoices/payments, status history, metrics, reviews, refunds, creator messages, signed claim requests, operations audit and private proof. All have RLS; public grants are revoked. Unique signatures/invoices, exact-amount guards, immutable quotes and append-only payment/audit records enforce important invariants. All creator access goes through the scoped authenticated backend, not anonymous Supabase table queries.
5. Configure `SUPABASE_URL` / `SUPABASE_ANON_KEY` for the existing admin Auth implementation. Disable public email signup, create/confirm the `ADMIN_EMAIL` user, then provision the actual Auth UUID:

```sql
INSERT INTO airtime.admin_users(id,email)
VALUES ('ACTUAL_AUTH_USER_UUID','actual-allowlisted-email@example.com')
ON CONFLICT(id) DO NOTHING;
```

6. Enable TOTP and verify administrator AAL2 before using operations. Creator accounts are wallet-signature sessions and do not use Supabase password signup.
7. Create a PRIVATE `airtime-proof` storage bucket. Do not grant anonymous public reads/writes. Configure the service role ONLY on the backend. Creator objects use `creators/USER_UUID/CREATIVE_UUID/...`; admin proof uses `operations/CAMPAIGN_UUID/PROOF_UUID`. Access checks happen before a 60-second signed URL is issued. Commercial MP4 ≤25 MB; thumbnail PNG/JPEG ≤2 MB; PDF/PNG/JPEG proof ≤10 MB. Provider bucket policies must permit the same MIME/types/sizes; no HTML/SVG/script uploads.
8. Production media validation requires a maintained `FFPROBE_PATH` binary on a host capable of its execution and request limits. Verify production storage/video playback and parser behavior. Ordinary Vercel function payload limits do not fit 25 MB uploads; choose a suitable host or implement private direct uploads plus a validation worker before using that deployment path. The development parser package is not the approved production binary.
9. Set retention/backup policies for private media, challenges, expired sessions and financial/audit records. Use an administrative cleanup job for old unused uploads/challenges without deleting invoice/audit evidence. Explicitly review/redact proof before publication.

`npm run test` executes all five migrations in ephemeral PGlite PostgreSQL, verifies all 46 tables’ RLS, retains a legacy record, and exercises tenant isolation/financial SQL. This is not a claim that your remote Supabase project has been provisioned or tested.
