import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import pump from "@/vendor/pump/pump.json";
import amm from "@/vendor/pump/pump_amm.json";
import fees from "@/vendor/pump/pump_fees.json";
import { connection, GENESIS } from "@/lib/server/chain";
import { decode, canonicalPool, PUMP, PUMP_AMM } from "@/lib/server/protocol";
import { ZERO, WSOL } from "@/lib/accounting";
import { address, externalUrl } from "@/lib/validation";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import type { CreatorIdentity, CoinView } from "./model";
import {
  authorityAccount,
  verifyMintAccount,
  AUTHORITY_REVISION,
  USDC,
} from "./pump-authority";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
// Constants are taken from the official IDL (ATA below is the canonical address).
export const TOKEN_PROGRAM = new PublicKey(TOKEN),
  ASSOCIATED_PROGRAM = new PublicKey(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  );
export const pda = (program: string, seeds: (string | PublicKey)[]) =>
  PublicKey.findProgramAddressSync(
    seeds.map((s) => (typeof s === "string" ? Buffer.from(s) : s.toBuffer())),
    new PublicKey(program),
  )[0];
export const associated = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [
      owner.toBuffer(),
      TOKEN_PROGRAM.toBuffer(),
      new PublicKey(WSOL).toBuffer(),
    ],
    ASSOCIATED_PROGRAM,
  )[0];
function accountDecode(idl: any, name: string, data: Buffer) {
  const tag = idl.accounts.find((x: any) => x.name === name)?.discriminator;
  if (!tag || !data.subarray(0, 8).equals(Buffer.from(tag)))
    throw new HttpError(403, "Official account layout not recognized");
  try {
    return decode(idl, name, data.subarray(8), { accountCompatibility: true });
  } catch {
    throw new HttpError(
      422,
      "This coin's fee authority account version is not supported. Creator verification could not be completed.",
    );
  }
}
export type AuthorityProof = {
  mint: string;
  creator: string;
  role: "CREATOR" | "FEE_RECIPIENT" | "FEE_ADMIN";
  venue: string;
  sharing: any | null;
  curve: PublicKey;
  pool: PublicKey;
  quote: string;
  holder: boolean;
  cashback: boolean;
  slot: number;
  evidence: unknown;
};
export async function verifyCoinAuthority(
  wallet: string,
  mint: string,
  conn: Connection = connection(),
): Promise<AuthorityProof> {
  address.parse(wallet);
  address.parse(mint);
  if ((await conn.getGenesisHash()) !== GENESIS)
    throw new HttpError(503, "Mainnet RPC required");
  const curve = pda(PUMP, ["bonding-curve", new PublicKey(mint)]),
    solPool = new PublicKey(canonicalPool(mint, WSOL)),
    usdcPool = new PublicKey(canonicalPool(mint, USDC));
  const result = await conn.getMultipleAccountsInfoAndContext(
    [new PublicKey(mint), curve, solPool, usdcPool],
    { commitment: "finalized" },
  );
  const [mintAccount, curveAccount, solPoolAccount, usdcPoolAccount] =
    result.value;
  verifyMintAccount(mintAccount);
  let state: any,
    creator: string,
    venue: string,
    pool = solPool,
    pairedAsset = WSOL,
    curveLayout: string | null = null,
    poolLayout: string | null = null;
  if (curveAccount) {
    if (curveAccount.owner.toBase58() !== PUMP || curveAccount.executable)
      throw new HttpError(403, "This mint is not a verified Pump coin");
    const decoded = authorityAccount("BondingCurve", curveAccount.data);
    state = decoded.state;
    curveLayout = decoded.layout;
    creator = state.creator;
    venue = "Pump bonding curve";
    if (state.is_holder_reward || state.is_cashback_coin)
      throw new HttpError(
        403,
        "Holder-reward or cashback coins do not prove creator-controlled fee funds",
      );
    if (![ZERO, WSOL, USDC].includes(state.quote_mint))
      throw new HttpError(
        403,
        "This version supports SOL-paired and USDC-paired coins only",
      );
    pairedAsset = state.quote_mint === USDC ? USDC : WSOL;
    pool = pairedAsset === USDC ? usdcPool : solPool;
    if (state.complete) {
      const poolAccount =
        pairedAsset === USDC ? usdcPoolAccount : solPoolAccount;
      if (
        !poolAccount ||
        poolAccount.owner.toBase58() !== PUMP_AMM ||
        poolAccount.executable
      )
        throw new HttpError(403, "Canonical graduated pool unavailable");
      const decodedPool = authorityAccount("Pool", poolAccount.data);
      state = decodedPool.state;
      poolLayout = decodedPool.layout;
      creator = state.coin_creator;
      venue = "Canonical PumpSwap";
    }
  } else if (
    solPoolAccount?.owner.toBase58() === PUMP_AMM ||
    usdcPoolAccount?.owner.toBase58() === PUMP_AMM
  ) {
    pairedAsset = solPoolAccount?.owner.toBase58() === PUMP_AMM ? WSOL : USDC;
    pool = pairedAsset === USDC ? usdcPool : solPool;
    const poolAccount =
      pairedAsset === USDC ? usdcPoolAccount! : solPoolAccount!;
    if (poolAccount.executable)
      throw new HttpError(403, "This mint is not a verified Pump coin");
    const decodedPool = authorityAccount("Pool", poolAccount.data);
    state = decodedPool.state;
    poolLayout = decodedPool.layout;
    creator = state.coin_creator;
    venue = "Canonical PumpSwap";
  } else throw new HttpError(403, "This mint is not a verified Pump coin");
  if (
    venue === "Canonical PumpSwap" &&
    (state.base_mint !== mint ||
      state.quote_mint !== pairedAsset ||
      state.index !== 0n ||
      state.creator !==
        pda(PUMP, ["pool-authority", new PublicKey(mint)]).toBase58())
  )
    throw new HttpError(403, "Unsupported pool or paired asset");
  const quote = state.quote_mint;
  if (![ZERO, WSOL, USDC].includes(quote))
    throw new HttpError(
      403,
      "This version supports SOL-paired and USDC-paired coins only",
    );
  if (state.is_holder_reward || state.is_cashback_coin)
    throw new HttpError(
      403,
      "Holder-reward or cashback coins do not prove creator-controlled fee funds",
    );
  const sharingAddress = pda(fees.address, [
    "sharing-config",
    new PublicKey(mint),
  ]);
  let sharing: any = null,
    role: AuthorityProof["role"] = "CREATOR";
  if (creator === ZERO)
    throw new HttpError(
      403,
      "Pump has not assigned a current creator authority to this coin yet. Retry after its on-chain creator is set.",
    );
  if (creator !== wallet) {
    if (creator !== sharingAddress.toBase58())
      throw new HttpError(403, "This wallet does not control this coin");
    const a = await conn.getAccountInfo(sharingAddress, "finalized");
    if (!a || a.owner.toBase58() !== fees.address)
      throw new HttpError(403, "Fee authority unavailable");
    sharing = accountDecode(fees, "SharingConfig", a.data);
    if (
      sharing.mint !== mint ||
      ![1n, 2n].includes(sharing.version) ||
      sharing.status !== "Active" ||
      sharing.shareholders.length < 1 ||
      sharing.shareholders.length > 16 ||
      sharing.shareholders.reduce(
        (n: number, s: any) => n + Number(s.share_bps),
        0,
      ) !== 10000
    )
      throw new HttpError(403, "Fee sharing configuration not supported");
    if (
      sharing.shareholders.some(
        (s: any) => s.address === wallet && s.share_bps > 0n,
      )
    )
      role = "FEE_RECIPIENT";
    else if (sharing.admin === wallet && !sharing.admin_revoked)
      role = "FEE_ADMIN";
    else
      throw new HttpError(
        403,
        "This wallet is not a current fee recipient or administrator",
      );
  }
  return {
    mint,
    creator,
    role,
    venue,
    sharing,
    curve,
    pool,
    quote,
    holder: !!state.is_holder_reward,
    cashback: !!state.is_cashback_coin,
    slot: result.context.slot,
    evidence: {
      revision: AUTHORITY_REVISION,
      curveLayout,
      poolLayout,
      slot: result.context.slot,
      curve: curve.toBase58(),
      pool: pool.toBase58(),
      currentCreator: creator,
      role,
      sharing: sharing
        ? JSON.parse(
            JSON.stringify(sharing, (_, v) =>
              typeof v === "bigint" ? v.toString() : v,
            ),
          )
        : null,
    },
  };
}
async function asset(mint: string, conn: Connection) {
  try {
    const response = await fetch(conn.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAsset",
        params: { id: mint },
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await response.json();
    const a = json.result;
    const meta = a?.content?.metadata;
    const raw = a?.content?.links?.image || a?.content?.files?.[0]?.uri;
    let image = null;
    try {
      image = raw ? externalUrl(raw) : null;
    } catch {}
    return {
      name: String(meta?.name || "Pump coin").slice(0, 80),
      ticker: String(meta?.symbol || "COIN").slice(0, 20),
      image,
      source: meta ? "HELIUS_DAS" : "UNAVAILABLE",
    };
  } catch {
    return {
      name: "Pump coin",
      ticker: "COIN",
      image: null,
      source: "UNAVAILABLE",
    };
  }
}
export async function addCoin(
  identity: CreatorIdentity,
  mint: string,
  conn: Connection = connection(),
) {
  const proof = await verifyCoinAuthority(identity.wallet, mint, conn),
    meta = await asset(mint, conn);
  await db().query(
    `INSERT INTO platform_coins(mint,name,ticker,image_url,metadata_source,current_creator,venue) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(mint) DO UPDATE SET current_creator=EXCLUDED.current_creator,venue=EXCLUDED.venue,updated_at=now()`,
    [
      mint,
      meta.name,
      meta.ticker,
      meta.image,
      meta.source,
      proof.creator,
      proof.venue,
    ],
  );
  await db().query(
    `INSERT INTO coin_authorities(user_id,mint,wallet,role,evidence) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,mint) DO UPDATE SET role=EXCLUDED.role,evidence=EXCLUDED.evidence,verified_at=now()`,
    [
      identity.userId,
      mint,
      identity.wallet,
      proof.role,
      JSON.stringify(proof.evidence),
    ],
  );
  await db().query(
    "INSERT INTO operations_audit(actor,action,entity_id,details) VALUES($1,'COIN_AUTHORITY_VERIFIED',$2,$3)",
    [identity.wallet, mint, JSON.stringify(proof.evidence)],
  );
  return proof;
}
export async function discoverCoins(
  identity: CreatorIdentity,
  conn: Connection = connection(),
) {
  let candidates: string[] = [];
  try {
    const response = await fetch(conn.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "searchAssets",
        params: {
          creatorAddress: identity.wallet,
          creatorVerified: true,
          tokenType: "fungible",
          limit: 100,
          page: 1,
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    candidates = (data.result?.items || [])
      .map((a: any) => a.id)
      .filter((v: any) => address.safeParse(v).success)
      .slice(0, 20);
  } catch {}
  const { rows } = await db().query(
    "SELECT mint FROM coin_authorities WHERE user_id=$1",
    [identity.userId],
  );
  candidates = [...new Set([...rows.map((r) => r.mint), ...candidates])];
  let verified = 0;
  for (const mint of candidates) {
    try {
      await addCoin(identity, mint, conn);
      verified++;
    } catch {
      /* DAS metadata is never proof of authority. */
    }
  }
  return {
    verified,
    notice: verified
      ? "Current on-chain authority verified."
      : "Discovery may be incomplete. Enter a mint to verify it directly.",
  };
}
export async function claimBalances(
  proof: AuthorityProof,
  conn: Connection = connection(),
) {
  // USDC authority verification is supported; existing claims remain SOL-only.
  if (proof.quote === USDC)
    throw new HttpError(
      409,
      "USDC-paired coin authority is verified, but USDC fee claims are not available in AIRTIME. Use Pump to claim these fees.",
    );
  const vault = pda(PUMP, ["creator-vault", new PublicKey(proof.creator)]),
    ammVault = pda(PUMP_AMM, ["creator_vault", new PublicKey(proof.creator)]),
    ammAta = associated(ammVault);
  const result = await conn.getMultipleAccountsInfoAndContext([vault, ammAta], {
    commitment: "finalized",
  });
  let curve = 0n,
    ammAmount = 0n;
  const [c, a] = result.value;
  if (c) {
    if (
      c.owner.toBase58() !== SystemProgram.programId.toBase58() ||
      !Number.isSafeInteger(c.lamports)
    )
      throw Error("Creator vault unsupported");
    const rent = await conn.getMinimumBalanceForRentExemption(
      c.data.length,
      "finalized",
    );
    if (!Number.isSafeInteger(rent)) throw Error("Rent unavailable");
    curve = BigInt(Math.max(0, c.lamports - rent));
  }
  if (a) {
    if (
      a.owner.toBase58() !== TOKEN ||
      a.data.length !== 165 ||
      new PublicKey(a.data.subarray(0, 32)).toBase58() !== WSOL ||
      !new PublicKey(a.data.subarray(32, 64)).equals(ammVault) ||
      a.data[108] !== 1
    )
      throw Error("Creator vault token layout unsupported");
    ammAmount = a.data.readBigUInt64LE(64);
  }
  return { curve, amm: ammAmount, slot: result.context.slot };
}
export async function coinView(
  row: any,
  wallet: string,
  conn?: Connection,
): Promise<CoinView> {
  let amount: string | null = null,
    curve: string | null = null,
    ammAmount: string | null = null,
    notice = "Exact claimable fees are unavailable. Reverify before claiming.",
    sharing = false,
    claimable = false,
    authorityCurrent = false;
  try {
    const rpc = conn || connection();
    const p = await verifyCoinAuthority(wallet, row.mint, rpc);
    authorityCurrent = true;
    sharing = !!p.sharing;
    claimable = p.role !== "FEE_ADMIN" && p.quote !== USDC;
    if (p.quote === USDC)
      notice =
        "USDC-paired coin authority verified. Use Pump to claim USDC creator fees; AIRTIME currently supports SOL fee claims only.";
    const b = await claimBalances(p, rpc);
    curve = b.curve.toString();
    ammAmount = b.amm.toString();
    if (p.sharing) {
      const share =
        p.sharing.shareholders.find((s: any) => s.address === wallet)
          ?.share_bps || 0n; // Distribution rounding occurs separately; do not quote combined proportional balances as exact.
      notice =
        share > 0n
          ? "Shared fee vault balances verified; your exact distribution is confirmed after the signed claim."
          : "Fee administrator verified; no fee share is payable to this wallet.";
    } else {
      amount = (b.curve + b.amm).toString();
      notice =
        "Verified SOL/WSOL vault balances across ALL coins using this creator wallet, after curve rent reserve. Not a per-coin fee total.";
    }
  } catch {
    /* Honest unavailable state, never an estimate. */
  }
  const { rows } = await db().query(
    "SELECT CASE WHEN count(*) FILTER(WHERE exact_claim_lamports IS NULL)>0 THEN NULL ELSE coalesce(sum(exact_claim_lamports),0)::text END amount FROM fee_claim_requests WHERE wallet=$1 AND status='FINALIZED'",
    [wallet],
  );
  return {
    ...row,
    authorityCurrent,
    claimableLamports: amount,
    curveLamports: curve,
    ammLamports: ammAmount,
    claimedLamports: rows[0]?.amount ?? null,
    feeNotice: notice,
    sharing,
    claimable,
  };
}
function instruction(
  idl: any,
  name: string,
  accounts: Record<string, PublicKey>,
  suffix = Buffer.alloc(0),
  remaining: PublicKey[] = [],
) {
  const ix = idl.instructions.find((x: any) => x.name === name);
  if (!ix || ix.accounts.some((a: any) => !accounts[a.name] && !a.address))
    throw Error("Official instruction accounts incomplete");
  return new TransactionInstruction({
    programId: new PublicKey(idl.address),
    data: Buffer.concat([Buffer.from(ix.discriminator), suffix]),
    keys: [
      ...ix.accounts.map((a: any) => ({
        pubkey: accounts[a.name] || new PublicKey(a.address),
        isSigner: !!a.signer,
        isWritable: !!a.writable,
      })),
      ...remaining.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: true,
      })),
    ],
  });
}
export async function buildClaim(
  proof: AuthorityProof,
  wallet: string,
  venue: "CURVE" | "AMM",
  conn: Connection = connection(),
) {
  const b = await claimBalances(proof, conn);
  if ((venue === "CURVE" ? b.curve : b.amm) === 0n)
    throw new HttpError(409, "No verified fees available in this vault");
  if (proof.sharing && proof.role === "FEE_ADMIN")
    throw new HttpError(
      403,
      "This administrator wallet has no fee-recipient share",
    );
  const creator = new PublicKey(proof.creator),
    payer = new PublicKey(wallet),
    vault = pda(PUMP, ["creator-vault", creator]),
    authority = pda(PUMP_AMM, ["creator_vault", creator]);
  const common = {
    creator,
    coin_creator: creator,
    payer,
    mint: new PublicKey(proof.mint),
    bonding_curve: proof.curve,
    creator_vault: vault,
    pump_creator_vault: vault,
    quote_mint: new PublicKey(WSOL),
    quote_token_program: TOKEN_PROGRAM,
    token_program: TOKEN_PROGRAM,
    associated_token_program: ASSOCIATED_PROGRAM,
    system_program: SystemProgram.programId,
    creator_token_account: associated(creator),
    creator_vault_token_account: associated(vault),
    creator_vault_quote_token_account: associated(vault),
    pump_creator_vault_ata: associated(vault),
    coin_creator_vault_authority: authority,
    coin_creator_vault_ata: associated(authority),
    coin_creator_token_account: associated(creator),
    sharing_config: pda(fees.address, [
      "sharing-config",
      new PublicKey(proof.mint),
    ]),
  };
  const tx = new Transaction();
  let description: string;
  if (proof.sharing) {
    if (proof.sharing.version === 1n)
      throw new HttpError(
        409,
        "Legacy shared distributions require reconciliation through Pump",
      );
    if (venue === "AMM") {
      tx.add(
        instruction(amm, "transfer_creator_fees_to_pump_v2", {
          ...common,
          event_authority: pda(PUMP_AMM, ["__event_authority"]),
          program: new PublicKey(PUMP_AMM),
        }),
      );
      description =
        "Move shared WSOL creator fees from PumpSwap into the Pump creator vault. This does not pay AIRTIME. Then sign a separate distribution claim.";
    } else {
      tx.add(
        instruction(
          pump,
          "distribute_creator_fees_v2",
          {
            ...common,
            event_authority: pda(PUMP, ["__event_authority"]),
            program: new PublicKey(PUMP),
          },
          Buffer.from([0]),
          proof.sharing.shareholders.map((s: any) => new PublicKey(s.address)),
        ),
      );
      description =
        "Distribute native SOL creator fees to all verified fee shareholders according to the official sharing configuration. No payment to AIRTIME.";
    }
  } else if (venue === "CURVE") {
    tx.add(
      instruction(pump, "collect_creator_fee_v2", {
        ...common,
        event_authority: pda(PUMP, ["__event_authority"]),
        program: new PublicKey(PUMP),
      }),
    );
    description =
      "Collect wallet-wide Pump creator fees into your wallet, leaving the vault rent reserve. No payment to AIRTIME.";
  } else {
    // Create only the recipient WSOL ATA, collect, and unwrap it. Existing ATA balance is not mixed into the claim.
    const recipient = associated(payer);
    if (await conn.getAccountInfo(recipient, "finalized"))
      throw new HttpError(
        409,
        "Existing WSOL account must be reviewed/unwrapped in your wallet before this safe claim flow",
      );
    tx.add(
      new TransactionInstruction({
        programId: ASSOCIATED_PROGRAM,
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: recipient, isSigner: false, isWritable: true },
          { pubkey: payer, isSigner: false, isWritable: false },
          { pubkey: new PublicKey(WSOL), isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([1]),
      }),
    );
    tx.add(
      instruction(amm, "collect_coin_creator_fee", {
        ...common,
        coin_creator_token_account: recipient,
        event_authority: pda(PUMP_AMM, ["__event_authority"]),
        program: new PublicKey(PUMP_AMM),
      }),
    );
    tx.add(
      new TransactionInstruction({
        programId: TOKEN_PROGRAM,
        keys: [
          { pubkey: recipient, isSigner: false, isWritable: true },
          { pubkey: payer, isSigner: false, isWritable: true },
          { pubkey: payer, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([9]),
      }),
    );
    description =
      "Create your WSOL account, collect wallet-wide PumpSwap creator fees, then unwrap that new account into SOL. You pay account rent/network fees; no payment to AIRTIME.";
  }
  tx.feePayer = payer;
  const block = await conn.getLatestBlockhash("finalized");
  tx.recentBlockhash = block.blockhash;
  return {
    tx,
    blockheight: block.lastValidBlockHeight,
    description,
    estimatedVaultLamports: (venue === "CURVE" ? b.curve : b.amm).toString(),
  };
}
