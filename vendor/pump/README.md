# Official Pump IDLs

Sources: https://github.com/pump-fun/pump-public-docs/tree/cb188ce08b5069196eef1f3e4a0c43b70099793b/idl

Checked against the official repository HEAD on October 7, 2026.

Pinned revision: `cb188ce08b5069196eef1f3e4a0c43b70099793b`.

Files `pump.json`, `pump_amm.json`, `pump_fees.json` are official public protocol IDLs, copied locally for reproducible offline decoding. No CUT affiliate functionality is copied. Fee percentages are not hardcoded. Each accepted fee record retains revision, program, event name and raw event bytes.

The decoder requires a complete matching layout and excludes unsupported changes. Review official current deployments and updated IDLs before launch. Supported SOL/WSOL trade and collection events are listed in the root README. Wallet-wide claims cannot independently identify a token; unsupported distributions, quote tokens and holder-reward configurations are conservatively excluded. Original finalized RPC transactions are retained for reconciliation.

Official fee information: https://pump.fun/docs/fees. Described venue/tier rates must not be treated as permanent constants or used as substitutes for decoded exact evidence.

## Creator verification account snapshots (October 10, 2026)

`pump-authority.json` and `pump_amm-authority.json` contain only the official
program address, account discriminator and complete `BondingCurve` / `Pool`
structs from revision `2293f9a66c654e9fe82dc5e8f4618538f24bb35f`:
https://github.com/pump-fun/pump-public-docs/tree/2293f9a66c654e9fe82dc5e8f4618538f24bb35f/idl

These definitions also match the published official `@pump-fun/pump-sdk` 4.0.0
(npm tarball SHA-1 `eb2a41dbd7a85dcb8eb86c322692affac4bc2c6c`) and
`@pump-fun/pump-swap-sdk` 2.1.0
(SHA-1 `e24bd9444314f28d3a39f68a360bed566c60dc61`).
See `src/sdk.ts::decodeBondingCurve` and
`src/sdk/offlinePumpAmm.ts::decodePool` in those packages.

The current serialized lengths are 166 and 287 bytes, including discriminator.
The new curve fields are `creator_fee`, `protocol_fees`, `depth`,
`initial_virtual_quote_reserves`, `post_complete_base_out`, and
`post_complete_quote_in`; pools append `protocol_fees` and `creator_fees`.
The former authority decoder rejected nonzero appended fields as an IDL revision
mismatch. The dedicated authority decoder accepts known legacy lengths with
missing trailing fields defaulted, current lengths, and documented 150/151-byte
curve / 300-byte pool allocations with reserved bytes checked. Unknown sizes,
partial creator fields, invalid booleans, and unknown nonzero reserved bytes fail
closed with a user-facing 422 verification error. There is no on-chain revision
tag: evidence records the pinned source revision and the observed layout length.

Authority verification supports native SOL (zero quote key), WSOL and mainnet
USDC, legacy SPL Token mints and initialized Token-2022 mints. The mint, curve
and both canonical pool candidates are read together at finalized commitment
after checking mainnet genesis. Creator authority still comes from the genuine
Pump PDA / canonical PumpSwap pool, including existing verified fee-sharing
roles. Missing creators never fall back to metadata or the submitted wallet.
Holder-reward and cashback coins remain excluded.

USDC verification does not enable USDC fee claims: AIRTIME's existing claim
instructions and fee accounting remain SOL/WSOL-only, and USDC claim preparation
is explicitly unavailable. The original full IDLs and shared event decoder are
unchanged, so this update does not broaden payment, campaign or webhook decoding.

References:
- [Official versioned account guidance](https://github.com/pump-fun/pump-public-docs/blob/2293f9a66c654e9fe82dc5e8f4618538f24bb35f/docs/CPI_README.md)
- [SOL/USDC creation variants](https://github.com/pump-fun/pump-public-docs/blob/2293f9a66c654e9fe82dc5e8f4618538f24bb35f/docs/instructions/COIN_CREATION.md)
- [New fee fields and account growth](https://github.com/pump-fun/pump-public-docs/blob/2293f9a66c654e9fe82dc5e8f4618538f24bb35f/docs/instructions/SWEEP_FEES.md)
