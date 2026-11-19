-- Migration: Create research_files and file_usage_log tables
-- Run this with: psql $DATABASE_URL < lib/db-migrations/create-research-files.sql

-- Create research_files table
CREATE TABLE IF NOT EXISTS research_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),

  -- File identification
  file_id VARCHAR(64) UNIQUE NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,

  -- File properties
  file_type VARCHAR(50) NOT NULL,
  mime_type VARCHAR(100),
  file_size BIGINT NOT NULL,

  -- Processing status
  processing_status VARCHAR(20) DEFAULT 'pending',
  -- Values: pending, processing, completed, failed
  processed_at TIMESTAMP,
  processing_error TEXT,

  -- Metadata (stored as JSONB for querying)
  metadata JSONB,

  -- Searchability
  keywords TEXT[],

  -- Timestamps
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed TIMESTAMP,

  -- Usage tracking
  access_count INTEGER DEFAULT 0,
  used_in_generation BOOLEAN DEFAULT false
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_research_files_project ON research_files(project_id);
CREATE INDEX IF NOT EXISTS idx_research_files_type ON research_files(file_type);
CREATE INDEX IF NOT EXISTS idx_research_files_keywords ON research_files USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_research_files_status ON research_files(processing_status);
CREATE INDEX IF NOT EXISTS idx_research_files_metadata ON research_files USING GIN(metadata jsonb_path_ops);

-- Create file_usage_log table
CREATE TABLE IF NOT EXISTS file_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  research_file_id UUID REFERENCES research_files(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  -- Function call details
  function_called VARCHAR(100),

  parameters JSONB,
  result_size INTEGER,

  -- Generation context
  generation_phase VARCHAR(50),

  -- AI usage
  ai_model VARCHAR(100),
  tokens_used INTEGER,

  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for file_usage_log
CREATE INDEX IF NOT EXISTS idx_file_usage_file ON file_usage_log(research_file_id);
CREATE INDEX IF NOT EXISTS idx_file_usage_project ON file_usage_log(project_id);
CREATE INDEX IF NOT EXISTS idx_file_usage_phase ON file_usage_log(generation_phase);
CREATE INDEX IF NOT EXISTS idx_file_usage_accessed ON file_usage_log(accessed_at);

-- Extend projects table
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS has_research_files BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS research_file_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS research_files_size BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS files_last_updated TIMESTAMP;

-- Create a function to update project file counts
CREATE OR REPLACE FUNCTION update_project_file_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE projects
    SET
      has_research_files = true,
      research_file_count = research_file_count + 1,
      research_files_size = research_files_size + NEW.file_size,
      files_last_updated = NOW()
    WHERE id = NEW.project_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE projects
    SET
      research_file_count = GREATEST(0, research_file_count - 1),
      research_files_size = GREATEST(0, research_files_size - OLD.file_size),
      files_last_updated = NOW()
    WHERE id = OLD.project_id;

    -- If no more files, set has_research_files to false
    UPDATE projects
    SET has_research_files = false
    WHERE id = OLD.project_id
    AND research_file_count = 0;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update project stats
DROP TRIGGER IF EXISTS trg_update_project_file_stats ON research_files;
CREATE TRIGGER trg_update_project_file_stats
AFTER INSERT OR DELETE ON research_files
FOR EACH ROW
EXECUTE FUNCTION update_project_file_stats();

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON research_files TO your_app_user;
-- GRANT ALL PRIVILEGES ON file_usage_log TO your_app_user;

COMMENT ON TABLE research_files IS 'Stores metadata and status of research files uploaded by users';
COMMENT ON TABLE file_usage_log IS 'Logs file access during article generation for analytics';
