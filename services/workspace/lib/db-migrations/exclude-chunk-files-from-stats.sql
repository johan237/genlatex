-- Migration: Exclude chunk rows from project file stats
-- Run this with: psql $DATABASE_URL < lib/db-migrations/exclude-chunk-files-from-stats.sql

BEGIN;

CREATE OR REPLACE FUNCTION update_project_file_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.metadata->>'isChunk', NEW.metadata->>'is_chunk', 'false') = 'true' THEN
      RETURN NULL;
    END IF;
    UPDATE projects
    SET
      has_research_files = true,
      research_file_count = research_file_count + 1,
      research_files_size = research_files_size + NEW.file_size,
      files_last_updated = NOW()
    WHERE id = NEW.project_id;
  ELSIF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.metadata->>'isChunk', OLD.metadata->>'is_chunk', 'false') = 'true' THEN
      RETURN NULL;
    END IF;
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

DROP TRIGGER IF EXISTS trg_update_project_file_stats ON research_files;
CREATE TRIGGER trg_update_project_file_stats
AFTER INSERT OR DELETE ON research_files
FOR EACH ROW
EXECUTE FUNCTION update_project_file_stats();

COMMIT;
