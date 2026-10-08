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
import { randomUUID } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { NextRequest } from "next/server";
import {
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import pump from "@/vendor/pump/pump.json";
import amm from "@/vendor/pump/pump_amm.json";
import fees from "@/vendor/pump/pump_fees.json";
vi.mock("@/lib/vibe/review", () => ({
  assertCreativeApproved: async (id: string) => {
    const row = (
      await store.db.query(
        "SELECT cr.id,cr.external_id,cr.approval_status FROM vibe_creatives cr JOIN ad_campaigns c ON c.id=cr.campaign_id WHERE cr.campaign_id=$1 AND cr.creative_id=(c.brief->>'creativeId')::uuid",
        [id],
      )
    ).rows[0] as any;
    if (row?.approval_status !== "AUTHORIZED")
      throw Error("Creative approval required");
    return {
      creative: row,
      live: { id: row.external_id, approval_status: row.approval_status },
    };
  },
}));
const store = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  connection: null as any,
  objects: new Map<string, Uint8Array>(),
}));
vi.mock("@/lib/server/db", () => {
  const query = async (sql: string, args?: unknown[]) => {
    if (sql.includes("pg_try_advisory"))
      return { rows: [{ acquired: true }], rowCount: 1 };
    if (sql.includes("pg_advisory")) return { rows: [], rowCount: 1 };
    const r = await store.db.query(sql, args);
    return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
  };
  return {
    db: () => ({ query, connect: async () => ({ query, release: () => {} }) }),
    transaction: async (fn: any) =>
      store.db.transaction(async (tx) =>
        fn({
          query: async (sql: string, args?: unknown[]) => {
            if (sql.includes("pg_advisory")) return { rows: [], rowCount: 1 };
            const r = await tx.query(sql, args);
            return {
              rows: r.rows,
              rowCount: r.rows.length || r.affectedRows || 0,
            };
          },
        }),
      ),
  };
});
vi.mock("@/lib/server/chain", () => ({
  GENESIS: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  connection: () => store.connection,
  queue: async (signature: string, payload: unknown) => {
    const r = await store.db.query(
      "INSERT INTO airtime.webhook_events(signature,payload) VALUES($1,$2) ON CONFLICT(signature) DO NOTHING",
      [signature, JSON.stringify(payload)],
    );
    return !!r.affectedRows;
  },
}));
vi.mock("@/lib/server/uploads", async (original) => {
  const real = (await original()) as any;
  return {
    ...real,
    storage: vi.fn(() => ({
      download: async () => ({
        data: new Blob(["mock private commercial"]),
        error: null,
      }),
      upload: async (path: string, file: File) => {
        store.objects.set(path, new Uint8Array(await file.arrayBuffer()));
        return { error: null };
      },
      remove: async () => ({ error: null }),
      createSignedUrl: async (path: string) => ({
        error: null,
        data: {
          signedUrl:
            "https://storage.example.com/" + path + "?token=test-60-second-url",
        },
      }),
    })),
  };
});
import {
  createChallenge,
  authenticateWallet,
  requireCreator,
  checkWalletSignature,
} from "@/lib/platform/auth";
import {
  verifyCoinAuthority,
  pda,
  associated,
  claimBalances,
  buildClaim,
} from "@/lib/platform/coins";
import {
  campaignInput,
  invoiceAmounts,
  canTransition,
  targetingInput,
  type CreatorIdentity,
} from "@/lib/platform/model";
import {
  saveCampaign,
  ownedCampaign,
  transition,
  quoteCampaign,
  creatorState,
  submitForReview,
} from "@/lib/platform/campaigns";
import {
  preparePayment,
  prepareClaim,
  broadcastSigned,
  verifyPaymentStructure,
  confirmPayment,
  ownedInvoice,
  invoiceMemo,
  MEMO,
} from "@/lib/platform/payments";
import { adminOperation } from "@/lib/platform/operations";
import {
  processPlatformSignature,
  runPlatformSync,
} from "@/lib/platform/worker";
import { validateVideoMetadata, probeVideo } from "@/lib/platform/creative";
import { platformConfig } from "@/lib/platform/config";
import { PUMP, PUMP_AMM, canonicalPool } from "@/lib/server/protocol";
import { WSOL, ZERO } from "@/lib/accounting";
const owner = Keypair.generate(),
  other = Keypair.generate(),
  recipient = Keypair.generate(),
  mint = Keypair.generate().publicKey.toBase58(),
  admin = randomUUID();
let a: CreatorIdentity, b: CreatorIdentity;
const key = (wallet: Keypair) => wallet.publicKey.toBase58();
async function q(sql: string, args?: unknown[]) {
  return store.db.query<any>(sql, args);
}
function account(idl: any, name: string, values: Record<string, any>) {
  function encode(type: any, value: any): Buffer {
    if (type === "pubkey") return new PublicKey(value || ZERO).toBuffer();
    if (type === "bool") return Buffer.from([value ? 1 : 0]);
    if (type === "string") {
      const bytes = Buffer.from(value || ""),
        n = Buffer.alloc(4);
      n.writeUInt32LE(bytes.length);
      return Buffer.concat([n, bytes]);
    }
    if (typeof type === "string" && /^[ui]/.test(type)) {
      const out = Buffer.alloc(Number(type.slice(1)) / 8);
      let n = BigInt(value || 0);
      for (let i = 0; i < out.length; i++) {
        out[i] = Number(n & 255n);
        n >>= 8n;
      }
      return out;
    }
    if (type.vec) {
      const n = Buffer.alloc(4);
      n.writeUInt32LE(value?.length || 0);
      return Buffer.concat([
        n,
        ...(value || []).map((v: any) => encode(type.vec, v)),
      ]);
    }
    if (type.defined) {
      const t = idl.types.find((x: any) => x.name === type.defined.name).type;
      if (t.kind === "enum")
        return Buffer.from([
          t.variants.findIndex((v: any) => v.name === value),
        ]);
      return Buffer.concat(
        t.fields.map((f: any) => encode(f.type, value[f.name])),
      );
    }
    throw Error("Unknown fixture type");
  }
  const tag =
      idl.accounts.find((x: any) => x.name === name) ||
      idl.events.find((x: any) => x.name === name),
    type = idl.types.find((x: any) => x.name === name).type;
  return Buffer.concat([
    Buffer.from(tag.discriminator),
    ...type.fields.map((f: any) => encode(f.type, values[f.name])),
  ]);
}
function rpcFixture(
  options: {
    creator?: string;
    complete?: boolean;
    sharing?: any;
    holder?: boolean;
    quote?: string;
  } = {},
) {
  const creator = options.creator || key(owner),
    curve = pda(PUMP, ["bonding-curve", new PublicKey(mint)]),
    pool = new PublicKey(canonicalPool(mint, WSOL)),
    sharingKey = pda(fees.address, ["sharing-config", new PublicKey(mint)]),
    curveVault = pda(PUMP, ["creator-vault", new PublicKey(creator)]),
    ammVault = pda(PUMP_AMM, ["creator_vault", new PublicKey(creator)]),
    ammATA = associated(ammVault),
    tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const token = Buffer.alloc(165);
  new PublicKey(WSOL).toBuffer().copy(token, 0);
  ammVault.toBuffer().copy(token, 32);
  token.writeBigUInt64LE(20000000n, 64);
  token[108] = 1;
  const byAddress = (pub: PublicKey) => {
    if (pub.toBase58() === mint)
      return { owner: tokenProgram, data: Buffer.alloc(82), lamports: 1000000 };
    if (pub.equals(curve))
      return {
        owner: new PublicKey(PUMP),
        data: account(pump, "BondingCurve", {
          creator,
          complete: options.complete,
          quote_mint: options.quote || ZERO,
          is_holder_reward: options.holder,
        }),
        lamports: 1000000,
      };
    if (pub.equals(pool))
      return {
        owner: new PublicKey(PUMP_AMM),
        data: account(amm, "Pool", {
          coin_creator: creator,
          base_mint: mint,
          quote_mint: WSOL,
          index: 0,
          is_holder_reward: options.holder,
        }),
        lamports: 1000000,
      };
    if (pub.equals(sharingKey) && options.sharing)
      return {
        owner: new PublicKey(fees.address),
        data: Buffer.concat([
          account(fees, "SharingConfig", {
            version: 2,
            status: "Active",
            mint,
            admin: key(owner),
            admin_revoked: false,
            ...options.sharing,
          }),
          Buffer.alloc(100),
        ]),
        lamports: 1000000,
      };
    if (pub.equals(curveVault))
      return {
        owner: SystemProgram.programId,
        data: Buffer.alloc(0),
        lamports: 10000000,
      };
    if (pub.equals(ammATA))
      return { owner: tokenProgram, data: token, lamports: 2000000 };
    return null;
  };
  return {
    rpcEndpoint: "https://mainnet-test.helius-rpc.com",
    getGenesisHash: vi.fn(async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
    getMultipleAccountsInfoAndContext: vi.fn(async (keys: PublicKey[]) => ({
      context: { slot: 123 },
      value: keys.map(byAddress),
    })),
    getAccountInfo: vi.fn(async (pub: PublicKey) => byAddress(pub)),
    getMinimumBalanceForRentExemption: vi.fn(async () => 890880),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 200,
    })),
    getBlockHeight: vi.fn(async () => 100),
    sendRawTransaction: vi.fn(async (bytes: Buffer) =>
      bs58.encode(Transaction.from(bytes).signature!),
    ),
    getSignatureStatuses: vi.fn(async () => ({
      value: [{ confirmationStatus: "finalized", err: null }],
    })),
    getTransaction: vi.fn(async () => null),
    getSignaturesForAddress: vi.fn(async () => []),
    getBalanceAndContext: vi.fn(async () => ({
      context: { slot: 123 },
      value: 5000000000,
    })),
  };
}
async function user(wallet: Keypair) {
  const id = (await q("INSERT INTO platform_users DEFAULT VALUES RETURNING id"))
    .rows[0].id;
  await q("INSERT INTO platform_wallets(wallet,user_id) VALUES($1,$2)", [
    key(wallet),
    id,
  ]);
  return { userId: id, wallet: key(wallet) };
}
async function upload(identity = a) {
  return (
    await q(
      "INSERT INTO campaign_creatives(user_id,object_path,original_name,mime,bytes,metadata,validation_status) VALUES($1,$2,'commercial.mp4','video/mp4',100,'{}','TECHNICALLY_VALID') RETURNING id",
      [identity.userId, randomUUID()],
    )
  ).rows[0].id;
}
async function brief(identity = a) {
  return {
    mint,
    title: "Our first TV campaign",
    coinName: "Example coin",
    ticker: "EXAMPLE",
    pumpUrl: "https://pump.fun/coin/" + mint,
    website: "https://example.com/",
    destinationUrl: "https://example.com/about",
    description: "Our coin and our community are launching a new campaign.",
    objective: "Awareness",
    contactEmail: "creator@example.com",
    websiteVisible: true,
    creativeId: await upload(identity),
    headline: "Our community on the big screen",
    cta: "Learn more",
    disclosure: "Speculative cryptocurrency. No guaranteed returns.",
    qrUrl: "https://example.com/qr",
    targeting: {
      geography: "United States",
      location: "",
      minAge: 21,
      maxAge: 100,
      interests: [],
      devices: [],
    },
    mediaBudgetCents: "5000",
    durationDays: 7,
    proposedStart: new Date(Date.now() + 7 * 86400000)
      .toISOString()
      .slice(0, 10),
    rightsConfirmed: true,
    policyConfirmed: true,
    publicProofConsent: false,
  };
}
async function campaign() {
  const result = await saveCampaign(a, await brief());
  await approveFixture(result.id);
  return result.id;
}
async function approveFixture(id: string) {
  const row = (await q("SELECT * FROM ad_campaigns WHERE id=$1", [id])).rows[0];
  await q(
    "INSERT INTO vibe_creatives(campaign_id,user_id,creative_id,name,external_id,approval_status) VALUES($1,$2,$3,'Fixture creative',$4,'AUTHORIZED')",
    [id, row.user_id, row.brief.creativeId, randomUUID()],
  );
  await q(
    "UPDATE ad_campaigns SET status='APPROVED_AWAITING_PAYMENT' WHERE id=$1",
    [id],
  );
}
function paymentTx(
  i: any,
  opts: {
    from?: Keypair;
    to?: string;
    amount?: bigint;
    memo?: string;
    blockTime?: number;
    extra?: boolean;
  } = {},
): VersionedTransactionResponse {
  const from = opts.from || owner,
    tx = new Transaction({
      feePayer: from.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: new PublicKey(opts.to || i.recipient_wallet),
      lamports: opts.amount ?? BigInt(i.required_lamports),
    }),
  );
  tx.add({
    programId: MEMO,
    keys: [],
    data: Buffer.from(opts.memo || invoiceMemo(i.payment_reference || i.id)),
  });
  if (opts.extra)
    tx.add(
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1n,
      }),
    );
  tx.sign(from);
  const msg = tx.compileMessage(),
    index = msg.accountKeys.findIndex(
      (k) => k.toBase58() === (opts.to || i.recipient_wallet),
    ),
    pre = msg.accountKeys.map(() => 0),
    post = [...pre];
  post[index] = Number(opts.amount ?? BigInt(i.required_lamports));
  return {
    slot: 123,
    blockTime: opts.blockTime || Math.floor(Date.now() / 1000),
    transaction: { message: msg, signatures: [bs58.encode(tx.signature!)] },
    meta: {
      err: null,
      fee: 5000,
      preBalances: pre,
      postBalances: post,
      logMessages: [],
      innerInstructions: [],
      loadedAddresses: { writable: [], readonly: [] },
    },
  };
}
async function paidCampaign() {
  const id = await campaign(),
    invoice = (await quoteCampaign(a, id)).invoice,
    tx = paymentTx(invoice);
  store.connection.getTransaction.mockResolvedValue(tx);
  await confirmPayment(invoice.id, tx.transaction.signatures[0]);
  return { id, invoice, tx };
}
async function session(identity = a) {
  const token = "test-session-" + randomUUID();
  const { hash } = await import("@/lib/server/http");
  await q(
    "INSERT INTO creator_sessions(token_hash,user_id,wallet,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(token), identity.userId, identity.wallet],
  );
  return token;
}
function request(
  path: string,
  token?: string,
  payload?: unknown,
  origin = "http://localhost:3200",
) {
  return new NextRequest("http://localhost:3200" + path, {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      origin,
      ...(token ? { cookie: "airtime_creator=" + token } : {}),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}
beforeAll(async () => {
  store.db = new PGlite();
  await store.db.exec("BEGIN");
  await store.db.exec(
    await readFile("supabase/migrations/001_airtime.sql", "utf8"),
  );
  await store.db.exec(
    "SET search_path=airtime,public; INSERT INTO campaigns(slug,title,target_usd_cents) VALUES('retained-legacy','Retained legacy record',50000)",
  );
  await store.db.exec(
    await readFile("supabase/migrations/002_creator_platform.sql", "utf8"),
  );
  await store.db.exec(
    await readFile("supabase/migrations/003_vibe_automation.sql", "utf8"),
  );
  await store.db.exec(
    await readFile("supabase/migrations/004_review_then_payment.sql", "utf8"),
  );
  await store.db.exec(
    await readFile(
      "supabase/migrations/005_private_vibe_advertiser.sql",
      "utf8",
    ),
  );
  await store.db.exec("COMMIT; SET search_path=airtime,public");
});
afterAll(async () => store.db.close());
beforeEach(async () => {
  vi.restoreAllMocks();
  store.objects.clear();
  await store.db.exec(
    "TRUNCATE platform_users,wallet_auth_challenges,platform_coins,operations_audit,sol_price_snapshots,webhook_events,rate_limits,admin_users CASCADE",
  );
  await q("UPDATE settings SET config=$1", [JSON.stringify({})]);
  await q(
    "UPDATE sync_state SET cursors='{}',error=NULL,alert=NULL,last_success_at=NULL",
  );
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_ORIGIN: "http://localhost:3200",
    MEDIA_BUDGET_CENTS: "5000",
    PLATFORM_FEE_CENTS: "1000",
    TOTAL_CAMPAIGN_PRICE_CENTS: "6000",
    SOL_QUOTE_TTL_SECONDS: "300",
    VIBE_LIVE_MODE: "true",
    VIBE_ACCOUNT_ID: "123",
    VIBE_CLIENT_ID: "fixture",
    VIBE_CLIENT_SECRET: "fixture",
    MIN_CAMPAIGN_USD: "500",
    PLATFORM_FEE_BPS: "1000",
    PAYMENT_EXPIRATION_MINUTES: "15",
    CAMPAIGN_PAYMENT_WALLET: key(recipient),
    DEMO_MODE: "false",
    ADMIN_EMAIL: "admin@example.com",
    AUTH_SECRET: "platform-auth-secret".padEnd(40, "a"),
    TOTP_ENCRYPTION_KEY: "platform-totp-secret".padEnd(40, "b"),
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "test-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-storage-key",
    HELIUS_WEBHOOK_SECRET: "test-webhook-secret",
    WORKER_SECRET: "test-worker-secret",
  });
  delete process.env.DATABASE_URL;
  store.connection = rpcFixture();
  a = await user(owner);
  b = await user(other);
  await q("INSERT INTO admin_users(id,email) VALUES($1,$2)", [
    admin,
    "admin@example.com",
  ]);
  await q(
    "INSERT INTO sol_price_snapshots(price_usd_micros,source) VALUES(100000000,'Test price')",
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const params = init?.body ? JSON.parse(String(init.body)) : {};
    return new Response(
      JSON.stringify(
        params.method === "getAsset"
          ? {
              result: {
                content: {
                  metadata: { name: "Example Coin", symbol: "EXAMPLE" },
                },
              },
            }
          : params.method === "searchAssets"
            ? { result: { items: [{ id: mint }] } }
            : { solana: { usd: 100 } },
      ),
      { status: 200 },
    );
  });
});
describe("Forward-only platform migration", () => {
  it("retains legacy rows and adds 19 RLS-protected tenant tables", async () => {
    expect(
      (await q("SELECT title FROM campaigns WHERE slug='retained-legacy'"))
        .rows[0].title,
    ).toBe("Retained legacy record");
    const tables = (
      await q(
        "SELECT relname,relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='airtime' AND relkind='r'",
      )
    ).rows;
    expect(tables).toHaveLength(46);
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
  });
});
describe("Wallet authentication", () => {
  it("authenticates an exact gasless wallet signature and creates a scoped session", async () => {
    const challenge = await createChallenge(a.wallet),
      signature = bs58.encode(
        nacl.sign.detached(Buffer.from(challenge.message), owner.secretKey),
      );
    const auth = await authenticateWallet(challenge.id, a.wallet, signature);
    expect(auth.userId).toBe(a.userId);
    expect(challenge.message).toContain("Purpose:");
    expect(challenge.message).toContain("Domain: http://localhost:3200");
    expect(
      (await requireCreator(request("/api/creator/state", auth.token))).wallet,
    ).toBe(a.wallet);
  });
  it("rejects invalid signatures and cross-wallet signatures", async () => {
    const c = await createChallenge(a.wallet);
    expect(
      checkWalletSignature(
        a.wallet,
        c.message,
        bs58.encode(
          nacl.sign.detached(Buffer.from(c.message), other.secretKey),
        ),
      ),
    ).toBe(false);
    await expect(
      authenticateWallet(c.id, a.wallet, bs58.encode(new Uint8Array(64))),
    ).rejects.toThrow();
  });
  it("rejects nonce replay", async () => {
    const c = await createChallenge(a.wallet),
      s = bs58.encode(
        nacl.sign.detached(Buffer.from(c.message), owner.secretKey),
      );
    await authenticateWallet(c.id, a.wallet, s);
    await expect(authenticateWallet(c.id, a.wallet, s)).rejects.toThrow(
      "already used",
    );
  });
  it("rejects expired challenges and expired sessions", async () => {
    const c = await createChallenge(a.wallet);
    await q(
      "UPDATE wallet_auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
      [c.id],
    );
    await expect(
      authenticateWallet(
        c.id,
        a.wallet,
        bs58.encode(
          nacl.sign.detached(Buffer.from(c.message), owner.secretKey),
        ),
      ),
    ).rejects.toThrow("expired");
    const token = await session();
    await q("UPDATE creator_sessions SET expires_at=now()-interval '1 second'");
    await expect(
      requireCreator(request("/api/creator/state", token)),
    ).rejects.toThrow("expired");
  });
  it("sets HTTP-only cookies through the challenge/authentication routes", async () => {
    const challenge = await import("@/app/api/creator/challenge/route"),
      authenticate = await import("@/app/api/creator/authenticate/route");
    const c = await (
      await challenge.POST(
        request("/api/creator/challenge", undefined, { wallet: a.wallet }),
      )
    ).json();
    const r = await authenticate.POST(
      request("/api/creator/authenticate", undefined, {
        id: c.id,
        wallet: a.wallet,
        signature: bs58.encode(
          nacl.sign.detached(Buffer.from(c.message), owner.secretKey),
        ),
      }),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(r.headers.get("set-cookie")).toMatch(/SameSite=strict/i);
  });
  it("rejects cross-origin authentication", async () => {
    const route = await import("@/app/api/creator/challenge/route");
    expect(
      (
        await route.POST(
          request(
            "/api/creator/challenge",
            undefined,
            { wallet: a.wallet },
            "https://attacker.example",
          ),
        )
      ).status,
    ).toBe(403);
  });
});
describe("Official Pump coin authority and safe claims", () => {
  it("verifies a bonding-curve creator with official account bytes", async () => {
    expect((await verifyCoinAuthority(a.wallet, mint)).role).toBe("CREATOR");
  });
  it("verifies the canonical graduated PumpSwap creator", async () => {
    store.connection = rpcFixture({ complete: true });
    expect((await verifyCoinAuthority(a.wallet, mint)).venue).toBe(
      "Canonical PumpSwap",
    );
  });
  it("rejects unauthorized wallets and unrelated mints", async () => {
    await expect(verifyCoinAuthority(b.wallet, mint)).rejects.toThrow(
      "does not control",
    );
    await expect(verifyCoinAuthority(a.wallet, key(other))).rejects.toThrow(
      "mint",
    );
  });
  it("rejects unsupported quote assets and holder-reward coins", async () => {
    store.connection = rpcFixture({ quote: key(other) });
    await expect(verifyCoinAuthority(a.wallet, mint)).rejects.toThrow(
      "SOL-paired",
    );
    store.connection = rpcFixture({ holder: true });
    await expect(verifyCoinAuthority(a.wallet, mint)).rejects.toThrow(
      "Holder-reward",
    );
  });
  it("verifies current shared recipients and nonrevoked fee administrators", async () => {
    const creator = pda(fees.address, [
      "sharing-config",
      new PublicKey(mint),
    ]).toBase58();
    store.connection = rpcFixture({
      creator,
      sharing: {
        admin: key(other),
        shareholders: [{ address: a.wallet, share_bps: 10000 }],
      },
    });
    expect((await verifyCoinAuthority(a.wallet, mint)).role).toBe(
      "FEE_RECIPIENT",
    );
    expect((await verifyCoinAuthority(b.wallet, mint)).role).toBe("FEE_ADMIN");
    store.connection = rpcFixture({
      creator,
      sharing: {
        admin: key(other),
        admin_revoked: true,
        shareholders: [{ address: a.wallet, share_bps: 10000 }],
      },
    });
    await expect(verifyCoinAuthority(b.wallet, mint)).rejects.toThrow(
      "not a current",
    );
  });
  it("does not mistake DAS creator metadata for coin authority", async () => {
    const route = await import("@/app/api/creator/coins/route"),
      token = await session(b);
    const r = await route.POST(request("/api/creator/coins", token, { mint }));
    expect(r.status).toBe(403);
    expect(
      (await q("SELECT * FROM coin_authorities WHERE user_id=$1", [b.userId]))
        .rows,
    ).toHaveLength(0);
  });
  it("builds official curve claim instructions without an AIRTIME payment", async () => {
    const p = await verifyCoinAuthority(a.wallet, mint),
      b = await buildClaim(p, a.wallet, "CURVE");
    expect(b.tx.instructions).toHaveLength(1);
    expect(b.tx.instructions[0].data).toEqual(
      Buffer.from(
        pump.instructions.find((i) => i.name === "collect_creator_fee_v2")!
          .discriminator,
      ),
    );
    expect(
      b.tx.instructions[0].keys.some((k) =>
        k.pubkey.equals(recipient.publicKey),
      ),
    ).toBe(false);
    expect(b.description).toContain("No payment");
  });
  it("builds a separate official AMM collection/unwrap transaction", async () => {
    const p = await verifyCoinAuthority(a.wallet, mint),
      b = await buildClaim(p, a.wallet, "AMM");
    expect(b.tx.instructions).toHaveLength(3);
    expect(b.tx.instructions[1].programId.toBase58()).toBe(PUMP_AMM);
    expect(b.tx.instructions[1].data).toEqual(
      Buffer.from(
        amm.instructions.find((i) => i.name === "collect_coin_creator_fee")!
          .discriminator,
      ),
    );
  });
  it("builds shared distribution for actual shareholders and rejects admin-only claims", async () => {
    const creator = pda(fees.address, [
      "sharing-config",
      new PublicKey(mint),
    ]).toBase58();
    store.connection = rpcFixture({
      creator,
      sharing: {
        admin: key(other),
        shareholders: [{ address: a.wallet, share_bps: 10000 }],
      },
    });
    const p = await verifyCoinAuthority(a.wallet, mint),
      built = await buildClaim(p, a.wallet, "CURVE");
    expect(built.tx.instructions[0].keys.at(-1)!.pubkey.toBase58()).toBe(
      a.wallet,
    );
    await expect(
      buildClaim(await verifyCoinAuthority(b.wallet, mint), b.wallet, "CURVE"),
    ).rejects.toThrow("no fee-recipient");
  });
  it("verifies wallet-wide vault balances using lamports/rent and WSOL account layout", async () => {
    const p = await verifyCoinAuthority(a.wallet, mint),
      b = await claimBalances(p);
    expect(b.curve).toBe(9109120n);
    expect(b.amm).toBe(20000000n);
  });
});
describe("Multi-tenant campaigns and private records", () => {
  it("scopes campaigns and invoices to their authenticated owner", async () => {
    const id = await campaign(),
      invoice = (await quoteCampaign(a, id)).invoice;
    await expect(ownedCampaign(b, id)).rejects.toThrow("not found");
    await expect(ownedInvoice(b, invoice.id)).rejects.toThrow("not found");
    const otherState = await creatorState(b);
    expect(otherState.campaigns).toHaveLength(0);
    expect(otherState.invoices).toHaveLength(0);
    expect(otherState.uploads).toHaveLength(0);
  });
  it("rejects another creator’s upload", async () => {
    const data = await brief();
    data.creativeId = await upload(b);
    await expect(saveCampaign(a, data)).rejects.toThrow("belonging");
  });
  it("refuses campaign creation without live coin authority", async () => {
    await expect(saveCampaign(b, await brief(b))).rejects.toThrow(
      "does not control",
    );
  });
  it("protects signed creative URLs and receipts from another user", async () => {
    const id = await campaign(),
      i = (await quoteCampaign(a, id)).invoice,
      creative = (
        await q("SELECT id FROM campaign_creatives WHERE campaign_id=$1", [id])
      ).rows[0].id,
      token = await session(b);
    const media = await import("@/app/api/creator/media/route"),
      receipt = await import("@/app/api/creator/receipt/route");
    expect(
      (await media.GET(request("/api/creator/media?id=" + creative, token)))
        .status,
    ).toBe(404);
    expect(
      (await receipt.GET(request("/api/creator/receipt?id=" + i.id, token)))
        .status,
    ).toBe(404);
  });
  it("issues short-lived signed URLs to the actual owner only", async () => {
    const creative = await upload(),
      route = await import("@/app/api/creator/media/route"),
      r = await route.GET(
        request("/api/creator/media?id=" + creative, await session()),
      );
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toContain("test-60-second-url");
    expect(r.headers.get("cache-control")).toContain("private");
  });
  it("requires authentication on all creator mutation/read APIs", async () => {
    for (const name of [
      "coins",
      "campaigns",
      "quote",
      "prepare",
      "broadcast",
      "verify",
      "upload",
    ]) {
      const route = await import("../app/api/creator/" + name + "/route");
      expect(
        (await route.POST(request("/api/creator/" + name, undefined, {})))
          .status,
      ).toBe(401);
    }
    const state = await import("@/app/api/creator/state/route");
    expect((await state.GET(request("/api/creator/state"))).status).toBe(401);
  });
});
describe("Exact invoice/payment accounting", () => {
  it("shows service fee and total, calculates ceil lamports without floats", () => {
    expect(invoiceAmounts(50000n, 1000, 100000000n)).toEqual({
      media: 50000n,
      fee: 5000n,
      total: 55000n,
      lamports: 5500000000n,
    });
    expect(invoiceAmounts(101n, 3333, 123456789n)).toEqual({
      media: 101n,
      fee: 33n,
      total: 134n,
      lamports: 10854001n,
    });
  });
  it("enforces configured minimum and valid fee bounds", async () => {
    const data = await brief();
    data.mediaBudgetCents = "4999";
    await expect(saveCampaign(a, data)).rejects.toThrow("fixed");
    vi.stubEnv("PLATFORM_FEE_CENTS", "10001");
    expect(() => platformConfig()).toThrow();
    vi.unstubAllEnvs();
  });
  it("keeps an invoice immutable and deduplicates active quotes", async () => {
    const id = await campaign(),
      first = (await quoteCampaign(a, id)).invoice,
      again = (await quoteCampaign(a, id)).invoice;
    expect(again.id).toBe(first.id);
    await expect(
      q("UPDATE campaign_invoices SET required_lamports=1 WHERE id=$1", [
        first.id,
      ]),
    ).rejects.toThrow("immutable");
  });
  it("rejects expired quote preparation", async () => {
    const id = await campaign(),
      invoice = (await quoteCampaign(a, id)).invoice;
    vi.spyOn(Date, "now").mockReturnValue(
      new Date(invoice.expires_at).getTime() + 1000,
    );
    await expect(preparePayment(a, invoice.id)).rejects.toThrow("expired");
  });
  it("rejects wrong recipient, insufficient payment, wrong signer and invoice memo", async () => {
    const i = (await quoteCampaign(a, await campaign())).invoice;
    expect(() =>
      verifyPaymentStructure(paymentTx(i, { to: b.wallet }), i, true),
    ).toThrow("recipient");
    expect(() =>
      verifyPaymentStructure(
        paymentTx(i, { amount: BigInt(i.required_lamports) - 1n }),
        i,
        true,
      ),
    ).toThrow("amount");
    expect(() =>
      verifyPaymentStructure(paymentTx(i, { from: other }), i, true),
    ).toThrow("signer");
    expect(() =>
      verifyPaymentStructure(
        paymentTx(i, { memo: "AIRTIME:" + randomUUID() }),
        i,
        true,
      ),
    ).toThrow("reference");
  });
  it("rejects overpayments and unrelated instructions", async () => {
    const i = (await quoteCampaign(a, await campaign())).invoice;
    expect(() =>
      verifyPaymentStructure(
        paymentTx(i, { amount: BigInt(i.required_lamports) + 1n }),
        i,
        true,
      ),
    ).toThrow("amount");
    expect(() =>
      verifyPaymentStructure(paymentTx(i, { extra: true }), i, true),
    ).toThrow("instructions");
  });
  it("rejects failed, unfinalized and outside-window transactions", async () => {
    const i = (await quoteCampaign(a, await campaign())).invoice,
      tx = paymentTx(i);
    expect(() => verifyPaymentStructure(tx, i, false)).toThrow("finalized");
    tx.meta!.err = { InstructionError: [0, "InvalidArgument"] };
    expect(() => verifyPaymentStructure(tx, i, true)).toThrow("successful");
    expect(() =>
      verifyPaymentStructure(
        paymentTx(i, {
          blockTime: Math.floor(new Date(i.expires_at).getTime() / 1000) + 1,
        }),
        i,
        true,
      ),
    ).toThrow("window");
  });
  it("marks paid only after finalized exact payment and never credits duplicates twice", async () => {
    const id = await campaign(),
      i = (await quoteCampaign(a, id)).invoice,
      tx = paymentTx(i),
      sig = tx.transaction.signatures[0];
    store.connection.getTransaction.mockResolvedValue(tx);
    store.connection.getSignatureStatuses.mockResolvedValueOnce({
      value: [{ confirmationStatus: "confirmed", err: null }],
    });
    await expect(confirmPayment(i.id, sig)).rejects.toThrow("finalized");
    expect((await ownedCampaign(a, id)).status).toBe("QUOTE_ACTIVE");
    await confirmPayment(i.id, sig);
    expect((await confirmPayment(i.id, sig)).duplicate).toBe(true);
    expect((await q("SELECT * FROM campaign_payments")).rows).toHaveLength(1);
    expect((await ownedCampaign(a, id)).status).toBe("PAID");
  });
  it("rejects a transaction reused for a second invoice", async () => {
    const first = await paidCampaign(),
      second = (await quoteCampaign(a, await campaign())).invoice;
    await expect(
      confirmPayment(second.id, first.tx.transaction.signatures[0]),
    ).rejects.toThrow(/reference|invoice window/);
    await expect(
      q(
        "INSERT INTO campaign_payments(invoice_id,signature,creator_wallet,recipient_wallet,amount_lamports,status,slot,block_time,evidence) VALUES($1,$2,$3,$4,$5,'FINALIZED',123,now(),'{}')",
        [
          second.id,
          first.tx.transaction.signatures[0],
          a.wallet,
          key(recipient),
          second.required_lamports,
        ],
      ),
    ).rejects.toThrow();
  });
  it("stores signed payment before RPC and never broadcasts twice after ambiguous failure", async () => {
    const id = await campaign(),
      i = (await quoteCampaign(a, id)).invoice,
      prepared = await preparePayment(a, i.id),
      tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    tx.sign(owner);
    store.connection.sendRawTransaction.mockRejectedValue(Error("RPC timeout"));
    const first = await broadcastSigned(
      a,
      i.id,
      "PAYMENT",
      tx.serialize().toString("base64"),
    );
    expect(first.status).toBe("CONFIRMATION_UNKNOWN");
    expect((await ownedCampaign(a, id)).status).toBe("PAYMENT_VERIFYING");
    await expect(
      broadcastSigned(a, i.id, "PAYMENT", tx.serialize().toString("base64")),
    ).rejects.toThrow("already submitted");
    expect(store.connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("rejects a wallet-signed transaction changed after review", async () => {
    const i = (await quoteCampaign(a, await campaign())).invoice,
      p = await preparePayment(a, i.id),
      tx = Transaction.from(Buffer.from(p.transaction, "base64"));
    tx.instructions[0] = SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: other.publicKey,
      lamports: 1n,
    });
    tx.sign(owner);
    await expect(
      broadcastSigned(a, i.id, "PAYMENT", tx.serialize().toString("base64")),
    ).rejects.toThrow("differ");
    expect(store.connection.sendRawTransaction).not.toHaveBeenCalled();
  });
});
describe("Campaign review, admin security and refunds", () => {
  it("requires review before payment and prevents payment-first transitions", async () => {
    const saved = await saveCampaign(a, await brief());
    await expect(quoteCampaign(a, saved.id)).rejects.toThrow("approval");
    await submitForReview(a, saved.id);
    expect((await ownedCampaign(a, saved.id)).status).toBe(
      "SUBMITTED_FOR_REVIEW",
    );
    expect(canTransition("DRAFT", "PAID")).toBe(false);
  });
  it("cannot fabricate Vibe approval with an administrator decision", async () => {
    const id = await campaign();
    await expect(
      adminOperation(admin, { action: "REVIEW", id, status: "APPROVED" }),
    ).rejects.toThrow("Vibe");
  });
  it("rejects anonymous admin actions and password-only MFA level", async () => {
    const route = await import("@/app/api/admin/operations/route");
    expect(
      (
        await route.POST(
          request("/api/admin/operations", undefined, {
            action: "MAINTENANCE",
            enabled: true,
          }),
        )
      ).status,
    ).toBe(401);
    expect((await route.GET(request("/api/admin/operations"))).status).toBe(
      401,
    );
    const { adminIdentity } = await import("@/lib/server/auth");
    expect(() => adminIdentity("admin@example.com", "aal1")).toThrow(
      "two-factor",
    );
  });
  it("requires creator consent before public delivery reporting", async () => {
    const { id } = await paidCampaign();
    await q("UPDATE ad_campaigns SET status='LIVE' WHERE id=$1", [id]);
    await expect(
      adminOperation(admin, {
        action: "REPORT",
        id,
        publicProof: true,
        impressions: "100",
      }),
    ).rejects.toThrow("Vibe");
  });
  it("queues an exact full unspent-order refund, verifies a signed finalized refund, and prevents duplicate refunds", async () => {
    const { id, invoice } = await paidCampaign();
    await q("UPDATE ad_campaigns SET status='ACTIVATION_FAILED' WHERE id=$1", [
      id,
    ]);
    await adminOperation(admin, {
      action: "REFUND_REQUEST",
      id,
      note: "Full unspent-order refund",
    });
    const refund = (
      await q("SELECT * FROM campaign_refunds WHERE campaign_id=$1", [id])
    ).rows[0];
    expect(refund.amount_lamports).toBe(invoice.required_lamports);
    expect((await ownedCampaign(a, id)).status).toBe("REFUND_REVIEW");
    const tx = paymentTx(
      {
        id: "REFUND:" + refund.id,
        recipient_wallet: a.wallet,
        required_lamports: refund.amount_lamports,
      },
      { from: recipient },
    );
    store.connection.getTransaction.mockResolvedValue(tx);
    await adminOperation(admin, {
      action: "REFUND_VERIFY",
      id,
      signature: tx.transaction.signatures[0],
    });
    expect((await ownedCampaign(a, id)).status).toBe("REFUNDED");
    expect((await ownedInvoice(a, invoice.id)).refund_status).toBe("VERIFIED");
    await expect(
      adminOperation(admin, {
        action: "REFUND_VERIFY",
        id,
        signature: tx.transaction.signatures[0],
      }),
    ).rejects.toThrow("pending refund");
  });
  it("cannot refund more than the actual payment at database level", async () => {
    const { id, invoice } = await paidCampaign();
    await expect(
      q(
        "INSERT INTO campaign_refunds(invoice_id,campaign_id,amount_lamports,reason) VALUES($1,$2,$3,$4)",
        [
          invoice.id,
          id,
          (BigInt(invoice.required_lamports) + 1n).toString(),
          "too much",
        ],
      ),
    ).rejects.toThrow("exceeds");
  });
  it("keeps audit and finalized payment records append-only", async () => {
    await paidCampaign();
    await expect(
      q("UPDATE campaign_payments SET amount_lamports=1"),
    ).rejects.toThrow("immutable");
    await expect(q("DELETE FROM operations_audit")).rejects.toThrow(
      "immutable",
    );
  });
});
describe("Creative, targeting and payment worker", () => {
  const metadata = {
    format: { duration: "30" },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        pix_fmt: "yuv420p",
        bit_rate: "3000000",
        avg_frame_rate: "30/1",
        r_frame_rate: "30/1",
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
      },
    ],
  };
  it("validates supported commercial duration, dimensions, encoding and audio", () => {
    expect(validateVideoMetadata(metadata).duration).toBe(30);
    expect(() =>
      validateVideoMetadata({ ...metadata, format: { duration: "91" } }),
    ).toThrow("5 and 90");
    expect(() =>
      validateVideoMetadata({ ...metadata, streams: [metadata.streams[0]] }),
    ).toThrow("audio");
    expect(() =>
      validateVideoMetadata({
        ...metadata,
        streams: [
          { ...metadata.streams[0], width: 720, height: 1280 },
          metadata.streams[1],
        ],
      }),
    ).toThrow("16:9");
  });
  it("uses a real server media parser instead of trusting client metadata", async () => {
    const b = Buffer.alloc(40);
    b.write("ftyp", 4);
    await expect(probeVideo(b)).rejects.toThrow();
  });
  it("allows adults only, rejects invalid ZIP codes and requires HTTPS destinations", async () => {
    const data = await brief();
    expect(() =>
      campaignInput.parse({ ...data, destinationUrl: "javascript:alert(1)" }),
    ).toThrow();
    expect(() =>
      targetingInput.parse({ ...data.targeting, minAge: 17 }),
    ).toThrow();
    expect(() =>
      targetingInput.parse({
        ...data.targeting,
        geography: "ZIP codes",
        location: "abc",
      }),
    ).toThrow();
  });
  it("processes webhook retries idempotently using finalized RPC proof", async () => {
    const id = await campaign(),
      i = (await quoteCampaign(a, id)).invoice,
      tx = paymentTx(i),
      sig = tx.transaction.signatures[0];
    store.connection.getTransaction.mockResolvedValue(tx);
    await q("INSERT INTO webhook_events(signature,payload) VALUES($1,$2)", [
      sig,
      JSON.stringify({ forgedAmount: 1 }),
    ]);
    await processPlatformSignature(sig);
    await processPlatformSignature(sig);
    expect((await q("SELECT * FROM campaign_payments")).rows).toHaveLength(1);
    expect(
      (await q("SELECT status FROM webhook_events WHERE signature=$1", [sig]))
        .rows[0].status,
    ).toBe("CONFIRMED");
    expect(store.connection.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("worker retries verification only after temporary RPC failures", async () => {
    const i = (await quoteCampaign(a, await campaign())).invoice,
      tx = paymentTx(i),
      sig = tx.transaction.signatures[0];
    await q("INSERT INTO webhook_events(signature,payload) VALUES($1,$2)", [
      sig,
      "{}",
    ]);
    store.connection.getTransaction
      .mockRejectedValueOnce(Error("temporary RPC timeout"))
      .mockResolvedValue(tx);
    expect((await runPlatformSync()).errors).toBe(1);
    expect((await runPlatformSync()).errors).toBe(0);
    await runPlatformSync();
    expect((await q("SELECT * FROM campaign_payments")).rows).toHaveLength(1);
    expect(store.connection.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("honors emergency maintenance and protects worker authentication", async () => {
    await q("UPDATE settings SET config='{\"maintenance\":true}'");
    expect(await runPlatformSync()).toEqual({ paused: true });
    expect(store.connection.getGenesisHash).not.toHaveBeenCalled();
    const route = await import("@/app/api/worker/route");
    expect(route.maxDuration).toBe(30);
    expect(route).not.toHaveProperty("GET");
    const makeWorkerRequest = (authorization: string) =>
      new NextRequest("http://localhost:3200/api/worker", {
        method: "POST",
        headers: { authorization },
      });
    expect((await route.POST(makeWorkerRequest("Bearer wrong"))).status).toBe(
      401,
    );
    const authorized = await route.POST(
      makeWorkerRequest("Bearer test-worker-secret"),
    );
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({
      payments: { paused: true },
      vibe: { paused: true },
    });
  });
  it("does not accept an unauthenticated or malformed webhook", async () => {
    const route = await import("@/app/api/webhooks/helius/route");
    expect(
      (await route.POST(request("/api/webhooks/helius", undefined, []))).status,
    ).toBe(401);
    expect(
      (
        await route.POST(
          new NextRequest("http://localhost:3200/api/webhooks/helius", {
            method: "POST",
            headers: { authorization: process.env.HELIUS_WEBHOOK_SECRET! },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(400);
  });
});

describe("Complete wallet-to-reviewed-campaign journey (isolated RPC/storage)", () => {
  it("authenticates, verifies a coin, validates/upload creative, quotes, separately signs funding, verifies finality and submits", async () => {
    const challenge = await import("@/app/api/creator/challenge/route"),
      auth = await import("@/app/api/creator/authenticate/route"),
      coins = await import("@/app/api/creator/coins/route"),
      uploadRoute = await import("@/app/api/creator/upload/route"),
      orders = await import("@/app/api/creator/campaigns/route"),
      quote = await import("@/app/api/creator/quote/route"),
      prepare = await import("@/app/api/creator/prepare/route"),
      broadcast = await import("@/app/api/creator/broadcast/route"),
      verify = await import("@/app/api/creator/verify/route");
    const c = await (
      await challenge.POST(
        request("/api/creator/challenge", undefined, { wallet: a.wallet }),
      )
    ).json();
    const authResponse = await auth.POST(
      request("/api/creator/authenticate", undefined, {
        id: c.id,
        wallet: a.wallet,
        signature: bs58.encode(
          nacl.sign.detached(Buffer.from(c.message), owner.secretKey),
        ),
      }),
    );
    expect(authResponse.status).toBe(200);
    const token = authResponse.cookies.get("airtime_creator")!.value;
    expect(
      (await coins.POST(request("/api/creator/coins", token, { mint }))).status,
    ).toBe(200);
    const bytes = await readFile("tests/fixtures/technical-test-15s.mp4"),
      form = new FormData();
    form.set(
      "file",
      new File([bytes], "technical-test-15s.mp4", { type: "video/mp4" }),
    );
    const uploaded = await uploadRoute.POST(
      new NextRequest("http://localhost:3200/api/creator/upload", {
        method: "POST",
        headers: {
          origin: "http://localhost:3200",
          cookie: "airtime_creator=" + token,
        },
        body: form,
      }),
    );
    expect(uploaded.status).toBe(200);
    const creative = await uploaded.json();
    expect(creative.metadata.width).toBe(1920);
    expect(creative.metadata.duration).toBeCloseTo(15, 0);
    const input = await brief();
    input.creativeId = creative.id;
    const saved = await orders.POST(
      request("/api/creator/campaigns", token, input),
    );
    expect(saved.status).toBe(200);
    const id = (await saved.json()).id;
    await orders.POST(
      request("/api/creator/campaigns", token, { action: "submit", id }),
    );
    await approveFixture(id);
    const invoice = (
      await (
        await quote.POST(request("/api/creator/quote", token, { id }))
      ).json()
    ).invoice;
    const reviewed = await (
      await prepare.POST(
        request("/api/creator/prepare", token, {
          kind: "PAYMENT",
          id: invoice.id,
        }),
      )
    ).json();
    const signed = Transaction.from(
      Buffer.from(reviewed.transaction, "base64"),
    );
    signed.sign(owner);
    const sent = await broadcast.POST(
      request("/api/creator/broadcast", token, {
        kind: "PAYMENT",
        id: invoice.id,
        transaction: signed.serialize().toString("base64"),
      }),
    );
    expect(sent.status).toBe(200);
    const signature = (await sent.json()).signature;
    const actual = paymentTx(invoice);
    actual.transaction.message = signed.compileMessage();
    actual.transaction.signatures = [signature];
    const index = actual.transaction.message
      .getAccountKeys()
      .staticAccountKeys.findIndex(
        (k) => k.toBase58() === invoice.recipient_wallet,
      );
    actual.meta!.preBalances = Array.from(
      { length: actual.transaction.message.getAccountKeys().length },
      () => 0,
    );
    actual.meta!.postBalances = [...actual.meta!.preBalances];
    actual.meta!.postBalances[index] = Number(invoice.required_lamports);
    store.connection.getTransaction.mockResolvedValue(actual);
    expect(
      (
        await verify.POST(
          request("/api/creator/verify", token, {
            kind: "PAYMENT",
            id: invoice.id,
            signature,
          }),
        )
      ).status,
    ).toBe(200);
    expect((await ownedCampaign(a, id)).status).toBe("PAID");
    expect(store.connection.sendRawTransaction).toHaveBeenCalledTimes(1); // mocked only, no network transaction.
  });
  it("keeps a signed creator-fee claim separate from every invoice/payment", async () => {
    await saveCampaign(a, await brief());
    const prepared = await prepareClaim(a, mint, "CURVE"),
      tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    tx.sign(owner);
    const sent = await broadcastSigned(
      a,
      prepared.id,
      "CLAIM",
      tx.serialize().toString("base64"),
    );
    expect(sent.status).toBe("BROADCAST");
    expect((await q("SELECT * FROM campaign_payments")).rows).toHaveLength(0);
    expect((await q("SELECT * FROM campaign_invoices")).rows).toHaveLength(0);
  });
  it("does not issue quotes when live pricing is unavailable", async () => {
    const id = await campaign();
    await q("DELETE FROM sol_price_snapshots");
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(quoteCampaign(a, id)).rejects.toThrow(
      "pricing is unavailable",
    );
    expect((await q("SELECT * FROM campaign_invoices")).rows).toHaveLength(0);
  });
  it("validates a real supported video file with server ffprobe", async () => {
    const result = await probeVideo(
      await readFile("tests/fixtures/technical-test-15s.mp4"),
    );
    expect(result.audio).toBe(true);
    expect(result.width).toBe(1920);
    expect(result.duration).toBeCloseTo(15, 0);
  });
  it("keeps paid order budget immutable during changes requested", async () => {
    const { id } = await paidCampaign();
    const previous = await ownedCampaign(a, id);
    await expect(
      saveCampaign(a, { ...previous.brief, id, mediaBudgetCents: "70000" }),
    ).rejects.toThrow("fixed");
  });
  it("operates only on mainnet and prevents admin-created fake completed records", async () => {
    store.connection.getGenesisHash.mockResolvedValue("devnet");
    await expect(verifyCoinAuthority(a.wallet, mint)).rejects.toThrow(
      "Mainnet",
    );
    expect(canTransition("DRAFT", "COMPLETED")).toBe(false);
  });
});

describe("Expired quote recovery without retransmitting payments", () => {
  it("cancels an unpaid expired quote only after checking mainnet history and blockhash", async () => {
    const { releaseExpiredQuote } = await import("@/lib/platform/payments");
    const id = await campaign(),
      i = (await quoteCampaign(a, id)).invoice;
    vi.spyOn(Date, "now").mockReturnValue(
      new Date(i.expires_at).getTime() + 60000,
    );
    expect((await releaseExpiredQuote(a, id)).status).toBe("CANCELLED");
    expect(store.connection.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("blocks quote recovery while a prepared blockhash can still land", async () => {
    const { releaseExpiredQuote } = await import("@/lib/platform/payments");
    const id = await campaign(),
      i = (await quoteCampaign(a, id)).invoice;
    await preparePayment(a, i.id);
    vi.spyOn(Date, "now").mockReturnValue(
      new Date(i.expires_at).getTime() + 60000,
    );
    await expect(releaseExpiredQuote(a, id)).rejects.toThrow("can still land");
  });
  it("does not release a quote when finalized payment history is incomplete", async () => {
    const { releaseExpiredQuote } = await import("@/lib/platform/payments");
    const id = await campaign(),
      i = (await quoteCampaign(a, id)).invoice;
    vi.spyOn(Date, "now").mockReturnValue(
      new Date(i.expires_at).getTime() + 60000,
    );
    store.connection.getSignaturesForAddress.mockResolvedValue(
      Array.from({ length: 10 }, () => ({
        signature: bs58.encode(new Uint8Array(64).fill(3)),
        blockTime: Math.floor(new Date(i.created_at).getTime() / 1000),
        err: null,
      })),
    );
    await expect(releaseExpiredQuote(a, id)).rejects.toThrow(
      "manual reconciliation",
    );
  });
  it("settles an already-landed original payment instead of opening another charge", async () => {
    const { releaseExpiredQuote } = await import("@/lib/platform/payments");
    const id = await campaign(),
      i = (await quoteCampaign(a, id)).invoice,
      tx = paymentTx(i);
    store.connection.getTransaction.mockResolvedValue(tx);
    store.connection.getSignaturesForAddress.mockResolvedValue([
      {
        signature: tx.transaction.signatures[0],
        blockTime: tx.blockTime,
        err: null,
      },
    ]);
    vi.spyOn(Date, "now").mockReturnValue(
      new Date(i.expires_at).getTime() + 60000,
    );
    expect((await releaseExpiredQuote(a, id)).status).toBe("PAID");
    expect((await q("SELECT * FROM campaign_payments")).rows).toHaveLength(1);
    expect(store.connection.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("Finalized claim evidence and production configuration", () => {
  it("stores actual official claim bytes and RPC evidence, not an estimated creator fee", async () => {
    await saveCampaign(a, await brief());
    const prepared = await prepareClaim(a, mint, "CURVE"),
      tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    tx.sign(owner);
    const sent = await broadcastSigned(
      a,
      prepared.id,
      "CLAIM",
      tx.serialize().toString("base64"),
    );
    const event = account(pump, "CollectCreatorFeeEvent", {
        creator: a.wallet,
        creator_fee: 3000000n,
        quote_mint: WSOL,
        timestamp: Math.floor(Date.now() / 1000),
      }),
      raw = paymentTx({
        id: randomUUID(),
        required_lamports: "1",
        recipient_wallet: key(recipient),
      });
    raw.transaction.message = tx.compileMessage();
    raw.transaction.signatures = [sent.signature];
    raw.meta!.logMessages = [
      `Program ${PUMP} invoke [1]`,
      "Program data: " + event.toString("base64"),
      `Program ${PUMP} success`,
    ];
    store.connection.getTransaction.mockResolvedValue(raw);
    const { confirmClaim } = await import("@/lib/platform/payments");
    expect((await confirmClaim(a, prepared.id)).amountLamports).toBe("3000000");
    await confirmClaim(a, prepared.id);
    const claim = (
      await q("SELECT * FROM fee_claim_requests WHERE id=$1", [prepared.id])
    ).rows[0];
    expect(claim.evidence.events[0].evidence.bytes).toBe(
      event.toString("base64"),
    );
    expect(claim.evidence.transaction.slot).toBe(123);
    expect(
      (await q("SELECT * FROM operations_audit WHERE action='CLAIM_FINALIZED'"))
        .rows,
    ).toHaveLength(1);
    expect((await q("SELECT * FROM campaign_payments")).rows).toHaveLength(0);
  });
  it("records unavailable exact fee evidence honestly even when claim finality is proven", async () => {
    await saveCampaign(a, await brief());
    const prepared = await prepareClaim(a, mint, "CURVE"),
      tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    tx.sign(owner);
    const sent = await broadcastSigned(
        a,
        prepared.id,
        "CLAIM",
        tx.serialize().toString("base64"),
      ),
      raw = paymentTx({
        id: randomUUID(),
        required_lamports: "1",
        recipient_wallet: key(recipient),
      });
    raw.transaction.message = tx.compileMessage();
    raw.transaction.signatures = [sent.signature];
    store.connection.getTransaction.mockResolvedValue(raw);
    const { confirmClaim } = await import("@/lib/platform/payments");
    expect((await confirmClaim(a, prepared.id)).amountLamports).toBeNull();
    expect(
      (await q("SELECT exact_claim_lamports FROM fee_claim_requests")).rows[0]
        .exact_claim_lamports,
    ).toBeNull();
  });
  it("rejects off-curve campaign-payment addresses and oversized unverifiable quotes", () => {
    vi.stubEnv(
      "CAMPAIGN_PAYMENT_WALLET",
      pda(PUMP, ["test-only-pda"]).toBase58(),
    );
    expect(() => platformConfig()).toThrow("signing wallet");
    vi.unstubAllEnvs();
    expect(() => invoiceAmounts(1000000000000n, 1000, 1n)).toThrow("too large");
  });
});

describe("Automated Vibe campaign and financial safeguards", () => {
  it("runs draft review, finalized payment, idempotent activation and scoped reporting without network access", async () => {
    const { VibeClient } = await import("@/lib/vibe/client"),
      { syncCampaign } = await import("@/lib/vibe/workflow");
    const advertiserId = randomUUID(),
      creativeId = randomUUID(),
      campaignId = randomUUID(),
      strategyId = randomUUID(),
      reportId = randomUUID();
    let advertiser: any = null,
      creative: any = null,
      campaignRemote: any = null,
      strategy: any = null,
      creates = 0,
      publishes = 0,
      activates = 0,
      reportedSpend = "0.125",
      reviewStatus = "PENDING_REVIEW",
      failProvision = false;
    const transport = vi.fn(async (input: any, init: any = {}) => {
      const path = new URL(String(input)).pathname,
        body =
          init.body && typeof init.body === "string"
            ? JSON.parse(init.body)
            : {};
      const send = (v: any) => new Response(JSON.stringify(v), { status: 200 });
      if (path === "/oauth2/token")
        return send({
          access_token: "mock-response-only-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      if (path === "/advertisers")
        return send({
          total: advertiser ? 1 : 0,
          data: [
            {
              id: advertiserId,
              name: "AIRTIME",
              url: "https://airtime.example",
              industry: "FINANCIAL_SERVICES",
            },
          ],
        });
      if (path === "/creatives")
        return send({
          total: creative ? 1 : 0,
          data: creative ? [creative] : [],
        });
      if (path === "/creatives/upload-url")
        return send({
          upload_url: "https://fixture.s3.amazonaws.com/upload",
          fields: { key: "fixture" },
          upload_id: randomUUID(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
        });
      if (path === "/upload") return new Response(null, { status: 204 });
      if (path === "/creatives/video") {
        creative = {
          id: randomUUID(),
          advertiser_id: advertiserId,
          name: body.name,
          approval_status: reviewStatus,
          approval_details: null,
        };
        return send(creative);
      }
      if (path === "/campaigns" && init.method === "POST") {
        creates++;
        campaignRemote = {
          id: campaignId,
          ...body,
          status: "DRAFT",
          state: "INACTIVE",
        };
        if (failProvision) return new Response("", { status: 503 }); // Created remotely, response lost: list recovery must reuse it.
        return send(campaignRemote);
      }
      if (path === "/campaigns")
        return send({
          total: campaignRemote ? 1 : 0,
          data: campaignRemote ? [campaignRemote] : [],
        });
      if (path === "/strategies" && init.method === "POST") {
        creates++;
        expect(body.budget).toBe(50);
        expect(body.budget_type).toBe("GLOBAL");
        expect(body.active).toBe(false);
        strategy = { id: strategyId, ...body, state: "AUTHORIZED" };
        return send(strategy);
      }
      if (path === "/strategies")
        return send({
          total: strategy ? 1 : 0,
          data: strategy ? [strategy] : [],
        });
      if (path === "/strategies/" + strategyId && init.method === "PATCH") {
        strategy = { ...strategy, ...body };
        return send(strategy);
      }
      if (path === "/strategies/" + strategyId) return send(strategy);
      if (path === "/campaigns/" + campaignId) return send(campaignRemote);
      if (path.endsWith("/publish")) {
        publishes++;
        campaignRemote.status = "PUBLISHED";
        campaignRemote.state = "UPCOMING";
        return send(campaignRemote);
      }
      if (path.endsWith("/actions")) {
        if (body.action === "ACTIVATE") {
          activates++;
          strategy.active = true;
        } else strategy.active = false;
        return send(strategy);
      }
      if (path === "/reports") return send({ id: reportId, status: "CREATED" });
      if (path === "/reports/" + reportId)
        return send({
          id: reportId,
          status: "READY",
          download_url: "https://fixture.s3.amazonaws.com/report",
        });
      if (path === "/report")
        return send([
          {
            campaign_id: campaignId,
            advertiser_id: advertiserId,
            spend: reportedSpend,
            impressions: 30,
            completed_views: 20,
            households: 25,
            cpm: "4.16",
            frequency: "1.2",
            view_through_rate: "0.66",
          },
        ]);
      throw Error("Unexpected mock provider route " + path);
    });

    const { storage } = await import("@/lib/server/uploads");
    // Use private storage bytes from an explicitly local synthetic commercial.
    vi.mocked(storage).mockReturnValueOnce({
      download: async () => ({
        data: new Blob(["private mock video"]),
        error: null,
      }),
    } as any);
    delete process.env.VIBE_ACCOUNT_ID;
    const input = await brief(),
      saved = await saveCampaign(a, input);
    await submitForReview(a, saved.id);
    const client = new VibeClient(transport as any, true);
    vi.stubEnv("VIBE_LIVE_MODE", "false");
    await syncCampaign(saved.id, client);
    expect((await ownedCampaign(a, saved.id)).status).toBe("CREATIVE_PENDING");
    await expect(quoteCampaign(a, saved.id)).rejects.toThrow("approval");
    expect((await q("SELECT * FROM campaign_invoices")).rows).toHaveLength(0);
    creative.approval_status = "BLOCKED";
    creative.approval_details = "Please revise the disclosure";
    await syncCampaign(saved.id, client);
    expect((await ownedCampaign(a, saved.id)).status).toBe("CREATIVE_REJECTED");
    await expect(quoteCampaign(a, saved.id)).rejects.toThrow("approval");
    reviewStatus = "AUTHORIZED";
    const replacement = await brief();
    await saveCampaign(a, { ...replacement, id: saved.id });
    await submitForReview(a, saved.id);
    vi.mocked(storage).mockReturnValueOnce({
      download: async () => ({
        data: new Blob(["replacement mock video"]),
        error: null,
      }),
    } as any);
    await syncCampaign(saved.id, client);
    expect((await ownedCampaign(a, saved.id)).status).toBe(
      "APPROVED_AWAITING_PAYMENT",
    );

    expect(creates).toBe(0); // Existing AIRTIME advertiser is read-only; review creates no campaign or strategy.
    expect(publishes).toBe(0);
    expect(activates).toBe(0);
    expect(campaignRemote).toBeNull();
    expect(strategy).toBeNull();
    expect((await q("SELECT * FROM campaign_provisioning")).rows).toHaveLength(
      0,
    );
    const invoice = (await quoteCampaign(a, saved.id)).invoice;
    expect(String(invoice.total_usd_cents)).toBe("6000");
    expect(String(invoice.required_lamports)).toBe("600000000");
    expect(
      new Date(invoice.expires_at).getTime() -
        new Date(invoice.created_at).getTime(),
    ).toBe(300000);
    const tx = paymentTx(invoice);
    store.connection.getTransaction.mockResolvedValue(tx);
    await confirmPayment(invoice.id, tx.transaction.signatures[0]);
    expect((await q("SELECT * FROM campaign_provisioning")).rows).toHaveLength(
      1,
    );
    vi.stubEnv("VIBE_LIVE_MODE", "false");
    await syncCampaign(saved.id, client);
    expect((await ownedCampaign(a, saved.id)).status).toBe("READY_TO_ACTIVATE");
    expect(creates).toBe(0);
    expect(publishes).toBe(0);
    vi.stubEnv("VIBE_LIVE_MODE", "true");
    failProvision = true;
    const { runVibeSync } = await import("@/lib/vibe/workflow");
    await runVibeSync(client);
    expect((await ownedCampaign(a, saved.id)).status).toBe(
      "PROVISIONING_FAILED",
    );
    expect(
      (
        await q("SELECT status FROM campaign_invoices WHERE id=$1", [
          invoice.id,
        ])
      ).rows[0].status,
    ).toBe("PAID");
    expect(publishes).toBe(0);
    failProvision = false;
    vi.stubEnv("VIBE_LIVE_MODE", "true");
    await syncCampaign(saved.id, client);
    await syncCampaign(saved.id, client);
    expect(creates).toBe(2);
    expect(
      (
        await q(
          "SELECT external_id,account_id FROM vibe_advertisers WHERE user_id=$1 AND mint=$2",
          [a.userId, mint],
        )
      ).rows[0],
    ).toMatchObject({ external_id: advertiserId, account_id: null });
    expect(
      (
        await q(
          "SELECT advertiser_external_id FROM vibe_campaigns WHERE campaign_id=$1",
          [saved.id],
        )
      ).rows[0].advertiser_external_id,
    ).toBe(advertiserId);
    expect(publishes).toBe(1);
    expect(activates).toBe(1);
    expect(
      (
        await q("SELECT * FROM vibe_campaign_metrics")
      ).rows[0].spend_microusd.toString(),
    ).toBe("125000");
    expect((await creatorState(b)).campaigns).toHaveLength(0);
    expect((await q("SELECT * FROM campaign_settlements")).rows[0].status).toBe(
      "PENDING_CONVERSION",
    );
    expect(
      (
        await q(
          "SELECT media_cents,service_fee_cents,vibe_spend_microusd FROM campaign_settlements",
        )
      ).rows[0],
    ).toMatchObject({
      media_cents: 5000,
      service_fee_cents: 1000,
      vibe_spend_microusd: 125000,
    });
    reportedSpend = "50";
    await q(
      "UPDATE vibe_campaigns SET breakdown_report_id=NULL,report_id=$2 WHERE campaign_id=$1",
      [saved.id, reportId],
    );
    await syncCampaign(saved.id, client);
    expect(strategy.active).toBe(false);
    expect((await ownedCampaign(a, saved.id)).status).toBe("COMPLETED");
    expect(publishes).toBe(1);
    expect(activates).toBe(1);
  });
  it("refuses a provisioning job or provider campaign without finalized funds", async () => {
    const id = await campaign(),
      invoice = (await quoteCampaign(a, id)).invoice;
    await expect(
      q(
        "INSERT INTO campaign_provisioning(campaign_id,invoice_id) VALUES($1,$2)",
        [id, invoice.id],
      ),
    ).rejects.toThrow("Finalized");
    const advertiser = (
      await q(
        "INSERT INTO vibe_advertisers(user_id,mint,account_id,name,website) VALUES($1,$2,123,'test','https://example.com') RETURNING id",
        [a.userId, mint],
      )
    ).rows[0];
    await expect(
      q(
        "INSERT INTO vibe_campaigns(campaign_id,user_id,advertiser_id,account_id,external_id,name) VALUES($1,$2,$3,123,$4,'test')",
        [id, a.userId, advertiser.id, randomUUID()],
      ),
    ).rejects.toThrow("finalized payment");
  });
  it("does not enqueue a second provisioning job when confirmation is replayed", async () => {
    const id = await campaign(),
      invoice = (await quoteCampaign(a, id)).invoice,
      tx = paymentTx(invoice);
    store.connection.getTransaction.mockResolvedValue(tx);
    await confirmPayment(invoice.id, tx.transaction.signatures[0]);
    await confirmPayment(invoice.id, tx.transaction.signatures[0]);
    expect((await q("SELECT * FROM campaign_provisioning")).rows).toHaveLength(
      1,
    );
  });
  it("never repeats an ambiguous provider create", async () => {
    const { durableCreate } = await import("@/lib/vibe/workflow");
    const id = await campaign();
    const create = vi.fn(async () => {
      throw Error("temporary transport failure");
    });
    await expect(
      durableCreate(
        id,
        "campaign:ambiguous",
        { fixed: true },
        async () => undefined,
        create,
      ),
    ).rejects.toThrow();
    await expect(
      durableCreate(
        id,
        "campaign:ambiguous",
        { fixed: true },
        async () => undefined,
        create,
      ),
    ).rejects.toThrow("second create");
    expect(create).toHaveBeenCalledTimes(1);
    const remote = { id: randomUUID() };
    expect(
      await durableCreate(
        id,
        "campaign:ambiguous",
        { fixed: true },
        async () => remote,
        create,
      ),
    ).toEqual(remote);
  });
  it("enforces fixed media, fee, unique reference and one paid invoice at database level", async () => {
    const id = await campaign(),
      invoice = (await quoteCampaign(a, id)).invoice;
    await expect(
      q("UPDATE campaign_invoices SET payment_reference=$2 WHERE id=$1", [
        invoice.id,
        randomUUID(),
      ]),
    ).rejects.toThrow("immutable");
    await expect(
      q("UPDATE ad_campaigns SET media_budget_cents=5001 WHERE id=$1", [id]),
    ).rejects.toThrow();
    await expect(
      q(
        "INSERT INTO vibe_strategies(campaign_id,name,budget_cents,targeting,starts_at,ends_at) VALUES($1,'invalid',5001,'{}',now(),now()+interval '7 days')",
        [id],
      ),
    ).rejects.toThrow();
  });
  it("approved checkout requires no operator or system-wide approval gates", async () => {
    const id = await campaign();
    await q("UPDATE settings SET config='{}'");
    vi.stubEnv("VIBE_LIVE_MODE", "false");
    expect(String((await quoteCampaign(a, id)).invoice.total_usd_cents)).toBe(
      "6000",
    );
  });
});

it("protects every Vibe operations endpoint with administrator authentication", async () => {
  const route = await import("@/app/api/admin/vibe/route");
  expect((await route.GET(request("/api/admin/vibe"))).status).toBe(401);
  expect(
    (
      await route.POST(
        request("/api/admin/vibe", undefined, {
          action: "ACTIVATION",
          enabled: true,
          confirmation: "ENABLE APPROVED $50 PILOTS",
        }),
      )
    ).status,
  ).toBe(401);
});

it("administrator operations expose verified receipts and reserved media separately from revenue", async () => {
  const id = await campaign(),
    invoice = (await quoteCampaign(a, id)).invoice,
    tx = paymentTx(invoice);
  store.connection.getTransaction.mockResolvedValue(tx);
  await confirmPayment(invoice.id, tx.transaction.signatures[0]);
  const auth = await import("@/lib/server/auth");
  vi.spyOn(auth, "requireAdmin").mockResolvedValue({
    id: admin,
    email: "admin@example.com",
  });
  const route = await import("@/app/api/admin/vibe/route");
  const response = await route.GET(request("/api/admin/vibe"));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.orders).toHaveLength(1);
  expect(data.orders[0]).toMatchObject({
    wallet: a.wallet,
    payment_signature: tx.transaction.signatures[0],
    job_status: "QUEUED",
  });
  expect(BigInt(data.settlements[0].media_liability_microusd)).toBe(50000000n);
  expect(BigInt(data.settlements[0].service_fee_cents)).toBe(1000n);
  expect(Object.keys(data.gates).sort()).toEqual(["blocked", "live"]);
});

it("rejects unpaid activation transitions and terminal-state reactivation", async () => {
  const id = await campaign();
  await expect(
    transition(
      { query: q } as any,
      id,
      "PAID",
      "ACTIVATING",
      "SYSTEM",
      "unsafe",
    ),
  ).rejects.toThrow("Finalized payment");
  expect(canTransition("COMPLETED", "ACTIVATING")).toBe(false);
  expect(canTransition("CREATIVE_PENDING", "QUOTE_ACTIVE")).toBe(false);
  expect(canTransition("CREATIVE_REJECTED", "QUOTE_ACTIVE")).toBe(false);
});

it("allows multiple AIRTIME creator records to share the single private advertiser UUID", async () => {
  const shared = randomUUID();
  await q(
    "INSERT INTO platform_coins(mint,name,ticker,current_creator,venue) VALUES($1,'Shared test coin','SHARE',$2,'PUMP')",
    [mint, a.wallet],
  );
  await q(
    "INSERT INTO vibe_advertisers(user_id,mint,account_id,external_id,name,website) VALUES($1,$2,NULL,$3,'AIRTIME','https://airtime.example'),($4,$2,NULL,$3,'AIRTIME','https://airtime.example')",
    [a.userId, mint, shared, b.userId],
  );
  expect(
    (
      await q(
        "SELECT count(*)::int n FROM vibe_advertisers WHERE external_id=$1",
        [shared],
      )
    ).rows[0].n,
  ).toBe(2);
});
