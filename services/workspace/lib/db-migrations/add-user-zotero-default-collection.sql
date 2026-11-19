-- Add default collection/library selection to user_zotero
-- NULL = My Library (entire library), otherwise Zotero collection key

ALTER TABLE user_zotero
  ADD COLUMN IF NOT EXISTS zotero_default_collection_key VARCHAR(255) NULL;

COMMENT ON COLUMN user_zotero.zotero_default_collection_key IS 'Zotero collection key to use by default; NULL = My Library';
