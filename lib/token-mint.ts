import { PublicKey } from "@solana/web3.js";

/** Only the deployment environment supplies AIRTIME's public mint. */
export function tokenMint(value: string | undefined): string | null {
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return null;
  try {
    return new PublicKey(value).toBase58() === value ? value : null;
  } catch {
    return null;
  }
}
