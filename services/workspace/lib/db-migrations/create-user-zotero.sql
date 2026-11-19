-- Migration: Create user_zotero table for Zotero API key storage
-- Run this with: psql $DATABASE_URL < lib/db-migrations/create-user-zotero.sql

-- Create user_zotero table (one row per user - stores encrypted API key)
CREATE TABLE IF NOT EXISTS user_zotero (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  zotero_api_key_encrypted TEXT NOT NULL,
  zotero_user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for user lookup
CREATE INDEX IF NOT EXISTS idx_user_zotero_user ON user_zotero(user_id);

COMMENT ON TABLE user_zotero IS 'Stores encrypted Zotero API keys for linked user accounts';
