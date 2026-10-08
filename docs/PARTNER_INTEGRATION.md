# Fulfillment boundary

Current mode: MANUAL. The administrator reviews a finalized, paid creator order, records written platform approval, then creates/purchases the order externally. No Vibe, Roku, TV network or inventory API is implemented or claimed. Advertising credentials never enter the browser or creator workspace.

A future partner adapter must accept an approved immutable order (campaign ID, creative private access, reviewed targeting, USD media cap, run dates), return an external ID, expose authenticated idempotent scheduling/status/reporting callbacks and provide cancellation/refund/receipt evidence. Keep this separate from wallet authentication, fee claims and payment settlement. API results must not bypass human/legal review or alter invoice prices. Store provider credentials server-side; audit all partner actions; retries must use the campaign ID as an idempotency key.

Required external relationship: written acceptance of crypto advertising, actual placements and audiences, compliance restrictions, minimum spends/CPM, card/wire billing, reporting evidence, data processing and cancellation/refund conditions. Obtain creative-specific approval before APPROVED/SCHEDULED. Estimated CPM/impressions shown in the builder are a generic illustrative model, not a partner quote or promised delivery.
