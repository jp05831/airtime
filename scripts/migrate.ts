import { readFile, readdir } from "node:fs/promises";
import { db } from "../lib/server/db";
async function main() {
  const pool = db(),
    c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock(836244003)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS public.airtime_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("supabase/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (
          await c.query(
            "SELECT name FROM public.airtime_migrations WHERE name=$1",
            [name],
          )
        ).rowCount
      )
        continue;
      await c.query("BEGIN");
      try {
        await c.query(await readFile("supabase/migrations/" + name, "utf8"));
        await c.query(
          "INSERT INTO public.airtime_migrations(name) VALUES($1)",
          [name],
        );
        await c.query("COMMIT");
        console.log("Applied " + name);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(836244003)");
    c.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error("Migration failed. Check database connection and SQL.");
  process.exitCode = 1;
});
