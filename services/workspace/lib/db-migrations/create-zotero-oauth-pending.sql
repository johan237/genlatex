-- Migration: Create zotero_oauth_pending table for OAuth request token storage
-- Run with: psql $DATABASE_URL -f lib/db-migrations/create-zotero-oauth-pending.sql

CREATE TABLE IF NOT EXISTS zotero_oauth_pending (
  request_token VARCHAR(255) PRIMARY KEY,
  request_token_secret TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zotero_oauth_pending_user ON zotero_oauth_pending(user_id);
CREATE INDEX IF NOT EXISTS idx_zotero_oauth_pending_created ON zotero_oauth_pending(created_at);

COMMENT ON TABLE zotero_oauth_pending IS 'Stores OAuth 1.0a request token/secret during Zotero connect flow; delete after exchange or TTL';
