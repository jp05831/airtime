# Vibe integration — pinned revision 2026-06-01

Official source: https://developers.vibe.co/docs/getting-started and https://developers.vibe.co/reference. The selected public OpenAPI contracts and provenance are in `vendor/vibe/`. Never reuse the previously exposed credential. Revoke it in Vibe before doing anything with the owner account. Create a replacement application credential through the Vibe Developer Platform / My Applications. Check its issued credential type in that dashboard; do not infer type from a prefix.

AIRTIME uses a private, account-bound Vibe application; it is not an embedded or marketplace app. The documented client-credentials OAuth flow is `POST /oauth2/token` with HTTP Basic client ID/secret, `grant_type=client_credentials`, and the reviewed explicit scope set: `advertisers:read audiences:read audiences:write campaigns:read campaigns:write campaigns:publish creatives:read creatives:write reporting:read billing:read`. Live testing showed that omitting `scope` can issue a valid token with zero scopes. AIRTIME does not request account scopes, `advertisers:write`, or impression-tracking scopes. Access tokens are kept only in server memory, refreshed before expiration, and refreshed once on HTTP 401. An explicitly supplied access token requires `VIBE_ACCESS_TOKEN_EXPIRES_AT`; it cannot be refreshed without client credentials. Put replacement credentials in local `.env.local` or your hosting provider's secret storage. Never put them in NEXT_PUBLIC variables, screenshots, source code or chat.

Vibe requests use `Authorization: Bearer …` and `X-Vibe-Revision: 2026-06-01`. `VIBE_ACCOUNT_ID` is optional and remains blank for AIRTIME; Vibe marks `account_id` as embedded-only. It is attached only when explicitly configured. AIRTIME does not call `/accounts`. The owner advertiser is read from `GET /advertisers`: exactly one is required, and its returned UUID is persisted against creator/coin and campaign provider records. Empty or multiple results fail safely. No advertiser-create call is made. Changing the revision requires reviewing this adapter and its tests.

## Implemented official operations

- GET `/advertisers`; GET `/advertisers/{id}`
- GET `/billing/balance` (account-bound billing response; no `/accounts` call)
- GET `/creatives/upload-url`, POST its returned signed S3 form, POST `/creatives/video`, GET `/creatives`
- GET/POST `/campaigns`; GET `/campaigns/{id}`; POST `/campaigns/{id}/publish`
- GET/POST `/strategies`; GET/PATCH `/strategies/{id}`; POST `/strategies/{id}/actions` with ACTIVATE or PAUSE
- GET `/geo/locations`, `/segments/ages`
- POST `/reports`, GET `/reports/{id}` and its signed download URL

Commercial registration can return HTTP 202 `processing`. Only the same official upload ID is used for registration polling. Creative approval is `PROCESSING`, `PENDING_REVIEW`, `AUTHORIZED` or `BLOCKED`; BLOCKED's provider explanation is displayed. There is no invented submit-review endpoint. The public advertiser schema does not expose advertiser approval. AIRTIME does not pretend it does.

When `VIBE_CLIENT_ID` and `VIBE_CLIENT_SECRET` are configured, leave `VIBE_ACCESS_TOKEN` and `VIBE_ACCESS_TOKEN_EXPIRES_AT` blank. OAuth responses are cached in server memory and refreshed before expiry; a 401 triggers one refresh. `.env.example` leaves `VIBE_ACCOUNT_ID` blank.

A safe read-only check is `npm run vibe:advertisers`. It requests `/advertisers` and prints only the sole advertiser name and UUID; it does not query `/accounts`, upload media or mutate a campaign. The authenticated administrator connectivity action follows the same advertiser-only check.

## Explicit provider dependencies and unsupported behavior

AIRTIME uses its own Vibe account for every creator project. Customers do not connect Vibe accounts or install a marketplace application. Registering a creative initiates normal Vibe review; AIRTIME polls the documented creative list, without any fictional review-submission endpoint. Campaigns and strategies are not created until an independently finalized customer payment exists. There is no AIRTIME manual approval step or embedded/crypto configuration gate. Provider creative compliance review remains mandatory.

The public report schema specifies a download URL but not every JSON file shape. This adapter accepts only scoped array rows containing the requested campaign and advertiser IDs. Unexpected shapes/hosts fail closed. A controlled account report fixture must validate the actual exported shape before launch. Channel and geography reports are ingested separately without adding breakdown values to aggregate totals. Their actual export shapes still require owner-account fixture validation. No audience estimate is fabricated. Card failure/card details and advertiser approval APIs are not documented in the contracts used here; billing balance and PAYMENT_ISSUE campaign states are the available signals.

`GLOBAL` is the official lifetime budget enum. Exactly one $50 strategy is permitted, with a finite seven-day window; DAILY and open-ended budgets are rejected. The CPM optimization parameter is a configurable whole-dollar bidding input, not a forecast or a promise.

Draft create operations have durable names and persisted request hashes. After a timeout, a matching provider record can recover the operation. If none can be proven, no second create is sent. An operator must investigate the UNKNOWN operation with Vibe; there is intentionally no unsafe 'retry create' button. This may delay a campaign rather than duplicate it.

## Safe connectivity / activation

Default `VIBE_LIVE_MODE=false` prevents publish/ACTIVATE calls. Read-only advertiser lookup and creative registration and review polling can use configured owner credentials in prelaunch mode. A finalized paid order is held at READY_TO_ACTIVATE while false: no campaign or strategy is provisioned. Reporting and emergency PAUSE of already-running strategies remain available. The administrator panel labels this as prelaunch/test mode and offers a read-only connection check, not an artificial operator-approval gate.

Set `VIBE_LIVE_MODE=true` only for an explicitly authorized controlled pilot. The durable worker rechecks approved creative and finalized receipt, creates one non-delivering campaign, one inactive $50 GLOBAL strategy, attaches the approved creative/audience, then publishes and activates. Failed/ambiguous creates are reconciled using persisted resource identities; never blindly repeated.

Creative review itself does not incur the $50 media spend. Vibe charges AIRTIME according to accumulated delivered spend and account billing thresholds. A $60 SOL receipt reserves $50 media liability and records $10 service-fee revenue; it is not an immediate transfer of $50 to Vibe. Maintain sufficient billing capacity for aggregated charges, which may include several $50 campaigns before the first threshold is reached.

Rotate credentials by revoking the old application/token, storing replacement secrets, restarting the server to clear cached tokens, and performing read-only connectivity before enabling live mode. Never reuse the exposed historical credential or paste credentials into an audit message. The advertiser-only check is safe for live credentials, but no credentials were read or used during this code verification.
