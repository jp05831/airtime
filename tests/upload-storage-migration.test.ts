import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("keeps Storage private and blocks creator-object browser access even with permissive policies", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA airtime;
      CREATE TABLE airtime.platform_users(id uuid PRIMARY KEY);
      CREATE TABLE airtime.platform_wallets(wallet text PRIMARY KEY);
      CREATE TABLE airtime.campaign_creatives(id uuid PRIMARY KEY);
      CREATE SCHEMA storage;
      CREATE TABLE storage.objects(name text PRIMARY KEY);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY old_permissive_policy ON storage.objects FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
      CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean NOT NULL);
      INSERT INTO storage.buckets VALUES('airtime-proof',true);
      INSERT INTO storage.objects VALUES('creators/owner/final/commercial.mp4'),('operations/proof.pdf');
      CREATE ROLE upload_browser NOLOGIN;
      GRANT USAGE ON SCHEMA storage TO upload_browser;
      GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO upload_browser;
      BEGIN;
    `);
    await db.exec(
      await readFile(
        "supabase/migrations/006_private_upload_tickets.sql",
        "utf8",
      ),
    );
    await db.exec("COMMIT");
    expect(
      (
        await db.query(
          "SELECT public FROM storage.buckets WHERE id='airtime-proof'",
        )
      ).rows,
    ).toEqual([{ public: false }]);
    await db.exec("SET ROLE upload_browser");
    expect((await db.query("SELECT name FROM storage.objects")).rows).toEqual([
      { name: "operations/proof.pdf" },
    ]);
    await expect(
      db.exec(
        "INSERT INTO storage.objects VALUES('creators/attacker/pending/video.mp4')",
      ),
    ).rejects.toThrow("row-level security");
    expect(
      (
        await db.query(
          "UPDATE storage.objects SET name='changed' WHERE name LIKE 'creators/%' RETURNING name",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "DELETE FROM storage.objects WHERE name LIKE 'creators/%' RETURNING name",
        )
      ).rows,
    ).toHaveLength(0);
    await db.exec("RESET ROLE");
    // Storage's server authority (used by signed capabilities/service role)
    // can access the objects, while ordinary browser table access cannot.
    expect(
      (await db.query("SELECT name FROM storage.objects")).rows,
    ).toHaveLength(2);
  } finally {
    await db.close();
  }
});
