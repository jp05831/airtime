-- Forward-only: direct uploads remain quarantined until server validation.
SET LOCAL search_path=airtime,public;
CREATE TABLE creative_upload_tickets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES platform_users(id),
  wallet text NOT NULL REFERENCES platform_wallets(wallet),
  bucket text NOT NULL,
  object_path text NOT NULL UNIQUE,
  final_object_path text NOT NULL UNIQUE,
  thumbnail_path text UNIQUE,
  final_thumbnail_path text UNIQUE,
  original_name text NOT NULL,
  declared_mime text NOT NULL CHECK (declared_mime='video/mp4'),
  declared_bytes bigint NOT NULL CHECK (declared_bytes BETWEEN 12 AND 250000000),
  max_bytes bigint NOT NULL CHECK (max_bytes BETWEEN 1000000 AND 250000000),
  thumbnail_mime text CHECK (thumbnail_mime IN ('image/png','image/jpeg')),
  thumbnail_bytes bigint CHECK (thumbnail_bytes BETWEEN 12 AND 2000000),
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','VALIDATING','VALIDATED','REJECTED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  cleanup_after timestamptz NOT NULL,
  next_cleanup_at timestamptz NOT NULL,
  cleanup_lease_until timestamptz,
  cleaned_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  creative_id uuid UNIQUE REFERENCES campaign_creatives(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (declared_bytes<=max_bytes),
  CHECK (cleanup_after>expires_at),
  CHECK ((creative_id IS NOT NULL)=(status='VALIDATED')),
  CHECK (object_path='creators/'||user_id||'/pending/'||id||'/commercial.mp4'),
  CHECK (final_object_path='creators/'||user_id||'/'||id||'/commercial.mp4'),
  CHECK ((thumbnail_path IS NULL)=(thumbnail_mime IS NULL)),
  CHECK ((thumbnail_path IS NULL)=(thumbnail_bytes IS NULL)),
  CHECK ((thumbnail_path IS NULL)=(final_thumbnail_path IS NULL)),
  CHECK (thumbnail_path IS NULL OR thumbnail_path='creators/'||user_id||'/pending/'||id||'/thumbnail.'||CASE WHEN thumbnail_mime='image/png' THEN 'png' ELSE 'jpg' END),
  CHECK (final_thumbnail_path IS NULL OR final_thumbnail_path='creators/'||user_id||'/'||id||'/thumbnail.'||CASE WHEN thumbnail_mime='image/png' THEN 'png' ELSE 'jpg' END)
);
ALTER TABLE creative_upload_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON creative_upload_tickets FROM PUBLIC;
CREATE INDEX creative_upload_cleanup ON creative_upload_tickets(next_cleanup_at) WHERE cleaned_at IS NULL;
CREATE INDEX creator_pending_uploads ON creative_upload_tickets(user_id,created_at DESC);

CREATE FUNCTION immutable_upload_ticket() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.user_id,NEW.wallet,NEW.bucket,NEW.object_path,NEW.final_object_path,NEW.thumbnail_path,NEW.final_thumbnail_path,NEW.original_name,NEW.declared_mime,NEW.declared_bytes,NEW.max_bytes,NEW.thumbnail_mime,NEW.thumbnail_bytes,NEW.expires_at,NEW.cleanup_after)
     IS DISTINCT FROM
     (OLD.id,OLD.user_id,OLD.wallet,OLD.bucket,OLD.object_path,OLD.final_object_path,OLD.thumbnail_path,OLD.final_thumbnail_path,OLD.original_name,OLD.declared_mime,OLD.declared_bytes,OLD.max_bytes,OLD.thumbnail_mime,OLD.thumbnail_bytes,OLD.expires_at,OLD.cleanup_after)
  THEN RAISE EXCEPTION 'Upload ticket identity is immutable'; END IF;
  IF OLD.status IN ('VALIDATED','REJECTED','EXPIRED') AND NEW.status<>OLD.status
  THEN RAISE EXCEPTION 'Upload ticket is already consumed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_upload_ticket BEFORE UPDATE ON creative_upload_tickets FOR EACH ROW EXECUTE FUNCTION immutable_upload_ticket();

-- Supabase-only hardening; ordinary PostgreSQL/PGlite has no storage schema.
-- Signed upload/read endpoints use Storage's server-side authority, not browser
-- Auth grants. Even pre-existing permissive policies must not grant direct writes
-- or reads of creator objects. Service-role access continues to bypass RLS.
DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY airtime_creator_objects_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO PUBLIC USING (name NOT LIKE ''creators/%'') WITH CHECK (name NOT LIKE ''creators/%'')';
  END IF;
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE 'UPDATE storage.buckets SET public=false WHERE id=''airtime-proof''';
  END IF;
END $$;
