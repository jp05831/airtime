-- AIRTIME uses one private Vibe advertiser across all creator campaigns; account_id is embedded-only.
SET LOCAL search_path=airtime,public;
ALTER TABLE vibe_advertisers ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE vibe_campaigns ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE vibe_advertisers DROP CONSTRAINT vibe_advertisers_external_id_key;

ALTER TABLE vibe_campaigns ADD COLUMN advertiser_external_id uuid;
UPDATE vibe_campaigns c SET advertiser_external_id=a.external_id FROM vibe_advertisers a WHERE c.advertiser_id=a.id;
CREATE FUNCTION immutable_vibe_campaign_advertiser() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.advertiser_external_id IS NOT NULL AND NEW.advertiser_external_id IS DISTINCT FROM OLD.advertiser_external_id THEN RAISE EXCEPTION 'Provider advertiser identity is immutable';END IF;RETURN NEW;END $$;
CREATE TRIGGER immutable_vibe_campaign_advertiser BEFORE UPDATE ON vibe_campaigns FOR EACH ROW EXECUTE FUNCTION immutable_vibe_campaign_advertiser();
