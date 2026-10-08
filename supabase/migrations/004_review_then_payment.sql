-- Preserve applied migration 003 and all historical provider/payment records.
SET LOCAL search_path=airtime,public;
ALTER TABLE ad_campaigns DROP CONSTRAINT ad_campaigns_status_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_status_check CHECK(status IN ('DRAFT','CREATIVE_UPLOADING','SUBMITTED_FOR_REVIEW','CREATIVE_PENDING','CHANGES_REQUESTED','CREATIVE_REJECTED','APPROVED_AWAITING_PAYMENT','QUOTE_ACTIVE','PAYMENT_VERIFYING','PAID','READY_TO_ACTIVATE','ACTIVATING','UPCOMING','DELIVERING','PAUSED','COMPLETED','ACTIVATION_FAILED','PROVISIONING_FAILED','REFUND_REVIEW','REFUNDED','AWAITING_PAYMENT','COMPLIANCE_REVIEW','APPROVED','SCHEDULING','SCHEDULED','LIVE','REJECTED','REFUND_PENDING'));
CREATE TABLE campaign_provisioning(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL UNIQUE REFERENCES ad_campaigns(id),invoice_id uuid NOT NULL UNIQUE REFERENCES campaign_invoices(id),status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','READY','COMPLETE','FAILED')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 12),error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION provisioning_requires_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='UPDATE' AND (NEW.campaign_id<>OLD.campaign_id OR NEW.invoice_id<>OLD.invoice_id) THEN RAISE EXCEPTION 'Provisioning identity is immutable';END IF; IF NOT EXISTS(SELECT 1 FROM campaign_invoices i JOIN campaign_payments p ON p.invoice_id=i.id WHERE i.id=NEW.invoice_id AND i.campaign_id=NEW.campaign_id AND i.status='PAID' AND i.refund_status='NONE' AND p.status='FINALIZED') THEN RAISE EXCEPTION 'Finalized campaign receipt required';END IF;RETURN NEW;END $$;
CREATE TRIGGER provisioning_receipt BEFORE INSERT OR UPDATE OF campaign_id,invoice_id ON campaign_provisioning FOR EACH ROW EXECUTE FUNCTION provisioning_requires_receipt();
INSERT INTO campaign_provisioning(campaign_id,invoice_id) SELECT i.campaign_id,i.id FROM campaign_invoices i JOIN campaign_payments p ON p.invoice_id=i.id WHERE i.product_version=2 AND i.status='PAID' AND i.refund_status='NONE' AND p.status='FINALIZED' ON CONFLICT DO NOTHING;
ALTER TABLE campaign_provisioning ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON campaign_provisioning FROM PUBLIC;
CREATE FUNCTION provider_campaign_requires_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.external_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.external_id IS NULL) AND NOT EXISTS(SELECT 1 FROM campaign_provisioning j JOIN campaign_payments p ON p.invoice_id=j.invoice_id WHERE j.campaign_id=NEW.campaign_id AND p.status='FINALIZED') THEN RAISE EXCEPTION 'Provider campaign requires finalized payment';END IF;RETURN NEW;END $$;
CREATE TRIGGER paid_provider_campaign BEFORE INSERT OR UPDATE ON vibe_campaigns FOR EACH ROW EXECUTE FUNCTION provider_campaign_requires_payment();
ALTER TABLE vibe_creatives ADD COLUMN provider_review_snapshot jsonb NOT NULL DEFAULT '{}';
UPDATE settings SET config=config-'vibeActivationEnabled' WHERE id=true;

-- Once recorded, a provider identity is never replaced by retries or administrative updates.
CREATE FUNCTION immutable_provider_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.external_id IS NOT NULL AND NEW.external_id IS DISTINCT FROM OLD.external_id THEN RAISE EXCEPTION 'Provider identity is immutable';END IF;RETURN NEW;END $$;
CREATE TRIGGER immutable_vibe_campaign BEFORE UPDATE ON vibe_campaigns FOR EACH ROW EXECUTE FUNCTION immutable_provider_identity();
CREATE TRIGGER immutable_vibe_strategy BEFORE UPDATE ON vibe_strategies FOR EACH ROW EXECUTE FUNCTION immutable_provider_identity();
CREATE TRIGGER immutable_vibe_creative BEFORE UPDATE ON vibe_creatives FOR EACH ROW EXECUTE FUNCTION immutable_provider_identity();
CREATE TRIGGER immutable_vibe_advertiser BEFORE UPDATE ON vibe_advertisers FOR EACH ROW EXECUTE FUNCTION immutable_provider_identity();
