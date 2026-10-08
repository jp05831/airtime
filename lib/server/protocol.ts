import {
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  PublicKey,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import bs58 from "bs58";
import pump from "@/vendor/pump/pump.json";
import amm from "@/vendor/pump/pump_amm.json";
import { WSOL, ZERO } from "@/lib/accounting";
import type { Settings } from "@/lib/types";
export const PUMP = pump.address,
  PUMP_AMM = amm.address,
  REVISION = "cb188ce08b5069196eef1f3e4a0c43b70099793b";
export function decode(
  idl: any,
  name: string,
  bytes: Buffer,
  options: { poolCompatibility?: boolean; accountCompatibility?: boolean } = {},
) {
  let offset = 0;
  const take = (n: number) => {
    if (n < 0 || offset + n > bytes.length)
      throw Error("Unsupported official layout");
    const value = bytes.subarray(offset, offset + n);
    offset += n;
    return value;
  };
  function read(t: any): any {
    if (t === "pubkey") return new PublicKey(take(32)).toBase58();
    if (t === "bool") {
      const v = take(1)[0];
      if (v > 1) throw Error("Invalid boolean");
      return !!v;
    }
    if (t === "string") {
      const length = take(4).readUInt32LE();
      return take(length).toString();
    }
    if (typeof t === "string" && /^[ui](8|16|32|64|128)$/.test(t)) {
      const size = Number(t.slice(1)) / 8,
        b = take(size);
      let n = 0n;
      for (let i = size - 1; i >= 0; i--) n = n * 256n + BigInt(b[i]);
      if (t[0] === "i" && b[size - 1] & 128) n -= 1n << BigInt(size * 8);
      return n;
    }
    if (t.option) {
      const present = take(1)[0];
      if (present > 1) throw Error("Invalid option");
      return present ? read(t.option) : null;
    }
    if (t.vec) {
      const size = take(4).readUInt32LE();
      if (size > 256) throw Error("Oversized vector");
      return Array.from({ length: size }, () => read(t.vec));
    }
    if (t.array)
      return Array.from({ length: t.array[1] }, () => read(t.array[0]));
    if (t.defined) return struct(t.defined.name);
    throw Error("Unsupported official type");
  }
  function struct(n: string): any {
    const type = idl.types.find((x: any) => x.name === n);
    if (type?.type.kind === "enum") {
      const index = take(1)[0];
      const variant = type.type.variants[index];
      if (!variant || variant.fields) throw Error("Unsupported enum");
      return variant.name;
    }
    if (type?.type.kind !== "struct") throw Error("Unsupported structure");
    return Object.fromEntries(
      type.type.fields.map((f: any) => {
        // Official PumpSwap documentation defaults missing appended fields on legacy Pool accounts.
        const appended = [
          "is_mayhem_mode",
          "is_cashback_coin",
          "virtual_quote_reserves",
          "creator_fee_bps",
          "can_edit_creator_fee",
          "is_holder_reward",
          "quote_mint",
        ];
        if (
          (options.poolCompatibility || options.accountCompatibility) &&
          ["Pool", "BondingCurve"].includes(n) &&
          offset === bytes.length &&
          appended.includes(f.name)
        )
          return [
            f.name,
            f.type === "bool" ? false : f.type === "pubkey" ? ZERO : 0n,
          ];
        return [f.name, read(f.type)];
      }),
    );
  }
  const result = struct(name);
  if (
    offset !== bytes.length &&
    !(
      (options.poolCompatibility || options.accountCompatibility) &&
      bytes.subarray(offset).every((v) => v === 0)
    )
  )
    throw Error("IDL revision mismatch");
  return result;
}
export function canonicalPool(mint: string, quote: string) {
  const creator = PublicKey.findProgramAddressSync(
    [Buffer.from("pool-authority"), new PublicKey(mint).toBuffer()],
    new PublicKey(PUMP),
  )[0];
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      Buffer.from([0, 0]),
      creator.toBuffer(),
      new PublicKey(mint).toBuffer(),
      new PublicKey(quote).toBuffer(),
    ],
    new PublicKey(PUMP_AMM),
  )[0].toBase58();
}
export function poolState(data: Buffer) {
  const a = amm.accounts.find((x) => x.name === "Pool")!;
  if (!data.subarray(0, 8).equals(Buffer.from(a.discriminator)))
    throw Error("Invalid Pool account");
  return decode(amm, "Pool", data.subarray(8), { poolCompatibility: true });
}
export function officialEvents(tx: VersionedTransactionResponse) {
  const events: { program: string; bytes: Buffer }[] = [],
    stack: string[] = [];
  for (const line of tx.meta?.logMessages || []) {
    const start = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (start) {
      stack.push(start[1]);
      continue;
    }
    const end = /^Program (\w+) (success|failed:)/.exec(line);
    if (end) {
      if (stack.at(-1) === end[1]) stack.pop();
      else stack.length = 0;
      continue;
    }
    if (
      line.startsWith("Program data: ") &&
      [PUMP, PUMP_AMM].includes(stack.at(-1) || "")
    )
      events.push({
        program: stack.at(-1)!,
        bytes: Buffer.from(line.slice(14), "base64"),
      });
  }
  if (tx.meta) {
    const keys = tx.transaction.message.getAccountKeys({
      accountKeysFromLookups: tx.meta.loadedAddresses,
    });
    for (const group of tx.meta.innerInstructions || []) {
      const outer = tx.transaction.message.compiledInstructions[group.index],
        parents = new Map([
          [1, outer ? keys.get(outer.programIdIndex)?.toBase58() : ""],
        ]);
      for (const ix of group.instructions) {
        const program = keys.get(ix.programIdIndex)?.toBase58(),
          height = (ix as typeof ix & { stackHeight?: number }).stackHeight;
        if (!program || !height) continue;
        const caller = parents.get(height - 1);
        for (const d of parents.keys()) if (d > height) parents.delete(d);
        parents.set(height, program);
        if (![PUMP, PUMP_AMM].includes(program) || caller !== program) continue;
        const bytes = Buffer.from(bs58.decode(ix.data)),
          tag = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]),
          authority = PublicKey.findProgramAddressSync(
            [Buffer.from("__event_authority")],
            new PublicKey(program),
          )[0];
        if (
          bytes.subarray(0, 8).equals(tag) &&
          keys.get(ix.accounts[0])?.equals(authority)
        )
          events.push({ program, bytes: bytes.subarray(8) });
      }
    }
  }
  const seen = new Set<string>();
  return events
    .filter((e) => {
      const key = e.program + e.bytes.toString("hex");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((e, index) => {
      const idl = e.program === PUMP ? pump : amm,
        event = idl.events.find((x) =>
          e.bytes.subarray(0, 8).equals(Buffer.from(x.discriminator)),
        );
      if (!event) return null;
      try {
        return {
          program: e.program,
          index,
          name: event.name,
          data: decode(idl, event.name, e.bytes.subarray(8)),
          evidence: {
            revision: REVISION,
            event: event.name,
            program: e.program,
            bytes: e.bytes.toString("base64"),
          },
        };
      } catch {
        return {
          program: e.program,
          index,
          name: event.name,
          data: null,
          evidence: {
            revision: REVISION,
            event: event.name,
            program: e.program,
            bytes: e.bytes.toString("base64"),
          },
        };
      }
    })
    .filter((e) => e !== null);
}
export type FeeRecord = {
  index: number;
  kind: "ACCRUAL" | "COLLECTION";
  mint: string | null;
  creator: string;
  amount: bigint;
  venue: string;
  evidence: unknown;
};
export async function verifiedFees(
  tx: VersionedTransactionResponse,
  s: Settings,
  resolve: (pool: string) => Promise<{
    mint: string;
    quote: string;
    creator: string;
    canonical: boolean;
    holder: boolean;
    cashback: boolean;
  }>,
) {
  const result: FeeRecord[] = [];
  const expectedPool = canonicalPool(s.mint, WSOL);
  if (tx.meta?.err || !tx.meta || !tx.blockTime) return result;
  for (const event of officialEvents(tx)) {
    const e = event.data;
    if (
      !e ||
      e.holder_rewards > 0n ||
      e.holder_rewards_bps > 0n ||
      e.cashback > 0n
    )
      continue;
    let record: FeeRecord | null = null;
    if (
      event.program === PUMP &&
      event.name === "TradeEvent" &&
      e.mint === s.mint &&
      e.creator === s.creator &&
      [ZERO, WSOL].includes(e.quote_mint)
    )
      record = {
        index: event.index,
        kind: "ACCRUAL",
        mint: s.mint,
        creator: e.creator,
        amount: e.creator_fee,
        venue: "Pump bonding curve",
        evidence: event.evidence,
      };
    if (
      event.program === PUMP_AMM &&
      ["BuyEvent", "SellEvent"].includes(event.name) &&
      e.pool === expectedPool
    ) {
      const p = await resolve(e.pool);
      if (
        p.canonical &&
        !p.holder &&
        !p.cashback &&
        p.mint === s.mint &&
        p.creator === s.creator &&
        p.quote === WSOL &&
        e.coin_creator === s.creator
      )
        record = {
          index: event.index,
          kind: "ACCRUAL",
          mint: s.mint,
          creator: e.coin_creator,
          amount: e.coin_creator_fee,
          venue: "Canonical PumpSwap",
          evidence: event.evidence,
        };
    }
    // Collections are wallet-wide. They prove claimed creator fees, not which coin generated them.
    if (
      event.program === PUMP &&
      event.name === "CollectCreatorFeeEvent" &&
      e.creator === s.creator &&
      [ZERO, WSOL].includes(e.quote_mint)
    )
      record = {
        index: event.index,
        kind: "COLLECTION",
        mint: null,
        creator: e.creator,
        amount: e.creator_fee,
        venue: "Pump creator vault",
        evidence: event.evidence,
      };
    // PumpSwap collection denomination requires token-balance mint proof for the event's vault.
    if (
      event.program === PUMP_AMM &&
      event.name === "CollectCoinCreatorFeeEvent" &&
      e.coin_creator === s.creator
    ) {
      const keys = tx.transaction.message.getAccountKeys({
        accountKeysFromLookups: tx.meta.loadedAddresses,
      });
      const balance = tx.meta.preTokenBalances?.find(
        (b) =>
          keys.get(b.accountIndex)?.toBase58() === e.coin_creator_vault_ata &&
          b.mint === WSOL,
      );
      if (balance)
        record = {
          index: event.index,
          kind: "COLLECTION",
          mint: null,
          creator: e.coin_creator,
          amount: e.coin_creator_fee,
          venue: "PumpSwap creator vault",
          evidence: event.evidence,
        };
    }
    if (record && record.amount >= 0n && record.amount <= 9223372036854775807n)
      result.push(record);
  }
  return result;
}
export function treasuryChange(
  tx: VersionedTransactionResponse,
  wallet: string,
  creator: string,
) {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta.loadedAddresses,
  });
  let index = -1;
  for (let i = 0; i < keys.length; i++)
    if (keys.get(i)?.toBase58() === wallet) index = i;
  if (index < 0) return null;
  const pre = tx.meta.preBalances[index],
    post = tx.meta.postBalances[index];
  if (!Number.isSafeInteger(pre) || !Number.isSafeInteger(post))
    throw Error("Unsafe RPC lamport balance");
  const delta = BigInt(post) - BigInt(pre);
  if (delta === 0n) return null;
  let provenSource: string | null = null;
  const instructions = [
    ...tx.transaction.message.compiledInstructions.map((ix) => ({
      programIdIndex: ix.programIdIndex,
      accounts: ix.accountKeyIndexes,
      data: bs58.encode(ix.data),
    })),
    ...(tx.meta.innerInstructions || []).flatMap((g) => g.instructions),
  ];
  for (const ix of instructions) {
    if (!keys.get(ix.programIdIndex)?.equals(SystemProgram.programId)) continue;
    try {
      const transfer = SystemInstruction.decodeTransfer(
        new TransactionInstruction({
          programId: SystemProgram.programId,
          keys: ix.accounts.map((i) => ({
            pubkey: keys.get(i)!,
            isSigner: false,
            isWritable: true,
          })),
          data: Buffer.from(bs58.decode(ix.data)),
        }),
      );
      if (
        transfer.toPubkey.toBase58() === wallet &&
        transfer.fromPubkey.toBase58() === creator &&
        transfer.lamports === delta
      )
        provenSource = creator;
    } catch {
      /* Unsupported transfer layouts stay unclassified. */
    }
  }
  return {
    amount: delta < 0n ? -delta : delta,
    direction: delta > 0n ? ("IN" as const) : ("OUT" as const),
    source: provenSource,
  };
}
