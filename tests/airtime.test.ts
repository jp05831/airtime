import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import bs58 from "bs58";
import {
  PublicKey,
  Message,
  Keypair,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import pump from "@/vendor/pump/pump.json";
import amm from "@/vendor/pump/pump_amm.json";
import {
  allocation,
  availableFunds,
  percentBps,
  decimalMicros,
  usdCents,
  WSOL,
} from "@/lib/accounting";
import { address, externalUrl, tradeUrl } from "@/lib/validation";
const store = vi.hoisted(() => ({ db: null as unknown as PGlite }));
vi.mock("@/lib/server/db", () => ({
  db: () => ({
    connect: async () => ({
      query: async (sql: string, args?: unknown[]) => {
        if (sql.includes("pg_try_advisory"))
          return { rows: [{ acquired: true }], rowCount: 1 };
        if (sql.includes("pg_advisory")) return { rows: [], rowCount: 1 };
        const r = await store.db.query(sql, args);
        return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
      },
      release: () => {},
    }),
    query: async (sql: string, args?: unknown[]) => {
      if (sql.includes("pg_try_advisory"))
        return { rows: [{ acquired: true }], rowCount: 1 };
      if (sql.includes("pg_advisory")) return { rows: [], rowCount: 1 };
      const result = await store.db.query(sql, args);
      return {
        rows: result.rows,
        rowCount: result.affectedRows ?? result.rows.length,
      };
    },
  }),
  transaction: async (fn: any) =>
    store.db.transaction(async (tx) =>
      fn({
        query: async (sql: string, args?: unknown[]) => {
          if (sql.includes("pg_advisory")) return { rows: [], rowCount: 1 };
          const result = await tx.query(sql, args);
          return {
            rows: result.rows,
            rowCount: result.affectedRows ?? result.rows.length,
          };
        },
      }),
    ),
}));
import { queue, processSignature, runSync, GENESIS } from "@/lib/server/chain";
import { funding, currentPrice } from "@/lib/server/queries";
import { refreshPrice } from "@/lib/server/price";
import {
  commitCampaign,
  recordExpense,
  transition,
  classify,
} from "@/lib/server/campaigns";
import { adminIdentity, seal, unseal } from "@/lib/server/auth";
import { authorize, limitedBytes } from "@/lib/server/http";
import { demoEnabled } from "@/lib/server/config";
import {
  verifiedFees,
  treasuryChange,
  PUMP,
  PUMP_AMM,
  canonicalPool,
  poolState,
} from "@/lib/server/protocol";
import { validateUpload } from "@/lib/server/uploads";
const pub = (n: number) =>
  Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey.toBase58();
const mint = pub(1),
  creator = pub(2),
  treasury = pub(3),
  buyer = pub(4),
  sig = bs58.encode(new Uint8Array(64).fill(1)),
  admin = "00000000-0000-4000-8000-000000000001";
const s = {
  mint,
  creator,
  treasury,
  pumpUrl: "https://pump.fun/coin/" + mint,
  axiomUrl: "https://axiom.trade/meme/airtime",
  allocationBps: 10000,
  paused: false,
  maintenance: false,
};
async function q(sql: string, args?: unknown[]) {
  return store.db.query<any>(sql, args);
}
async function chainTransfer(
  kind = "UNCLASSIFIED",
  amount = "1000000000",
  direction = "IN",
) {
  const signature = bs58.encode(randomBytes(64));
  await queue(signature, {});
  return (
    await q(
      `INSERT INTO treasury_transactions(signature,wallet,amount_lamports,direction,source_wallet,status,kind,block_time,advertising_lamports) VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8) RETURNING *`,
      [
        signature,
        treasury,
        amount,
        direction,
        creator,
        kind === "UNCLASSIFIED" ? "UNCLASSIFIED" : "VERIFIED",
        kind,
        kind === "FOUNDER_SEED" ? amount : "0",
      ],
    )
  ).rows[0];
}
async function milestone() {
  return (
    await q(
      "INSERT INTO campaigns(slug,title,target_usd_cents,approval_status,approval_proof_url) VALUES('first-drop','First Drop',10000,'APPROVED','https://example.com/approval') RETURNING *",
    )
  ).rows[0];
}
async function funded() {
  await chainTransfer("FOUNDER_SEED", "2000000000");
  await q(
    "INSERT INTO wallet_snapshots(wallet,balance_lamports,slot,commitment) VALUES($1,2000000000,1,'finalized')",
    [treasury],
  );
  await q(
    "INSERT INTO sol_price_snapshots(price_usd_micros,source) VALUES(100000000,'Test price')",
  );
  return milestone();
}
function event(name: string, values: Record<string, any>, idl: any = pump) {
  const fields = idl.types.find((x: any) => x.name === name)!.type as any;
  function encode(t: any, value: any): Buffer {
    if (t === "pubkey") return new PublicKey(value || buyer).toBuffer();
    if (t === "bool") return Buffer.from([value ? 1 : 0]);
    if (t === "string") {
      const b = Buffer.from(value || ""),
        size = Buffer.alloc(4);
      size.writeUInt32LE(b.length);
      return Buffer.concat([size, b]);
    }
    if (t.vec) return Buffer.alloc(4);
    if (typeof t === "string" && /^[ui]/.test(t)) {
      const size = Number(t.slice(1)) / 8,
        b = Buffer.alloc(size);
      let n = BigInt(value || 0);
      for (let i = 0; i < size; i++) {
        b[i] = Number(n & 255n);
        n >>= 8n;
      }
      return b;
    }
    throw Error("Unknown field");
  }
  return Buffer.concat([
    Buffer.from(
      (idl.events.find((x: any) => x.name === name) ||
        idl.accounts.find((x: any) => x.name === name))!.discriminator,
    ),
    ...fields.fields.map((f: any) => encode(f.type, values[f.name])),
  ]);
}
function fixture(): VersionedTransactionResponse {
  const bytes = event("TradeEvent", {
    mint,
    creator,
    user: buyer,
    is_buy: true,
    creator_fee: 3000000n,
    quote_mint: WSOL,
    sol_amount: 1000000000n,
  });
  return {
    slot: 1,
    blockTime: 1700000000,
    transaction: {
      signatures: [sig],
      message: new Message({
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1,
        },
        accountKeys: [buyer, PUMP],
        recentBlockhash: pub(5),
        instructions: [{ programIdIndex: 1, accounts: [0], data: "" }],
      }),
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [2000000000, 0],
      postBalances: [999995000, 0],
      logMessages: [
        `Program ${PUMP} invoke [1]`,
        "Program data: " + bytes.toString("base64"),
        `Program ${PUMP} success`,
      ],
      innerInstructions: [],
      loadedAddresses: { writable: [], readonly: [] },
    },
  };
}
beforeAll(async () => {
  store.db = new PGlite();
  await store.db.exec(
    await readFile("supabase/migrations/001_airtime.sql", "utf8"),
  );
  await store.db.exec("SET search_path=airtime,public");
});
afterAll(async () => {
  await store.db.close();
});
beforeEach(async () => {
  await store.db.exec(
    "TRUNCATE admin_users,campaigns,sol_price_snapshots,webhook_events,creator_fee_events,treasury_transactions,wallet_snapshots,campaign_expenses,campaign_proof,audit_logs,alerts,rate_limits,fund_commitments CASCADE",
  );
  Object.assign(process.env, {
    NODE_ENV: "test",
    TOKEN_MINT: mint,
    CREATOR_WALLET: creator,
    TREASURY_WALLET: treasury,
    PUMP_URL: s.pumpUrl,
    AXIOM_URL: s.axiomUrl,
    AD_ALLOCATION_BPS: "10000",
    APP_ORIGIN: "http://localhost:3200",
    ADMIN_EMAIL: "owner@example.com",
    AUTH_SECRET: "auth-secret-".padEnd(40, "a"),
    TOTP_ENCRYPTION_KEY: "totp-secret-".padEnd(40, "b"),
    HELIUS_WEBHOOK_SECRET: "webhook-secret",
    WORKER_SECRET: "worker-secret",
    DEMO_MODE: "false",
  });
  await q(
    "UPDATE sync_state SET cursors='{}',error=NULL,alert=NULL,last_success_at=NULL",
  );
  await q("UPDATE settings SET config=$1", [JSON.stringify(s)]);
  await q("INSERT INTO admin_users(id,email) VALUES($1,$2)", [
    admin,
    "owner@example.com",
  ]);
});
describe("Integer accounting", () => {
  it("allocates exact creator fees rather than trade volume", () => {
    expect(allocation(3000000n, 5000)).toBe(1500000n);
  });
  it("rounds integer allocations downward", () => {
    expect(allocation(3n, 5000)).toBe(1n);
    expect(() => allocation(1n, 10001)).toThrow();
  });
  it("excludes unverified funds and never returns negative available balances", () => {
    expect(availableFunds(0n, 0n, 0n, 0n, 100n)).toBe(0n);
    expect(availableFunds(100n, 0n, 120n, 0n, 100n)).toBe(0n);
    expect(availableFunds(100n, 0n, 0n, 10n, 30n)).toBe(20n);
  });
  it("bounds funding progress", () => {
    expect(percentBps(-1n, 100n)).toBe(0);
    expect(percentBps(50n, 100n)).toBe(5000);
    expect(percentBps(500n, 100n)).toBe(10000);
    expect(percentBps(1n, 0n)).toBe(0);
  });
  it("converts SOL/USD using scaled integer prices", () => {
    expect(decimalMicros("123.456789")).toBe(123456789n);
    expect(usdCents(1000000000n, 100000000n)).toBe(10000n);
  });
});
describe("Real schema, treasury and campaign records", () => {
  it("excludes unclassified deposits from advertising funds", async () => {
    await chainTransfer();
    expect((await funding(s)).allocation).toBe("0");
    expect((await funding(s)).seed).toBe("0");
  });
  it("keeps founder seed distinct from creator fees", async () => {
    const tx = await chainTransfer();
    await classify(
      {
        id: tx.id,
        kind: "FOUNDER_SEED",
        note: "Verified founder campaign seed",
      },
      admin,
    );
    const f = await funding(s);
    expect(f.seed).toBe("1000000000");
    expect(f.accrued).toBe("0");
  });
  it("excludes internal transfers", async () => {
    const tx = await chainTransfer();
    await classify(
      {
        id: tx.id,
        kind: "INTERNAL_TRANSFER",
        note: "Tracked wallet internal movement",
      },
      admin,
    );
    expect((await funding(s)).seed).toBe("0");
  });
  it("commits approved funds once with idempotency", async () => {
    const c = await funded(),
      key = randomUUID();
    await commitCampaign(c.id, 1000000000n, admin, key);
    expect(
      (await commitCampaign(c.id, 1000000000n, admin, key)).duplicate,
    ).toBe(true);
    expect((await funding(s)).available).toBe("1000000000");
    expect(
      (await q("SELECT committed_lamports FROM campaigns")).rows[0]
        .committed_lamports,
    ).toBe(1000000000);
  });
  it("rejects insufficient funds", async () => {
    const c = await funded();
    await expect(
      commitCampaign(c.id, 3000000000n, admin, randomUUID()),
    ).rejects.toThrow("Insufficient");
  });
  it("requires platform approval before commitments", async () => {
    const c = await funded();
    await q(
      "UPDATE campaigns SET approval_status='NOT SUBMITTED',approval_proof_url=NULL",
    );
    await expect(commitCampaign(c.id, 1n, admin, randomUUID())).rejects.toThrow(
      "approval",
    );
  });
  it("records spend without double accounting and publishes completed proof", async () => {
    const c = await funded();
    await commitCampaign(c.id, 1000000000n, admin, randomUUID());
    const key = randomUUID();
    await recordExpense(
      {
        campaignId: c.id,
        amount: "600000000",
        note: "Manual invoice entry",
        idempotencyKey: key,
      },
      admin,
    );
    expect(
      (
        await recordExpense(
          {
            campaignId: c.id,
            amount: "600000000",
            note: "Manual invoice entry",
            idempotencyKey: key,
          },
          admin,
        )
      ).duplicate,
    ).toBe(true);
    await q(
      "INSERT INTO campaign_proof(campaign_id,kind,title,url) VALUES($1,'RECEIPT','Invoice','https://example.com/invoice')",
      [c.id],
    );
    await transition(c.id, "COMPLETED", admin);
    const f = await funding(s);
    expect(f.spent).toBe("600000000");
    expect(f.committed).toBe("0");
    expect(f.available).toBe("1400000000");
  });
  it("requires proof and spend before completion", async () => {
    const c = await funded();
    await commitCampaign(c.id, 1000000000n, admin, randomUUID());
    await expect(transition(c.id, "COMPLETED", admin)).rejects.toThrow("proof");
  });
  it("prevents expenditure above commitment at the database layer", async () => {
    const c = await funded();
    await commitCampaign(c.id, 1000000000n, admin, randomUUID());
    await expect(
      recordExpense(
        {
          campaignId: c.id,
          amount: "1000000001",
          note: "Too much",
          idempotencyKey: randomUUID(),
        },
        admin,
      ),
    ).rejects.toThrow("commitment");
  });
  it("releases unspent commitments after rejection", async () => {
    const c = await funded();
    await commitCampaign(c.id, 1000000000n, admin, randomUUID());
    await transition(c.id, "REJECTED", admin);
    expect((await funding(s)).available).toBe("2000000000");
  });
  it("enforces transaction signature uniqueness", async () => {
    await queue(sig, {});
    await expect(
      q("INSERT INTO webhook_events(signature,payload) VALUES($1,$2)", [
        sig,
        "{}",
      ]),
    ).rejects.toThrow();
  });
  it("prevents changing a funding classification after inclusion", async () => {
    const tx = await chainTransfer("FOUNDER_SEED");
    await expect(
      q(
        "UPDATE treasury_transactions SET kind='INTERNAL_TRANSFER' WHERE id=$1",
        [tx.id],
      ),
    ).rejects.toThrow("immutable");
  });
});
describe("Finalized protocol monitoring", () => {
  it("decodes official variable creator-fee event data", async () => {
    const fees = await verifiedFees(fixture(), s, async () => {
      throw Error("No pool expected");
    });
    expect(fees[0].amount).toBe(3000000n);
    expect(fees[0].mint).toBe(mint);
  });
  it("excludes fee data for a different coin", async () => {
    expect(
      await verifiedFees(fixture(), { ...s, mint: pub(9) }, async () => {
        throw Error();
      }),
    ).toHaveLength(0);
  });
  it("rejects failed chain transactions", async () => {
    const tx = fixture();
    tx.meta!.err = { InstructionError: [0, "Custom"] };
    expect(
      await verifiedFees(tx, s, async () => {
        throw Error();
      }),
    ).toHaveLength(0);
  });
  it("excludes incompatible event layouts instead of estimating", async () => {
    const tx = fixture();
    tx.meta!.logMessages![1] =
      "Program data: " +
      event("TradeEvent", { mint, creator, quote_mint: WSOL })
        .subarray(0, 20)
        .toString("base64");
    expect(
      await verifiedFees(tx, s, async () => {
        throw Error();
      }),
    ).toHaveLength(0);
  });
  it("requires finalized signature status", async () => {
    await queue(sig, {});
    const conn = {
      getGenesisHash: async () => GENESIS,
      getSignatureStatuses: async () => ({
        value: [{ confirmationStatus: "confirmed" }],
      }),
    };
    await expect(processSignature(sig, conn as any)).rejects.toThrow(
      "finality",
    );
  });
  it("deduplicates queued webhook signatures", async () => {
    expect(await queue(sig, {})).toBe(true);
    expect(await queue(sig, {})).toBe(false);
  });
  it("does not infer creator-fee revenue from a treasury balance increase", () => {
    const tx = fixture();
    tx.transaction.message = new Message({
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 0,
      },
      accountKeys: [treasury, creator],
      recentBlockhash: pub(5),
      instructions: [],
    });
    tx.meta!.preBalances = [0, 1000000000];
    tx.meta!.postBalances = [1000000000, 0];
    const change = treasuryChange(tx, treasury, creator);
    expect(change?.amount).toBe(1000000000n);
    expect(change?.source).toBeNull();
  });
});
describe("Authentication and input protections", () => {
  it("requires the allowlisted administrator and aal2", () => {
    expect(() => adminIdentity("attacker@example.com", "aal2")).toThrow();
    expect(() => adminIdentity("owner@example.com", "aal1")).toThrow();
    expect(() => adminIdentity("owner@example.com", "aal2")).not.toThrow();
  });
  it("encrypts cookies and rejects tampering/expiry", () => {
    const cookie = seal({ access: "test-token", expires: Date.now() + 1000 });
    expect(cookie).not.toContain("test-token");
    expect(unseal(cookie).access).toBe("test-token");
    expect(() => unseal(cookie.slice(0, -3) + "bad")).toThrow();
    expect(() => unseal(seal({ access: "token", expires: 1 }))).toThrow();
  });
  it("rejects invalid wallet addresses and redirect hosts", () => {
    expect(address.safeParse("bad-wallet").success).toBe(false);
    expect(() => tradeUrl("axiom", "https://evil.example")).toThrow();
    expect(() => externalUrl("javascript:alert(1)")).toThrow();
  });
  it("authenticates Helius before accepting events, rejects malformed input and deduplicates", async () => {
    const { POST } = await import("@/app/api/webhooks/helius/route");
    const r = (
      header: string,
      payload = JSON.stringify([{ signature: sig }]),
    ) =>
      new NextRequest("http://localhost:3200/api/webhooks/helius", {
        method: "POST",
        headers: { authorization: header },
        body: payload,
      });
    expect((await POST(r("wrong"))).status).toBe(401);
    expect((await POST(r("webhook-secret", "{"))).status).toBe(400);
    expect((await POST(r("webhook-secret"))).status).toBe(200);
    expect((await POST(r("webhook-secret"))).status).toBe(200);
    expect((await q("SELECT * FROM webhook_events")).rows).toHaveLength(1);
  });
  it("authenticates the worker", async () => {
    const { POST } = await import("@/app/api/worker/route");
    expect(
      (
        await POST(
          new NextRequest("http://localhost:3200/api/worker", {
            method: "POST",
            headers: { authorization: "wrong" },
          }),
        )
      ).status,
    ).toBe(401);
  });
  it("rejects anonymous admin API access", async () => {
    const { GET } = await import("@/app/api/admin/state/route");
    expect(
      (await GET(new NextRequest("http://localhost:3200/api/admin/state")))
        .status,
    ).toBe(401);
  });
  it("rejects browser mutations from another origin", async () => {
    const { POST } = await import("@/app/api/admin/settings/route");
    expect(
      (
        await POST(
          new NextRequest("http://localhost:3200/api/admin/settings", {
            method: "POST",
            headers: { origin: "https://evil.example" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("disables demo mode in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    expect(demoEnabled()).toBe(false);
    vi.stubEnv("DEMO_MODE", "true");
    expect(() => demoEnabled()).toThrow("forbidden");
    vi.unstubAllEnvs();
  });
  it("enforces upload magic/type and size", () => {
    expect(() =>
      validateUpload(Buffer.from("not an mp4 file"), "video/mp4"),
    ).toThrow();
    expect(() =>
      validateUpload(Buffer.from("<svg>unsafe file</svg>"), "image/svg+xml"),
    ).toThrow();
    expect(() =>
      validateUpload(
        Buffer.from("%PDF-1.0 /JavaScript abc"),
        "application/pdf",
      ),
    ).toThrow();
  });
});
describe("Pricing failures", () => {
  it("keeps USD unavailable on provider failure", async () => {
    expect(
      await refreshPrice(async () => {
        throw Error("Offline");
      }),
    ).toBeNull();
    expect(await currentPrice()).toBeNull();
  });
  it("caches a sourced integer price snapshot", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ solana: { usd: 120.25 } }), {
          status: 200,
        }),
    );
    const p = await refreshPrice(fetcher as typeof fetch);
    expect(String(p.price_usd_micros)).toBe("120250000");
    await refreshPrice(fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Canonical fees, exact provenance and worker retries", () => {
  it.each([
    ["BuyEvent", 17n],
    ["SellEvent", 43n],
  ])(
    "decodes canonical PumpSwap %s using exact variable fees",
    async (name, fee) => {
      const tx = fixture(),
        pool = canonicalPool(mint, WSOL);
      tx.meta!.logMessages = [
        `Program ${PUMP_AMM} invoke [1]`,
        "Program data: " +
          event(
            name,
            { pool, coin_creator: creator, coin_creator_fee: fee },
            amm,
          ).toString("base64"),
        `Program ${PUMP_AMM} success`,
      ];
      const records = await verifiedFees(tx, s, async () => ({
        mint,
        quote: WSOL,
        creator,
        canonical: true,
        holder: false,
        cashback: false,
      }));
      expect(records[0].amount).toBe(fee);
      expect(records[0].venue).toBe("Canonical PumpSwap");
    },
  );
  it("excludes noncanonical and holder-reward pools", async () => {
    const tx = fixture();
    tx.meta!.logMessages = [
      `Program ${PUMP_AMM} invoke [1]`,
      "Program data: " +
        event(
          "BuyEvent",
          {
            pool: canonicalPool(mint, WSOL),
            coin_creator: creator,
            coin_creator_fee: 100n,
          },
          amm,
        ).toString("base64"),
      `Program ${PUMP_AMM} success`,
    ];
    expect(
      await verifiedFees(tx, s, async () => ({
        mint,
        quote: WSOL,
        creator,
        canonical: false,
        holder: false,
        cashback: false,
      })),
    ).toHaveLength(0);
    expect(
      await verifiedFees(tx, s, async () => ({
        mint,
        quote: WSOL,
        creator,
        canonical: true,
        holder: true,
        cashback: false,
      })),
    ).toHaveLength(0);
  });
  it("records wallet-wide collection evidence without inventing token provenance", async () => {
    const tx = fixture();
    tx.meta!.logMessages = [
      `Program ${PUMP} invoke [1]`,
      "Program data: " +
        event("CollectCreatorFeeEvent", {
          creator,
          creator_fee: 3000000n,
          quote_mint: WSOL,
        }).toString("base64"),
      `Program ${PUMP} success`,
    ];
    const records = await verifiedFees(tx, s, async () => {
      throw Error();
    });
    expect(records[0].kind).toBe("COLLECTION");
    expect(records[0].mint).toBeNull();
    expect(records[0].amount).toBe(3000000n);
  });
  it("does not trust another program emitting event-shaped bytes", async () => {
    const tx = fixture();
    tx.meta!.logMessages![0] = `Program ${pub(8)} invoke [1]`;
    expect(
      await verifiedFees(tx, s, async () => {
        throw Error();
      }),
    ).toHaveLength(0);
  });
  it("retries a temporary RPC failure without creating another fee record", async () => {
    await queue(sig, {});
    await q(
      "INSERT INTO sol_price_snapshots(price_usd_micros,source) VALUES(100000000,'Test price')",
    );
    const getTransaction = vi
      .fn()
      .mockRejectedValueOnce(Error("Temporary RPC failure"))
      .mockResolvedValue(fixture());
    const conn = {
      getGenesisHash: async () => GENESIS,
      getSignaturesForAddress: async () => [],
      getSignatureStatuses: async () => ({
        value: [{ confirmationStatus: "finalized" }],
      }),
      getTransaction,
      getBalanceAndContext: async () => ({
        value: 5000000000,
        context: { slot: 1 },
      }),
    };
    expect((await runSync(conn as any)).errors).toBe(1);
    expect((await runSync(conn as any)).errors).toBe(0);
    await runSync(conn as any);
    expect((await q("SELECT * FROM creator_fee_events")).rows).toHaveLength(1);
    expect(
      (await q("SELECT attempts FROM webhook_events")).rows[0].attempts,
    ).toBe(1);
    expect(getTransaction).toHaveBeenCalledTimes(2);
  });
  it("requires the Vercel Bearer authorization format", () => {
    const request = (authorization: string) =>
      new NextRequest("http://localhost:3200/api/worker", {
        headers: { authorization },
      });
    expect(() =>
      authorize(request("Bearer worker-secret"), "WORKER_SECRET", "Bearer "),
    ).not.toThrow();
    expect(() =>
      authorize(request("worker-secret"), "WORKER_SECRET", "Bearer "),
    ).toThrow();
  });
  it("cannot reuse a commitment key for a different amount", async () => {
    const c = await funded(),
      key = randomUUID();
    await commitCampaign(c.id, 1n, admin, key);
    await expect(commitCampaign(c.id, 2n, admin, key)).rejects.toThrow(
      "different commitment",
    );
  });
  it("protects commitment reserves after an unrelated wallet withdrawal", () => {
    expect(availableFunds(200n, 0n, 0n, 100n, 120n)).toBe(20n);
  });
  it("makes expense and audit evidence append-only", async () => {
    const c = await funded();
    await commitCampaign(c.id, 10n, admin, randomUUID());
    await recordExpense(
      {
        campaignId: c.id,
        amount: "5",
        note: "Invoice",
        idempotencyKey: randomUUID(),
      },
      admin,
    );
    await expect(
      q("UPDATE campaign_expenses SET amount_lamports=1"),
    ).rejects.toThrow("append-only");
    await expect(q("DELETE FROM audit_logs")).rejects.toThrow("append-only");
  });
});

describe("Official legacy Pool compatibility", () => {
  it("decodes signed negative virtual reserves and zero-defaults missing appended fields", () => {
    const full = event(
      "Pool",
      {
        base_mint: mint,
        quote_mint: WSOL,
        coin_creator: creator,
        virtual_quote_reserves: -123n,
      },
      amm,
    );
    expect(poolState(full).virtual_quote_reserves).toBe(-123n);
    const legacy = full.subarray(0, full.length - 26);
    expect(poolState(legacy).virtual_quote_reserves).toBe(0n);
    expect(poolState(legacy).is_holder_reward).toBe(false);
    expect(
      poolState(Buffer.concat([full, Buffer.alloc(32)])).coin_creator,
    ).toBe(creator);
    expect(() => poolState(Buffer.concat([full, Buffer.from([1])]))).toThrow(
      "mismatch",
    );
  });
  it("enforces funding capacity at the database layer", async () => {
    const c = await funded();
    await expect(
      q("UPDATE campaigns SET committed_lamports=3000000000 WHERE id=$1", [
        c.id,
      ]),
    ).rejects.toThrow("Insufficient verified");
  });
});
async function feeEvidence(kind: "ACCRUAL" | "COLLECTION", amount: string) {
  const signature = bs58.encode(randomBytes(64));
  await queue(signature, {});
  return (
    await q(
      `INSERT INTO creator_fee_events(signature,event_index,kind,mint,creator_wallet,amount_lamports,allocation_bps,allocation_lamports,venue,evidence,verification_status,block_time) VALUES($1,0,$2,$3,$4,$5,10000,$5,'Official event fixture','{}','VERIFIED',now()-interval '1 minute') RETURNING *`,
      [signature, kind, kind === "ACCRUAL" ? mint : null, creator, amount],
    )
  ).rows[0];
}
describe("Reviewed collection allocation", () => {
  it("records deposit allocation BPS and keeps accrual, claimed and available separate", async () => {
    await feeEvidence("ACCRUAL", "3000000");
    const claim = await feeEvidence("COLLECTION", "1000000"),
      deposit = await chainTransfer("UNCLASSIFIED", "1000000");
    vi.stubEnv("AD_ALLOCATION_BPS", "5000");
    try {
      await classify(
        {
          id: deposit.id,
          kind: "CREATOR_FEE_COLLECTION",
          collectionId: claim.id,
          note: "Exact creator-vault claim forwarded",
        },
        admin,
      );
      const f = await funding(s);
      expect(f.accrued).toBe("3000000");
      expect(f.claimed).toBe("1000000");
      expect(f.allocation).toBe("500000");
      expect(
        (await q("SELECT advertising_bps FROM treasury_transactions")).rows[0]
          .advertising_bps,
      ).toBe(5000);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("cannot allocate a collection twice", async () => {
    await feeEvidence("ACCRUAL", "3000000");
    const claim = await feeEvidence("COLLECTION", "1000000"),
      first = await chainTransfer("UNCLASSIFIED", "500000"),
      second = await chainTransfer("UNCLASSIFIED", "500000");
    await classify(
      {
        id: first.id,
        kind: "CREATOR_FEE_COLLECTION",
        collectionId: claim.id,
        note: "First forwarded collection",
      },
      admin,
    );
    await expect(
      classify(
        {
          id: second.id,
          kind: "CREATOR_FEE_COLLECTION",
          collectionId: claim.id,
          note: "Cannot reuse evidence",
        },
        admin,
      ),
    ).rejects.toThrow();
    expect((await funding(s)).allocation).toBe("500000");
  });
  it("excludes collection deposits exceeding reliably indexed token accrual", async () => {
    await feeEvidence("ACCRUAL", "10");
    const claim = await feeEvidence("COLLECTION", "1000000"),
      deposit = await chainTransfer("UNCLASSIFIED", "1000000");
    await expect(
      classify(
        {
          id: deposit.id,
          kind: "CREATOR_FEE_COLLECTION",
          collectionId: claim.id,
          note: "Missing token history",
        },
        admin,
      ),
    ).rejects.toThrow("indexed verified");
  });
  it("cannot label a deposit from an unproven sender as creator-fee forwarding", async () => {
    await feeEvidence("ACCRUAL", "3000000");
    const claim = await feeEvidence("COLLECTION", "1000000"),
      deposit = await chainTransfer("UNCLASSIFIED", "1000000");
    await q("UPDATE treasury_transactions SET source_wallet=NULL WHERE id=$1", [
      deposit.id,
    ]);
    await expect(
      classify(
        {
          id: deposit.id,
          kind: "CREATOR_FEE_COLLECTION",
          collectionId: claim.id,
          note: "Unrelated treasury deposit",
        },
        admin,
      ),
    ).rejects.toThrow("does not cover");
  });
});

describe("Bounded request bodies", () => {
  it("rejects chunked oversized content before parsing", async () => {
    const r = new NextRequest("http://localhost:3200/api/auth/login", {
      method: "POST",
      body: "x".repeat(11),
    });
    await expect(limitedBytes(r, 10)).rejects.toThrow("Request too large");
  });
});
function testToken(aal = "aal2") {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        aal,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: admin,
      }),
    ).toString("base64url"),
    Buffer.from("test-provider-signature").toString("base64url"),
  ].join(".");
}
function authenticatedRequest(path: string, payload?: unknown) {
  return new NextRequest("http://localhost:3200" + path, {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:3200",
      cookie:
        "airtime_admin=" +
        seal({ access: testToken(), expires: Date.now() + 60000 }),
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}
describe("Provider-backed admin route contracts (mock Auth transport)", () => {
  it("requires authentication on every administrator mutation", async () => {
    for (const name of [
      "campaigns",
      "campaign-action",
      "ledger",
      "resync",
      "settings",
      "upload",
    ]) {
      const route = await import("../app/api/admin/" + name + "/route");
      const response = await route.POST(
        new NextRequest("http://localhost:3200/api/admin/" + name, {
          method: "POST",
          headers: { origin: "http://localhost:3200" },
          body: "{}",
        }),
      );
      expect(response.status).toBe(401);
    }
  });
  it("loads legacy records and rejects retired single-treasury campaign creation", async () => {
    vi.stubEnv("SUPABASE_URL", "https://auth-test.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "test-anon-key");
    const provider = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: admin,
            email: "owner@example.com",
            aud: "authenticated",
            role: "authenticated",
            factors: [],
          }),
          { status: 200 },
        ),
    );
    try {
      const state = await import("@/app/api/admin/state/route");
      expect(
        (await state.GET(authenticatedRequest("/api/admin/state"))).status,
      ).toBe(200);
      const campaigns = await import("@/app/api/admin/campaigns/route");
      const response = await campaigns.POST(
        authenticatedRequest("/api/admin/campaigns", {
          slug: "actual-plan",
          title: "Streaming Test",
          description: "A planned commercial",
          targetUsdCents: "50000",
          platform: "Not yet approved",
          format: "15-second streaming video",
          videoUrl: "",
          approvalStatus: "NOT SUBMITTED",
          approvalProofUrl: "",
          plannedStart: null,
          plannedEnd: null,
          results: "",
        }),
      );
      expect(response.status).toBe(410);
      expect((await q("SELECT title,status FROM campaigns")).rows).toEqual([]);
      expect(provider).toHaveBeenCalled();
    } finally {
      provider.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("rejects a session when the provider returns a different administrator", async () => {
    vi.stubEnv("SUPABASE_URL", "https://auth-test.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "test-anon-key");
    const provider = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: admin,
            email: "attacker@example.com",
            aud: "authenticated",
            role: "authenticated",
          }),
          { status: 200 },
        ),
    );
    try {
      const route = await import("@/app/api/admin/state/route");
      expect(
        (await route.GET(authenticatedRequest("/api/admin/state"))).status,
      ).toBe(403);
    } finally {
      provider.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
const factorId = "00000000-0000-4000-8000-000000000002";
function authProvider(invalidOtp = false) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input),
      user = {
        id: admin,
        email: "owner@example.com",
        aud: "authenticated",
        role: "authenticated",
        factors: [{ id: factorId, factor_type: "totp", status: "verified" }],
      };
    if (url.endsWith("/challenge"))
      return new Response(
        JSON.stringify({
          id: randomUUID(),
          type: "totp",
          expires_at: Math.floor(Date.now() / 1000) + 300,
        }),
        { status: 200 },
      );
    if (url.endsWith("/verify") && invalidOtp)
      return new Response(
        JSON.stringify({
          msg: "Invalid verification code",
          code: "mfa_verification_failed",
        }),
        { status: 400 },
      );
    if (url.includes("/token") || url.endsWith("/verify"))
      return new Response(
        JSON.stringify({
          access_token: testToken(url.includes("/token") ? "aal1" : "aal2"),
          refresh_token: "provider-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
        { status: 200 },
      );
    return new Response(JSON.stringify(user), { status: 200 });
  });
}
function otpRequest() {
  return new NextRequest("http://localhost:3200/api/auth/verify", {
    method: "POST",
    headers: {
      origin: "http://localhost:3200",
      "Content-Type": "application/json",
      cookie:
        "airtime_pending=" +
        seal(
          {
            access: testToken("aal1"),
            refresh: "provider-refresh-token",
            factor: factorId,
            expires: Date.now() + 60000,
          },
          true,
        ),
    },
    body: JSON.stringify({ code: "123456" }),
  });
}
describe("Mandatory TOTP authentication contracts (mock provider)", () => {
  it("password sign-in only creates a pending enrollment/session cookie", async () => {
    vi.stubEnv("SUPABASE_URL", "https://auth-test.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "test-anon-key");
    const provider = authProvider();
    try {
      const { POST } = await import("@/app/api/auth/login/route");
      const response = await POST(
        new NextRequest("http://localhost:3200/api/auth/login", {
          method: "POST",
          headers: {
            origin: "http://localhost:3200",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: "owner@example.com",
            password: "test-password-only",
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect(response.cookies.get("airtime_pending")).toBeDefined();
      expect(response.cookies.get("airtime_admin")).toBeUndefined();
      expect((await response.json()).step).toBe("verify");
    } finally {
      provider.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("issues an encrypted HTTP-only administrator cookie only after provider AAL2 verification", async () => {
    vi.stubEnv("SUPABASE_URL", "https://auth-test.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "test-anon-key");
    const provider = authProvider();
    try {
      const { POST } = await import("@/app/api/auth/verify/route");
      const response = await POST(otpRequest());
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      const cookie = response.cookies.get("airtime_admin")!.value;
      expect(cookie).not.toContain(testToken());
      expect(
        JSON.parse(
          Buffer.from(
            unseal(cookie).access.split(".")[1],
            "base64url",
          ).toString(),
        ).aal,
      ).toBe("aal2");
      expect(
        (await q("SELECT * FROM audit_logs WHERE action='LOGIN_MFA_VERIFIED'"))
          .rows,
      ).toHaveLength(1);
    } finally {
      provider.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("does not issue administrator credentials for an invalid TOTP", async () => {
    vi.stubEnv("SUPABASE_URL", "https://auth-test.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "test-anon-key");
    const provider = authProvider(true);
    try {
      const { POST } = await import("@/app/api/auth/verify/route");
      const response = await POST(otpRequest());
      expect(response.status).toBe(401);
      expect(response.cookies.get("airtime_admin")).toBeUndefined();
    } finally {
      provider.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe("Funding alerts and maintenance", () => {
  it("alerts once when a planning target is reached without claiming approval or booking", async () => {
    const c = await funded();
    await q(
      "UPDATE campaigns SET approval_status='NOT SUBMITTED',approval_proof_url=NULL",
    );
    await q("UPDATE webhook_events SET status='VERIFIED'");
    const conn = {
      getGenesisHash: async () => GENESIS,
      getSignaturesForAddress: async () => [],
      getBalanceAndContext: async () => ({
        value: 2000000000,
        context: { slot: 1 },
      }),
    };
    await runSync(conn as any);
    await runSync(conn as any);
    const alerts = await q(
      "SELECT entity_id,message FROM alerts WHERE kind='CAMPAIGN_FUNDED'",
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].entity_id).toBe(c.id);
    expect(
      (await q("SELECT status,approval_status FROM campaigns")).rows[0],
    ).toEqual({ status: "PLANNING", approval_status: "NOT SUBMITTED" });
    expect((await q("SELECT * FROM campaign_expenses")).rows).toHaveLength(0);
  });
  it("maintenance pauses the worker before any network synchronization", async () => {
    await q("UPDATE settings SET config=$1", [
      JSON.stringify({ ...s, maintenance: true }),
    ]);
    vi.stubEnv("DATABASE_URL", "mock-test-database");
    const getGenesisHash = vi.fn();
    try {
      expect(await runSync({ getGenesisHash } as any)).toEqual({
        paused: true,
      });
      expect(getGenesisHash).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Creator-fee routing exclusions", () => {
  it("excludes cashback routed to traders instead of calling it creator revenue", async () => {
    const tx = fixture();
    tx.meta!.logMessages![1] =
      "Program data: " +
      event("TradeEvent", {
        mint,
        creator,
        creator_fee: 3000000n,
        quote_mint: WSOL,
        cashback: 3000000n,
      }).toString("base64");
    expect(
      await verifiedFees(tx, s, async () => {
        throw Error();
      }),
    ).toHaveLength(0);
  });
  it("excludes cashback pools even when an event contains a creator-fee amount", async () => {
    const tx = fixture();
    tx.meta!.logMessages = [
      `Program ${PUMP_AMM} invoke [1]`,
      "Program data: " +
        event(
          "BuyEvent",
          {
            pool: canonicalPool(mint, WSOL),
            coin_creator: creator,
            coin_creator_fee: 3000000n,
          },
          amm,
        ).toString("base64"),
      `Program ${PUMP_AMM} success`,
    ];
    expect(
      await verifiedFees(tx, s, async () => ({
        mint,
        quote: WSOL,
        creator,
        canonical: true,
        holder: false,
        cashback: true,
      })),
    ).toHaveLength(0);
  });
});
describe("Migration isolation and access controls", () => {
  it("creates accounting tables only in the AIRTIME schema with row-level security", async () => {
    const { rows } = await q(
      "SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='airtime' AND c.relkind='r'",
    );
    expect(rows).toHaveLength(15);
    expect(rows.every((r: any) => r.relrowsecurity)).toBe(true);
    expect(
      (
        await q(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('campaigns','treasury_transactions','creator_fee_events')",
        )
      ).rows,
    ).toHaveLength(0);
  });
});
