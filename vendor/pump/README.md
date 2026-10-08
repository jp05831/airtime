# Official Pump IDLs

Sources: https://github.com/pump-fun/pump-public-docs/tree/cb188ce08b5069196eef1f3e4a0c43b70099793b/idl

Checked against the official repository HEAD on October 7, 2026.

Pinned revision: `cb188ce08b5069196eef1f3e4a0c43b70099793b`.

Files `pump.json`, `pump_amm.json`, `pump_fees.json` are official public protocol IDLs, copied locally for reproducible offline decoding. No CUT affiliate functionality is copied. Fee percentages are not hardcoded. Each accepted fee record retains revision, program, event name and raw event bytes.

The decoder requires a complete matching layout and excludes unsupported changes. Review official current deployments and updated IDLs before launch. Supported SOL/WSOL trade and collection events are listed in the root README. Wallet-wide claims cannot independently identify a token; unsupported distributions, quote tokens and holder-reward configurations are conservatively excluded. Original finalized RPC transactions are retained for reconciliation.

Official fee information: https://pump.fun/docs/fees. Described venue/tier rates must not be treated as permanent constants or used as substitutes for decoded exact evidence.
