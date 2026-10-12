import type { Queryable } from "./db";
export async function verifyPaymentSchema(c: Queryable) {
  const result = await c.query(`SELECT
      to_regclass('airtime.payment_test_invoices') IS NOT NULL
      AND to_regclass('airtime.payment_test_payments') IS NOT NULL
      AND to_regclass('airtime.payment_rail_references') IS NOT NULL
      AND to_regclass('airtime.payment_rail_receipts') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='payment_receipt_registry' AND tgrelid='airtime.campaign_payments'::regclass)
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='payment_reference_registry' AND tgrelid='airtime.campaign_invoices'::regclass)
      AND to_regclass('airtime.single_open_payment_test') IS NOT NULL
      AND (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='airtime' AND t.tgenabled='O' AND t.tgname=ANY(ARRAY['payment_reference_registry','payment_receipt_registry','test_reference_registry','test_receipt_registry','exact_test_payment','immutable_test_invoice','preserve_test_invoice','immutable_rail_record']))=10
      AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='airtime' AND c.relrowsecurity AND c.relname=ANY(ARRAY['payment_test_invoices','payment_test_payments','payment_rail_references','payment_rail_receipts']))=4
      AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='airtime' AND table_name='operations_audit' AND column_name='record_kind') AS ready`);
  if (!result.rows[0]?.ready)
    throw Error("Payment registry migration is incomplete");
}
