import { type AccountInfo } from "@solana/web3.js";
import pump from "@/vendor/pump/pump-authority.json";
import amm from "@/vendor/pump/pump_amm-authority.json";
import { decode } from "@/lib/server/protocol";
import { HttpError } from "@/lib/server/http";

export const AUTHORITY_REVISION = "2293f9a66c654e9fe82dc5e8f4618538f24bb35f";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// Official SDK 4.0.0 / PumpSwap SDK 2.1.0 lengths, including discriminator.
// Unlike the SDK's permissive padding, only known revisions are accepted.
const CURVE_LENGTHS = [49, 81, 82, 83, 115, 124, 125, 141, 150, 151, 166];
const POOL_LENGTHS = [211, 243, 244, 245, 261, 270, 271, 287, 300];
export function authorityAccount(kind: "BondingCurve" | "Pool", data: Buffer) {
  const idl = kind === "BondingCurve" ? pump : amm;
  const lengths = kind === "BondingCurve" ? CURVE_LENGTHS : POOL_LENGTHS;
  const size = kind === "BondingCurve" ? 166 : 287;
  const tag = idl.accounts[0].discriminator;
  try {
    if (
      !lengths.includes(data.length) ||
      !data.subarray(0, 8).equals(Buffer.from(tag))
    )
      throw Error("Unknown authority account revision");
    // 151 is an extended curve with one reserved byte after the last whole
    // field at 150. 300-byte pools have 13 reserved bytes after the 287 layout.
    const end = data.length === 151 ? 150 : Math.min(data.length, size);
    if (!data.subarray(end).every((v) => v === 0))
      throw Error("Unknown authority account extension");
    const padded = Buffer.alloc(size - 8);
    data.subarray(8, end).copy(padded);
    return {
      state: decode(idl, kind, padded),
      layout: `${kind}:${data.length}`,
    };
  } catch {
    throw new HttpError(
      422,
      "This coin uses an unsupported Pump account version. Creator verification could not be completed. Try again after AIRTIME adds support for this version.",
    );
  }
}

export function verifyMintAccount(account: AccountInfo<Buffer> | null) {
  const owner = account?.owner.toBase58();
  const data = account?.data;
  if (
    !account ||
    account.executable ||
    !data ||
    ![TOKEN, TOKEN_2022].includes(owner!) ||
    data.length < 82 ||
    data[45] !== 1 ||
    data.readUInt32LE(0) > 1 ||
    data.readUInt32LE(46) > 1 ||
    (owner === TOKEN && data.length !== 82) ||
    (owner === TOKEN_2022 &&
      data.length !== 82 &&
      (data.length < 166 ||
        data[165] !== 1 ||
        !data.subarray(82, 165).every((v) => v === 0)))
  )
    throw new HttpError(
      403,
      "Token mint could not be verified. Enter an initialized token mint on Solana mainnet.",
    );
}
