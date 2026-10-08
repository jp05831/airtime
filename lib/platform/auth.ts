import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { db, transaction } from "@/lib/server/db";
import { hash, HttpError, rateLimit } from "@/lib/server/http";
import { origin } from "@/lib/server/config";
import { cookieOptions } from "@/lib/server/auth";
import { address } from "@/lib/validation";
import type { CreatorIdentity } from "./model";
export function walletMessage(
  wallet: string,
  nonce: string,
  issued: Date,
  expires: Date,
) {
  return `${new URL(origin()).host} requests creator authentication for AIRTIME.\n\nWallet: ${wallet}\nDomain: ${origin()}\nNonce: ${nonce}\nIssued: ${issued.toISOString()}\nExpires: ${expires.toISOString()}\nPurpose: Authenticate to manage your own television advertising campaigns.\n\nThis gasless signature does not authorize a transfer or access to your funds.`;
}
export function checkWalletSignature(
  wallet: string,
  message: string,
  signature: string,
) {
  try {
    const bytes = bs58.decode(signature);
    return (
      bytes.length === 64 &&
      nacl.sign.detached.verify(
        Buffer.from(message),
        bytes,
        new PublicKey(wallet).toBytes(),
      )
    );
  } catch {
    return false;
  }
}
export async function createChallenge(wallet: string) {
  address.parse(wallet);
  if (!PublicKey.isOnCurve(new PublicKey(wallet).toBytes()))
    throw new HttpError(400, "Use a signing wallet");
  const now = new Date(),
    expires = new Date(now.getTime() + 300000),
    nonce = randomBytes(32).toString("hex"),
    message = walletMessage(wallet, nonce, now, expires);
  const { rows } = await db().query(
    "INSERT INTO wallet_auth_challenges(wallet,nonce,message,issued_at,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id",
    [wallet, nonce, message, now, expires],
  );
  return { id: rows[0].id, message, expiresAt: expires.toISOString() };
}
export async function authenticateWallet(
  id: string,
  wallet: string,
  signature: string,
) {
  return transaction(async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM wallet_auth_challenges WHERE id=$1 FOR UPDATE",
      [id],
    );
    const challenge = rows[0];
    if (
      !challenge ||
      challenge.wallet !== wallet ||
      challenge.used_at ||
      new Date(challenge.expires_at).getTime() <= Date.now()
    )
      throw new HttpError(
        401,
        "Challenge expired or already used. Connect again.",
      );
    if (!checkWalletSignature(wallet, challenge.message, signature))
      throw new HttpError(401, "Wallet signature invalid");
    await c.query(
      "UPDATE wallet_auth_challenges SET used_at=now() WHERE id=$1",
      [id],
    );
    // Lock by wallet: simultaneous first sign-ins cannot create disconnected user records.
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [wallet]);
    let userId = (
      await c.query("SELECT user_id FROM platform_wallets WHERE wallet=$1", [
        wallet,
      ])
    ).rows[0]?.user_id;
    if (!userId) {
      userId = (
        await c.query("INSERT INTO platform_users DEFAULT VALUES RETURNING id")
      ).rows[0].id;
      await c.query(
        "INSERT INTO platform_wallets(wallet,user_id) VALUES($1,$2)",
        [wallet, userId],
      );
    }
    const token = randomBytes(32).toString("base64url");
    await c.query(
      "INSERT INTO creator_sessions(token_hash,user_id,wallet,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
      [hash(token), userId, wallet],
    );
    return { token, userId, wallet };
  });
}
export async function requireCreator(
  r?: NextRequest,
): Promise<CreatorIdentity> {
  const token = r
    ? r.cookies.get("airtime_creator")?.value
    : (await cookies()).get("airtime_creator")?.value;
  if (!token) throw new HttpError(401, "Connect your creator wallet");
  const { rows } = await db().query(
    "SELECT user_id,wallet FROM creator_sessions WHERE token_hash=$1 AND expires_at>now()",
    [hash(token)],
  );
  if (!rows[0])
    throw new HttpError(401, "Wallet session expired. Connect again.");
  return { userId: rows[0].user_id, wallet: rows[0].wallet };
}
export function creatorCookie(response: NextResponse, token: string) {
  response.cookies.set("airtime_creator", token, {
    ...cookieOptions,
    maxAge: 28800,
  });
  return response;
}
export async function creatorLimit(
  identity: CreatorIdentity,
  key = "request",
  limit = 40,
) {
  await rateLimit(`creator:${identity.userId}:${key}`, limit);
}
