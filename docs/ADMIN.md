# Automated campaign operations

The current workflow is documented in [OPERATIONS.md](OPERATIONS.md) and [VIBE.md](VIBE.md). New campaigns use real Vibe review/statuses and API activation, not manual approval or manually fabricated delivery reports. Historic manual orders remain archived.

## Exact manual refund procedure

- Review the rejected order, actual payment, zero media/partner cost and the full refund request.
- In the secured campaign-payment wallet, manually build/approve ONE ordinary System SOL transfer to the invoice’s original creator wallet for EXACT original paid lamports. Include a Memo program instruction with `AIRTIME:REFUND:REFUND_UUID`. Use the real UUID shown in the queue, not the campaign or invoice ID. Do not add unrelated instructions or another signer.
- Network fee is paid separately by the operator. Check balance before approving. Never paste the payment-wallet private key into AIRTIME.
- After finality, paste the signature into `Verify finalized refund`. Backend proof checks successful finalized mainnet, sender/recipient, exact amount, memo, recipient credit and timestamp after the refund request. Only then do refund/campaign statuses become VERIFIED/REFUNDED. Duplicate signatures cannot settle another record.
- This MVP’s automated refund state workflow handles full pre-placement refunds. Already purchased/partially spent, non-SOL or disputed orders require a reviewed support/accounting resolution under professionally finalized partner terms. Do not edit SQL to fabricate a refund status.

## Operations and recovery

Use `Pause submissions & payments` for maintenance. It blocks campaign mutations, claim/payment preparation/broadcast and worker processing; read-only billing remains available. Resume only after the issue is resolved. Wallets remain self-custodial; already broadcast signatures require reconciliation after resuming.

Monitor webhook/worker freshness, failed signatures, incomplete history and low payment-wallet reserves needed for refunds. Retry verification only, never payment broadcasts. The immutable audit records all reviews/messages/statuses/cost reporting. Fees/quotes are server environment configuration; campaign data is per creator. Legacy mutating admin endpoints return 410 after authentication; legacy tables/read-only records do not enter the new creator queue.

Before launch: actual provider-backed 2FA acceptance, storage/media playback, wallet compatibility, mainnet read verification, partner approval and legal review are owner actions. No external CTV credentials are stored or requested by this implementation.
