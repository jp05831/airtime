SET LOCAL search_path=airtime,public;
-- TEST records are physically isolated from every campaign/settlement FK.
CREATE TABLE payment_test_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_kind text NOT NULL DEFAULT 'TEST' CHECK(record_kind='TEST'),
  admin_id uuid NOT NULL REFERENCES admin_users(id),
  creator_wallet text NOT NULL,
  recipient_wallet text NOT NULL CHECK(recipient_wallet<>creator_wallet),
  payment_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  total_usd_cents bigint NOT NULL DEFAULT 100 CHECK(total_usd_cents=100),
  media_budget_cents bigint NOT NULL DEFAULT 0 CHECK(media_budget_cents=0),
  platform_fee_cents bigint NOT NULL DEFAULT 0 CHECK(platform_fee_cents=0),
  price_usd_micros bigint NOT NULL CHECK(price_usd_micros>0),
  price_source text NOT NULL,
  price_fetched_at timestamptz NOT NULL,
  required_lamports bigint NOT NULL CHECK(required_lamports BETWEEN 1 AND 9007199254740991),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','VERIFYING','PAID','EXPIRED','CANCELLED')),
  prepared_message text,
  prepared_blockheight bigint,
  prepared_at timestamptz,
  confirmation_checked_at timestamptz,
  broadcast_signature text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  CHECK(expires_at=created_at+interval '5 minutes'),
  CHECK(required_lamports=ceil(1000000000000000::numeric/price_usd_micros)),
  CHECK((prepared_message IS NULL)=(prepared_blockheight IS NULL))
);
CREATE UNIQUE INDEX single_open_payment_test ON payment_test_invoices((true)) WHERE status IN ('OPEN','VERIFYING');
CREATE TABLE payment_test_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_kind text NOT NULL DEFAULT 'TEST' CHECK(record_kind='TEST'),
  invoice_id uuid NOT NULL UNIQUE REFERENCES payment_test_invoices(id),
  signature text NOT NULL UNIQUE,
  creator_wallet text NOT NULL,
  recipient_wallet text NOT NULL,
  amount_lamports bigint NOT NULL,
  status text NOT NULL CHECK(status='FINALIZED'),
  slot bigint NOT NULL,
  block_time timestamptz NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Global registries stop reference/signature reuse across TEST and normal rails.
CREATE TABLE payment_rail_references (
  payment_reference uuid PRIMARY KEY,
  invoice_id uuid NOT NULL UNIQUE,
  record_kind text NOT NULL CHECK(record_kind IN ('TEST','NORMAL')),
  UNIQUE(invoice_id,record_kind)
);
INSERT INTO payment_rail_references SELECT CASE WHEN product_version=1 THEN id ELSE payment_reference END,id,'NORMAL' FROM campaign_invoices;
CREATE TABLE payment_rail_receipts (
  signature text PRIMARY KEY,
  invoice_id uuid NOT NULL UNIQUE,
  record_kind text NOT NULL CHECK(record_kind IN ('TEST','NORMAL')),
  FOREIGN KEY(invoice_id,record_kind) REFERENCES payment_rail_references(invoice_id,record_kind)
);
INSERT INTO payment_rail_receipts SELECT signature,invoice_id,'NORMAL' FROM campaign_payments;
CREATE FUNCTION register_payment_rail_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO payment_rail_references VALUES(
    CASE WHEN TG_TABLE_NAME='campaign_invoices' AND (to_jsonb(NEW)->>'product_version')::int=1 THEN NEW.id ELSE NEW.payment_reference END,
    NEW.id,CASE WHEN TG_TABLE_NAME='payment_test_invoices' THEN 'TEST' ELSE 'NORMAL' END);
  RETURN NEW;
END $$;
CREATE TRIGGER payment_reference_registry BEFORE INSERT ON campaign_invoices FOR EACH ROW EXECUTE FUNCTION register_payment_rail_reference();
CREATE TRIGGER test_reference_registry BEFORE INSERT ON payment_test_invoices FOR EACH ROW EXECUTE FUNCTION register_payment_rail_reference();
CREATE FUNCTION register_payment_rail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO payment_rail_receipts VALUES(NEW.signature,NEW.invoice_id,
    CASE WHEN TG_TABLE_NAME='payment_test_payments' THEN 'TEST' ELSE 'NORMAL' END);
  RETURN NEW;
END $$;
CREATE TRIGGER payment_receipt_registry BEFORE INSERT ON campaign_payments FOR EACH ROW EXECUTE FUNCTION register_payment_rail_receipt();
CREATE TRIGGER test_receipt_registry BEFORE INSERT ON payment_test_payments FOR EACH ROW EXECUTE FUNCTION register_payment_rail_receipt();
CREATE FUNCTION guard_test_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i payment_test_invoices;
BEGIN
  SELECT * INTO i FROM payment_test_invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF i.status NOT IN ('OPEN','VERIFYING') OR NEW.creator_wallet<>i.creator_wallet OR NEW.recipient_wallet<>i.recipient_wallet
    OR NEW.amount_lamports<>i.required_lamports OR NEW.block_time<date_trunc('second',i.created_at) OR NEW.block_time>i.expires_at
    OR (i.broadcast_signature IS NOT NULL AND NEW.signature<>i.broadcast_signature)
  THEN RAISE EXCEPTION 'TEST receipt does not match invoice'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER exact_test_payment BEFORE INSERT ON payment_test_payments FOR EACH ROW EXECUTE FUNCTION guard_test_payment();
CREATE FUNCTION immutable_test_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.admin_id,NEW.record_kind,NEW.creator_wallet,NEW.recipient_wallet,NEW.payment_reference,NEW.total_usd_cents,NEW.media_budget_cents,NEW.platform_fee_cents,NEW.price_usd_micros,NEW.price_source,NEW.price_fetched_at,NEW.required_lamports,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM (OLD.id,OLD.admin_id,OLD.record_kind,OLD.creator_wallet,OLD.recipient_wallet,OLD.payment_reference,OLD.total_usd_cents,OLD.media_budget_cents,OLD.platform_fee_cents,OLD.price_usd_micros,OLD.price_source,OLD.price_fetched_at,OLD.required_lamports,OLD.created_at,OLD.expires_at)
    OR (OLD.status IN ('PAID','CANCELLED','EXPIRED') AND NEW.status<>OLD.status)
    OR (OLD.broadcast_signature IS NOT NULL AND (NEW.broadcast_signature,NEW.prepared_message,NEW.prepared_blockheight) IS DISTINCT FROM (OLD.broadcast_signature,OLD.prepared_message,OLD.prepared_blockheight))
  THEN RAISE EXCEPTION 'TEST invoice identity is immutable'; END IF;
  IF NEW.status='PAID' AND NOT EXISTS(SELECT 1 FROM payment_test_payments WHERE invoice_id=NEW.id)
  THEN RAISE EXCEPTION 'Finalized TEST receipt required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_test_invoice BEFORE UPDATE ON payment_test_invoices FOR EACH ROW EXECUTE FUNCTION immutable_test_invoice();
CREATE TRIGGER preserve_test_invoice BEFORE DELETE ON payment_test_invoices FOR EACH ROW EXECUTE FUNCTION platform_no_delete();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['payment_test_invoices','payment_test_payments','payment_rail_references','payment_rail_receipts'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
END LOOP; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['payment_test_payments','payment_rail_references','payment_rail_receipts'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_rail_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION platform_no_delete()',t);
END LOOP; END $$;
ALTER TABLE webhook_events ADD COLUMN record_kind text NOT NULL DEFAULT 'NORMAL' CHECK(record_kind IN ('NORMAL','TEST'));

ALTER TABLE operations_audit ADD COLUMN record_kind text NOT NULL DEFAULT 'NORMAL' CHECK(record_kind IN ('NORMAL','TEST'));
