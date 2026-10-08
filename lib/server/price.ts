import { db } from "./db";
import { exactJSON } from "@/lib/vibe/money";
import { decimalMicros } from "@/lib/accounting";
export async function refreshPrice(fetcher: typeof fetch = fetch) {
  const { rows } = await db().query(
    "SELECT * FROM sol_price_snapshots WHERE fetched_at>now()-interval '60 seconds' ORDER BY fetched_at DESC LIMIT 1",
  );
  if (rows[0]) return rows[0];
  try {
    const headers: Record<string, string> = {};
    if (process.env.COINGECKO_API_KEY)
      headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
    const response = await fetcher(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) throw Error("Price unavailable");
    const data = exactJSON(await response.text());
    const micros = decimalMicros(String(data.solana?.usd));
    const result = await db().query(
      "INSERT INTO sol_price_snapshots(price_usd_micros,source) VALUES($1,'CoinGecko') RETURNING *",
      [micros.toString()],
    );
    return result.rows[0];
  } catch {
    return null;
  }
}
