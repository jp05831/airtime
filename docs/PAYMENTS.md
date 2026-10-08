# Fixed SOL checkout

Version one sells $50 lifetime media + $10 AIRTIME service = $60 equivalent in SOL. Integer cents, USD micros and lamports are used. Required lamports are rounded up by integer division. Prices come from a backend CoinGecko response with exact numeric lexemes, cached for 60 seconds; unavailable pricing prevents a quote.

The five-minute quote records price source/time, creator, mint, recipient, exact lamports, approval evidence and a unique UUID payment reference. A reviewed transaction contains only the exact System Program transfer and Memo `AIRTIME:<payment-reference>`. Its prepared message is retained and immutable. The creator explicitly signs. Signed bytes/signature are stored before one RPC broadcast with retries disabled; uncertain broadcasts are reconciled, never resent automatically.

Only finalized successful mainnet transactions with matching sender, recipient, exact amount, reference, timestamp and immutable prepared instruction structure can credit an invoice. Unique signatures/references and one paid invoice per campaign are enforced by SQL. Partial/overpayments are not accepted automatically. Prepared expired quotes require history/blockhash reconciliation before replacement.

Quotes and broadcast are blocked before real creative approval. Checkout unlocks automatically on AUTHORIZED creative status; it is independent of the publishing kill switch. A receipt already sent is still reconciled if provider approval changes afterward; its money is recorded honestly, but campaign activation remains blocked pending approval/refund review.

Creator-fee claims remain separate official Pump transactions with independent wallet approval and finalized evidence. Wallet SOL is never relabeled as proven creator fees.

$60 received is separated into $50 media liability and $10 service fee in settlement records. SOL does not go directly to Vibe or a network. The operator configures a billing card directly in Vibe, handles conversion outside AIRTIME and records conversion/funding references. No Coinbase/card credentials are collected. Creative review does not incur media spend. Vibe bills accumulated delivered spend; account billing thresholds aggregate multiple campaigns and do not correspond one-to-one with customer receipts. The $50 reserve is not AIRTIME profit.

Refunds require administrator review and a real finalized exact transfer to the original payer. AIRTIME never sends refunds automatically. Published campaigns with uncertain spend cannot receive an automatic full refund; resolve provider spend first. Keep network fees and any published policy conditions explicit. Professional review of the revision/refund policy is still required.

Confirmed payment creates exactly one durable `campaign_provisioning` job in the same database transaction. Duplicate confirmation returns the original receipt; invoice/reference/signature uniqueness and forward migration 004 prevent unpaid provider provisioning. Unprepared expired quotes are cleaned up by the worker. Prepared quotes remain reconcilable until their signed transaction/blockhash outcome is proven, even after the browser closes.
