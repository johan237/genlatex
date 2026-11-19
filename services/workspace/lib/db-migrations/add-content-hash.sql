-- Migration: Add content_hash column for file change detection
-- Run this with: psql $DATABASE_URL < lib/db-migrations/add-content-hash.sql

-- Add content_hash column to research_files table
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- Create index for faster hash lookups
CREATE INDEX IF NOT EXISTS idx_research_files_hash ON research_files(content_hash);

-- Add comment explaining the column
COMMENT ON COLUMN research_files.content_hash IS 'SHA-256 hash of file content for change detection. Null means file needs processing.';
