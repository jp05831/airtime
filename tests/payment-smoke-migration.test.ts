import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { expect, it } from "vitest";

it("upgrades existing normal paid orders without changing their receipts, settlement or campaign status", async () => {
  const db = new PGlite();
  try {
    await db.exec("BEGIN");
    for (const name of [
      "001_airtime",
      "002_creator_platform",
      "003_vibe_automation",
      "004_review_then_payment",
      "005_private_vibe_advertiser",
      "006_private_upload_tickets",
      "007_upload_original_extension",
    ])
      await db.exec(
        await readFile("supabase/migrations/" + name + ".sql", "utf8"),
      );
    const user = randomUUID(),
      wallet = Keypair.generate().publicKey.toBase58(),
      mint = Keypair.generate().publicKey.toBase58(),
      recipient = Keypair.generate().publicKey.toBase58();
    await db.query("INSERT INTO platform_users(id) VALUES($1)", [user]);
    await db.query(
      "INSERT INTO platform_wallets(user_id,wallet) VALUES($1,$2)",
      [user, wallet],
    );
    await db.query(
      "INSERT INTO platform_coins(mint,name,ticker,current_creator,venue,metadata_source) VALUES($1,'Fixture','FIX',$2,'CURVE','TEST_FIXTURE')",
      [mint, wallet],
    );
    const expected: { id: string; reference: string; signature: string }[] = [];
    for (const version of [1, 2]) {
      const campaign = randomUUID(),
        creative = randomUUID(),
        external = randomUUID();
      await db.query(
        "INSERT INTO ad_campaigns(id,user_id,mint,title,brief,status,media_budget_cents,duration_days,proposed_start,product_version) VALUES($1,$2,$3,'Existing normal order',$4,'APPROVED_AWAITING_PAYMENT',5000,7,current_date+7,$5)",
        [
          campaign,
          user,
          mint,
          JSON.stringify({ creativeId: creative }),
          version,
        ],
      );
      if (version === 2) {
        await db.query(
          "INSERT INTO campaign_creatives(id,user_id,campaign_id,object_path,original_name,mime,bytes,metadata,validation_status) VALUES($1,$2,$3,$4,'fixture.mp4','video/mp4',100,'{}','TECHNICALLY_VALID')",
          [creative, user, campaign, "creators/fixture/" + creative],
        );
        await db.query(
          "INSERT INTO vibe_creatives(campaign_id,user_id,creative_id,external_id,name,approval_status) VALUES($1,$2,$3,$4,'Already reviewed','AUTHORIZED')",
          [campaign, user, creative, external],
        );
      }
      const invoice = (
        await db.query<any>(
          "INSERT INTO campaign_invoices(campaign_id,user_id,creator_wallet,mint,recipient_wallet,media_budget_cents,platform_fee_bps,platform_fee_cents,total_usd_cents,price_usd_micros,price_source,price_fetched_at,required_lamports,expires_at,product_version,approval_evidence) VALUES($1,$2,$3,$4,$5,5000,2000,1000,6000,100000000,'Fixture',now(),600000000,now()+interval '5 minutes',$6,$7) RETURNING *",
          [
            campaign,
            user,
            wallet,
            mint,
            recipient,
            version,
            JSON.stringify({
              status: "AUTHORIZED",
              vibe_creative_id: external,
            }),
          ],
        )
      ).rows[0];
      const signature = "preserved-normal-signature-" + version;
      await db.query(
        "INSERT INTO campaign_payments(invoice_id,signature,creator_wallet,recipient_wallet,amount_lamports,status,slot,block_time,evidence) VALUES($1,$2,$3,$4,600000000,'FINALIZED',123,now(),'{}')",
        [invoice.id, signature, wallet, recipient],
      );
      await db.query(
        "UPDATE campaign_invoices SET status='PAID',broadcast_signature=$2 WHERE id=$1",
        [invoice.id, signature],
      );
      await db.query("UPDATE ad_campaigns SET status='PAID' WHERE id=$1", [
        campaign,
      ]);
      await db.query(
        "INSERT INTO campaign_settlements(invoice_id,campaign_id,customer_lamports,media_cents,service_fee_cents) VALUES($1,$2,600000000,5000,1000)",
        [invoice.id, campaign],
      );
      expected.push({
        id: invoice.id,
        reference: version === 1 ? invoice.id : invoice.payment_reference,
        signature,
      });
    }
    const snapshot = async () => ({
      invoices: (await db.query("SELECT * FROM campaign_invoices ORDER BY id"))
        .rows,
      payments: (await db.query("SELECT * FROM campaign_payments ORDER BY id"))
        .rows,
      campaigns: (await db.query("SELECT * FROM ad_campaigns ORDER BY id"))
        .rows,
      settlements: (
        await db.query("SELECT * FROM campaign_settlements ORDER BY invoice_id")
      ).rows,
    });
    const before = await snapshot();
    await db.exec(
      await readFile("supabase/migrations/008_payment_smoke_test.sql", "utf8"),
    );
    expect(await snapshot()).toEqual(before);
    for (const record of expected) {
      expect(
        (
          await db.query(
            "SELECT payment_reference,record_kind FROM payment_rail_references WHERE invoice_id=$1",
            [record.id],
          )
        ).rows,
      ).toEqual([
        { payment_reference: record.reference, record_kind: "NORMAL" },
      ]);
      expect(
        (
          await db.query(
            "SELECT signature,record_kind FROM payment_rail_receipts WHERE invoice_id=$1",
            [record.id],
          )
        ).rows,
      ).toEqual([{ signature: record.signature, record_kind: "NORMAL" }]);
    }
    expect(
      (await db.query("SELECT * FROM payment_test_invoices")).rows,
    ).toHaveLength(0);
    await db.exec("COMMIT");
  } finally {
    await db.close();
  }
});
