# Multi-creator refactor plan

1. Preserve the existing design tokens, logo, navigation styling, panels and responsive rules. Preserve legacy AIRTIME data and tests.
2. Add a forward-only multi-tenant schema for creators, authority evidence, private campaigns/creative/targeting, exact invoices, finalized payments, messages, reviews, metrics and refunds.
3. Add single-use wallet authentication for Phantom/Solflare, mainnet coin discovery/manual verification and current official Pump authority/claim instruction support.
4. Build the creator application and five-step campaign builder, separated signed claims and payments, private uploads, billing and ownership checks.
5. Adapt existing administrator TOTP authentication to a reviewed campaign operations queue with manual external fulfillment and audited refunds.
6. Replace the public treasury information architecture with the creator advertising product; update metadata, disclosures and launch guides.
7. Apply both migrations to an isolated test database; test authentication, authority, ownership, accounting, payments, creative validation and transitions; lint/typecheck/build/secret-scan and inspect responsive pages. Never send real transactions in tests.
