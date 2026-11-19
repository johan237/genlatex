-- Migration: Research intake workflow session tables
-- Run with: psql $DATABASE_URL < lib/db-migrations/create-research-intake.sql

CREATE TABLE IF NOT EXISTS research_intake_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_name TEXT,
  objective_description TEXT NOT NULL,
  workflow_mode VARCHAR(30) NOT NULL DEFAULT 'ai_generate',
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  total_rounds INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL DEFAULT 6,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_intake_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES research_intake_sessions(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  guidance_note TEXT,
  reflection_prompt TEXT,
  review_focus TEXT,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  allow_other BOOLEAN NOT NULL DEFAULT true,
  search_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_intake_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES research_intake_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES research_intake_questions(id) ON DELETE CASCADE,
  selected_option_id TEXT,
  answer_text TEXT NOT NULL,
  other_text TEXT,
  reflection_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_intake_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES research_intake_sessions(id) ON DELETE CASCADE,
  pertinence_score NUMERIC(5,2),
  summary TEXT,
  what_is_strong JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks_or_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  pivot_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_review_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  consistency_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  adjustment_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  generation_brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  supporting_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_decision VARCHAR(20) NOT NULL DEFAULT 'keep' CHECK (selected_decision IN ('keep', 'pivot')),
  final_objective TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_intake_sessions_user ON research_intake_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_intake_questions_session ON research_intake_questions(session_id, round_number);
CREATE INDEX IF NOT EXISTS idx_research_intake_answers_session ON research_intake_answers(session_id, created_at);

-- Backward-compatible column adds for environments where tables already exist.
ALTER TABLE research_intake_questions ADD COLUMN IF NOT EXISTS guidance_note TEXT;
ALTER TABLE research_intake_questions ADD COLUMN IF NOT EXISTS reflection_prompt TEXT;
ALTER TABLE research_intake_questions ADD COLUMN IF NOT EXISTS review_focus TEXT;
ALTER TABLE research_intake_answers ADD COLUMN IF NOT EXISTS reflection_text TEXT;
ALTER TABLE research_intake_analysis ADD COLUMN IF NOT EXISTS recommended_review_types JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE research_intake_analysis ADD COLUMN IF NOT EXISTS consistency_checks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE research_intake_analysis ADD COLUMN IF NOT EXISTS adjustment_actions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE research_intake_analysis ADD COLUMN IF NOT EXISTS generation_brief JSONB NOT NULL DEFAULT '{}'::jsonb;

