import { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
export type TransactionWallet = {
  publicKey?: { toString(): string };
  signTransaction(tx: Transaction): Promise<Transaction>;
};
export async function signReviewedTransaction(
  provider: TransactionWallet,
  encoded: string,
  wallet: string,
) {
  if (provider.publicKey?.toString() !== wallet)
    throw Error(
      "Reconnect the reviewed payer wallet before approving a transaction.",
    );
  const signed = await provider.signTransaction(
    Transaction.from(Buffer.from(encoded, "base64")),
  );
  return signed.serialize().toString("base64");
}
