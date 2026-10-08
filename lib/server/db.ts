import { types, Pool, type PoolClient } from "pg";
import { databaseConnectionOptions } from "./database-config";
// Keep SQL dates as dates, independent of the backend time zone.
types.setTypeParser(1082, (value) => value);
const state = globalThis as unknown as { airtimePool?: Pool };
export function db() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  if (!state.airtimePool) {
    state.airtimePool = new Pool({
      ...databaseConnectionOptions(),
      options: "-c search_path=airtime",
      max: 6,
      connectionTimeoutMillis: 8000,
      statement_timeout: 20000,
      idleTimeoutMillis: 20000,
    });
    state.airtimePool.on("error", () =>
      console.error(JSON.stringify({ event: "database_error" })),
    );
  }
  return state.airtimePool;
}
export async function transaction<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export type Queryable = Pick<PoolClient, "query">;
