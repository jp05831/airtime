import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import oldPump from "@/vendor/pump/pump.json";
import { decode } from "@/lib/server/protocol";
import { authorityAccount } from "@/lib/platform/pump-authority";

// Wire offsets from official Pump SDK 4.0.0 / IDL revision 2293f9a.
// Do not encode these fixtures with the decoder's own schema.
function curve() {
  const data = Buffer.alloc(166);
  Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).copy(data);
  new PublicKey(Buffer.alloc(32, 7)).toBuffer().copy(data, 49);
  data.writeBigUInt64LE(123n, 125);
  data.writeBigUInt64LE(456n, 133);
  data[141] = 1;
  data.writeBigUInt64LE(30000000000n, 142);
  data.writeBigUInt64LE(10n, 150);
  data.writeBigUInt64LE(20n, 158);
  return data;
}

describe("Versioned Pump authority decoding", () => {
  it("reproduces the production mismatch and decodes all current fields", () => {
    const data = curve();
    expect(() =>
      decode(oldPump, "BondingCurve", data.subarray(8), {
        accountCompatibility: true,
      }),
    ).toThrow("IDL revision mismatch");
    expect(authorityAccount("BondingCurve", data).state).toMatchObject({
      creator: new PublicKey(Buffer.alloc(32, 7)).toBase58(),
      creator_fee: 123n,
      protocol_fees: 456n,
      depth: 1n,
      initial_virtual_quote_reserves: 30000000000n,
      post_complete_base_out: 10n,
      post_complete_quote_in: 20n,
    });
  });
  it("defaults only absent trailing fields on the prior layout", () => {
    expect(
      authorityAccount("BondingCurve", curve().subarray(0, 125)).state,
    ).toMatchObject({
      creator: new PublicKey(Buffer.alloc(32, 7)).toBase58(),
      creator_fee: 0n,
      protocol_fees: 0n,
      depth: 0n,
      initial_virtual_quote_reserves: 0n,
      post_complete_base_out: 0n,
      post_complete_quote_in: 0n,
    });
  });
  it("supports the fee-bucket revision without migration fields", () => {
    expect(
      authorityAccount("BondingCurve", curve().subarray(0, 141)).state,
    ).toMatchObject({
      creator_fee: 123n,
      protocol_fees: 456n,
      depth: 0n,
      initial_virtual_quote_reserves: 0n,
    });
  });
  it.each([Buffer.alloc(1), Buffer.from([1])])(
    "rejects future trailing fields even if they are zero",
    (tail) => {
      expect(() =>
        authorityAccount("BondingCurve", Buffer.concat([curve(), tail])),
      ).toThrow("unsupported Pump account version");
    },
  );
  it("rejects a partial field instead of synthesizing an authority", () => {
    expect(() =>
      authorityAccount("BondingCurve", curve().subarray(0, 80)),
    ).toThrow("unsupported Pump account version");
  });
  it("rejects nonzero bytes in the reserved extended-curve byte", () => {
    const data = curve().subarray(0, 151);
    expect(() => authorityAccount("BondingCurve", data)).toThrow(
      "unsupported Pump account version",
    );
  });
});
