-- Add unique constraint on research_intake_questions (session_id, round_number)
-- Prevents duplicate questions per round and enables upsert.
-- Run with: psql $DATABASE_URL < lib/db-migrations/research-intake-questions-unique.sql

-- Remove duplicates: keep the row with the latest created_at per (session_id, round_number)
DELETE FROM research_intake_questions a
USING research_intake_questions b
WHERE a.session_id = b.session_id
  AND a.round_number = b.round_number
  AND a.created_at < b.created_at;

-- Add unique constraint (ignore if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'research_intake_questions_session_round_key'
  ) THEN
    ALTER TABLE research_intake_questions
    ADD CONSTRAINT research_intake_questions_session_round_key UNIQUE (session_id, round_number);
  END IF;
END
$$;
