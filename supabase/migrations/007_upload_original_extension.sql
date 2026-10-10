-- Forward-only audit metadata derived from the immutable original name.
-- The extension is never used as proof of media or as a storage path.
SET LOCAL search_path=airtime,public;
ALTER TABLE creative_upload_tickets
  ADD COLUMN original_extension text GENERATED ALWAYS AS
    (COALESCE(substring(original_name FROM '\.([^./\\]+)$'), '')) STORED;
