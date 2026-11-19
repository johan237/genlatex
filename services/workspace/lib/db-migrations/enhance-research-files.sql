-- ============================================================================
-- Migration: Enhance Research Files for Advanced Processing Pipeline
-- ============================================================================
--
-- This migration adds support for:
-- 1. File change detection via SHA-256 content hashing
-- 2. Enhanced metadata storage with richer fields
-- 3. Citation graph tracking
-- 4. Processing performance metrics
--
-- Run this with: psql $DATABASE_URL < lib/db-migrations/enhance-research-files.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Add content_hash column for file change detection
-- ============================================================================

ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- Index for fast hash lookups during change detection
CREATE INDEX IF NOT EXISTS idx_research_files_content_hash
ON research_files(content_hash);

COMMENT ON COLUMN research_files.content_hash IS
'SHA-256 hash of file content for change detection. Null means file needs processing.';


-- ============================================================================
-- 2. Add enhanced metadata columns
-- ============================================================================

-- Document classification
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS document_type VARCHAR(50);

ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS methodology VARCHAR(50);

ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS domain VARCHAR(100);

ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS sub_domain VARCHAR(100);

ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS technical_level VARCHAR(20);

ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS language VARCHAR(20) DEFAULT 'english';

-- Author and date extraction
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS extracted_authors TEXT[];

ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS publication_date VARCHAR(50);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_research_files_document_type
ON research_files(document_type);

CREATE INDEX IF NOT EXISTS idx_research_files_domain
ON research_files(domain);

CREATE INDEX IF NOT EXISTS idx_research_files_language
ON research_files(language);

CREATE INDEX IF NOT EXISTS idx_research_files_authors
ON research_files USING GIN(extracted_authors);


-- ============================================================================
-- 3. Add citation tracking columns
-- ============================================================================

-- Number of citations found in the file
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS citation_count INTEGER DEFAULT 0;

-- Whether file has been analyzed for citations
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS citations_extracted BOOLEAN DEFAULT false;

-- Store citation keys as array for quick lookups
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS citation_keys TEXT[];

-- Index for citation key searches
CREATE INDEX IF NOT EXISTS idx_research_files_citation_keys
ON research_files USING GIN(citation_keys);


-- ============================================================================
-- 4. Add processing performance metrics
-- ============================================================================

-- Time taken to process the file (in milliseconds)
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER;

-- Size of extracted text (for analytics)
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS extracted_text_size INTEGER;

-- Number of chunks created
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0;

-- Processor used (e.g., PDFExtractor, LaTeXExtractor)
ALTER TABLE research_files
ADD COLUMN IF NOT EXISTS processor_name VARCHAR(100);


-- ============================================================================
-- 5. Create citation_graph table for cross-file citation tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS citation_graph (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Source file that contains the citation
    source_file_id UUID REFERENCES research_files(id) ON DELETE CASCADE,
    source_file_type VARCHAR(20), -- 'tex', 'bib', etc.

    -- Citation key (e.g., 'smith2020')
    citation_key VARCHAR(255) NOT NULL,

    -- Target bib entry (if matched)
    target_bib_file_id UUID REFERENCES research_files(id) ON DELETE SET NULL,

    -- Section where citation appears (for LaTeX files)
    section_title VARCHAR(500),
    section_level VARCHAR(20),

    -- Citation metadata (from BibTeX if available)
    citation_title TEXT,
    citation_authors TEXT[],
    citation_year VARCHAR(10),
    citation_venue TEXT,
    citation_type VARCHAR(50), -- 'article', 'book', 'inproceedings', etc.

    -- Status
    is_matched BOOLEAN DEFAULT false, -- True if citation key found in bib file

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for citation_graph
CREATE INDEX IF NOT EXISTS idx_citation_graph_project
ON citation_graph(project_id);

CREATE INDEX IF NOT EXISTS idx_citation_graph_citation_key
ON citation_graph(citation_key);

CREATE INDEX IF NOT EXISTS idx_citation_graph_source
ON citation_graph(source_file_id);

CREATE INDEX IF NOT EXISTS idx_citation_graph_matched
ON citation_graph(project_id, is_matched);

COMMENT ON TABLE citation_graph IS
'Tracks citations across LaTeX and BibTeX files, enabling citation graph queries.';


-- ============================================================================
-- 6. Create project_citation_stats view for quick analytics
-- ============================================================================

CREATE OR REPLACE VIEW project_citation_stats AS
SELECT
    p.id AS project_id,
    p.name AS project_name,
    COUNT(DISTINCT cg.citation_key) AS total_citations,
    COUNT(DISTINCT CASE WHEN cg.is_matched THEN cg.citation_key END) AS matched_citations,
    COUNT(DISTINCT CASE WHEN NOT cg.is_matched THEN cg.citation_key END) AS unmatched_citations,
    COUNT(DISTINCT cg.source_file_id) AS files_with_citations,
    ARRAY_AGG(DISTINCT cg.citation_key) FILTER (WHERE NOT cg.is_matched) AS missing_references
FROM projects p
LEFT JOIN citation_graph cg ON p.id = cg.project_id
GROUP BY p.id, p.name;

COMMENT ON VIEW project_citation_stats IS
'Aggregated citation statistics per project for quick dashboard queries.';


-- ============================================================================
-- 7. Update functions for citation graph maintenance
-- ============================================================================

-- Function to update citation_graph when research_files change
CREATE OR REPLACE FUNCTION update_citation_graph_on_file_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Remove citations from deleted file
        DELETE FROM citation_graph WHERE source_file_id = OLD.id;
        RETURN OLD;
    END IF;

    -- For INSERT or UPDATE, the application will handle citation extraction
    -- This trigger just ensures cleanup on delete
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for citation graph cleanup
DROP TRIGGER IF EXISTS trg_citation_graph_cleanup ON research_files;
CREATE TRIGGER trg_citation_graph_cleanup
AFTER DELETE ON research_files
FOR EACH ROW
EXECUTE FUNCTION update_citation_graph_on_file_change();


-- ============================================================================
-- 8. Add helper functions
-- ============================================================================

-- Function to get files that need reprocessing (hash changed or never processed)
CREATE OR REPLACE FUNCTION get_files_needing_processing(p_project_id UUID)
RETURNS TABLE (
    file_id VARCHAR(64),
    file_path TEXT,
    file_name VARCHAR(255),
    file_type VARCHAR(50),
    current_hash VARCHAR(64),
    needs_processing BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rf.file_id,
        rf.file_path,
        rf.file_name,
        rf.file_type,
        rf.content_hash AS current_hash,
        (rf.content_hash IS NULL OR rf.processing_status = 'pending') AS needs_processing
    FROM research_files rf
    WHERE rf.project_id = p_project_id
    ORDER BY rf.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql;


-- Function to get citation graph for a project
CREATE OR REPLACE FUNCTION get_project_citation_graph(p_project_id UUID)
RETURNS TABLE (
    citation_key VARCHAR(255),
    source_sections TEXT[],
    is_matched BOOLEAN,
    bib_title TEXT,
    bib_authors TEXT[],
    bib_year VARCHAR(10),
    usage_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cg.citation_key,
        ARRAY_AGG(DISTINCT cg.section_title) FILTER (WHERE cg.section_title IS NOT NULL) AS source_sections,
        BOOL_OR(cg.is_matched) AS is_matched,
        MAX(cg.citation_title) AS bib_title,
        MAX(cg.citation_authors) AS bib_authors,
        MAX(cg.citation_year) AS bib_year,
        COUNT(*) AS usage_count
    FROM citation_graph cg
    WHERE cg.project_id = p_project_id
    GROUP BY cg.citation_key
    ORDER BY usage_count DESC;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 9. Migrate existing data
-- ============================================================================

-- Populate content_hash from metadata if available (for backwards compatibility)
UPDATE research_files
SET content_hash = metadata->'processing'->>'contentHash'
WHERE content_hash IS NULL
  AND metadata->'processing'->>'contentHash' IS NOT NULL;

-- Populate document_type from metadata if available
UPDATE research_files
SET document_type = metadata->>'documentType'
WHERE document_type IS NULL
  AND metadata->>'documentType' IS NOT NULL;

-- Populate domain from metadata if available
UPDATE research_files
SET domain = metadata->>'domain'
WHERE domain IS NULL
  AND metadata->>'domain' IS NOT NULL;

-- Populate citation_count from metadata if available
UPDATE research_files
SET citation_count = (metadata->'citationInfo'->>'citationCount')::INTEGER
WHERE citation_count = 0
  AND metadata->'citationInfo'->>'citationCount' IS NOT NULL;


-- ============================================================================
-- 10. Grant permissions (adjust as needed for your setup)
-- ============================================================================

-- GRANT ALL PRIVILEGES ON citation_graph TO your_app_user;
-- GRANT SELECT ON project_citation_stats TO your_app_user;


COMMIT;

-- ============================================================================
-- Verification queries (run these to verify migration success)
-- ============================================================================

-- Check new columns exist
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'research_files'
-- AND column_name IN ('content_hash', 'document_type', 'citation_count');

-- Check citation_graph table exists
-- SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'citation_graph');

-- Check functions exist
-- SELECT proname FROM pg_proc WHERE proname IN ('get_files_needing_processing', 'get_project_citation_graph');
