// SPDX-License-Identifier: MIT

import { Pool } from 'pg';
import crypto from 'crypto';

const connectionString = (() => {
  const url = process.env.DATABASE_URL;
  if (!url && process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL environment variable is required in production');
  }
  return url || 'postgresql://user:pass@localhost:5432/genlatex';
})();

export const pool = new Pool({ connectionString });

let schemaRepairPromise = null;

function shouldRetryWithMigrations(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || message.includes('does not exist');
}

async function runMigrationsOnceForRepair() {
  if (!schemaRepairPromise) {
    schemaRepairPromise = runMigrations()
      .catch((err) => {
        schemaRepairPromise = null;
        throw err;
      })
      .then((value) => {
        schemaRepairPromise = null;
        return value;
      });
  }
  return schemaRepairPromise;
}

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Enable gen_random_uuid if available; fallback to uuid-ossp if needed
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT,
        email TEXT UNIQUE NOT NULL,
        email_verified TIMESTAMPTZ,
        image TEXT,
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_pro BOOLEAN DEFAULT FALSE,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        subscription_status TEXT DEFAULT 'free',
        subscription_expires_at TIMESTAMPTZ,
        ai_tokens_used INTEGER DEFAULT 0,
        ai_tokens_reset_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Allow password_hash to be NULL for OAuth-only users (Better Auth)
    await client.query(`
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    `).catch(() => { /* column may already be nullable */ });

    // Add new columns to existing users table if they don't exist
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ai_tokens_used INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ai_tokens_reset_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS paper_credits_used INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS paper_credits_reset_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS daily_chat_requests INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS daily_chat_reset_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS advanced_chat_requests INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_token TEXT PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        expires TIMESTAMPTZ NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Create project_shares table for sharing functionality
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_shares (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        shared_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        shared_with_email TEXT NOT NULL,
        shared_with_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        token TEXT UNIQUE NOT NULL,
        permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        accessed_at TIMESTAMPTZ,
        UNIQUE(project_id, shared_with_email)
      );
    `);

    // Research intake workflow tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS research_intake_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_name TEXT,
        objective_description TEXT NOT NULL,
        workflow_mode TEXT NOT NULL DEFAULT 'ai_generate',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
        total_rounds INTEGER NOT NULL DEFAULT 0,
        max_rounds INTEGER NOT NULL DEFAULT 6,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
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
    `);
    await client.query(`
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
    `);
    await client.query(`
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
        selected_decision TEXT NOT NULL DEFAULT 'keep' CHECK (selected_decision IN ('keep', 'pivot')),
        final_objective TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE research_intake_questions ADD COLUMN IF NOT EXISTS guidance_note TEXT`);
    await client.query(`ALTER TABLE research_intake_questions ADD COLUMN IF NOT EXISTS reflection_prompt TEXT`);
    await client.query(`ALTER TABLE research_intake_questions ADD COLUMN IF NOT EXISTS review_focus TEXT`);
    await client.query(`ALTER TABLE research_intake_answers ADD COLUMN IF NOT EXISTS reflection_text TEXT`);
    await client.query(`ALTER TABLE research_intake_analysis ADD COLUMN IF NOT EXISTS recommended_review_types JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE research_intake_analysis ADD COLUMN IF NOT EXISTS consistency_checks JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE research_intake_analysis ADD COLUMN IF NOT EXISTS adjustment_actions JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE research_intake_analysis ADD COLUMN IF NOT EXISTS generation_brief JSONB NOT NULL DEFAULT '{}'::jsonb`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_zotero (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        zotero_api_key_encrypted TEXT NOT NULL,
        zotero_user_id VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_zotero_user ON user_zotero(user_id)`);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// Research Files Functions
// ============================================================================

/**
 * Create a new research file record
 */
export async function createResearchFile(projectId, userId, fileData) {
  const {
    fileId,
    fileName,
    originalName,
    filePath,
    fileType,
    mimeType,
    fileSize,
    processingStatus = 'pending'
  } = fileData;

  const result = await pool.query(
    `INSERT INTO research_files (
      project_id, user_id, file_id, file_name, original_name,
      file_path, file_type, mime_type, file_size, processing_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [projectId, userId, fileId, fileName, originalName, filePath, fileType, mimeType, fileSize, processingStatus]
  );

  return result.rows[0];
}

/**
 * Create or update a research file record (upsert by file_id).
 */
export async function upsertResearchFile(projectId, userId, fileData) {
  const {
    fileId,
    fileName,
    originalName,
    filePath,
    fileType,
    mimeType,
    fileSize,
    processingStatus = 'pending',
    metadata = null,
    keywords = null,
    processedAt = null,
    processingError = null,
    contentHash = null
  } = fileData;

  const metadataJson = metadata === null || metadata === undefined ? null : JSON.stringify(metadata);
  const keywordsValue = Array.isArray(keywords) ? keywords : (keywords ? [keywords] : null);

  const result = await pool.query(
    `INSERT INTO research_files (
      project_id, user_id, file_id, file_name, original_name,
      file_path, file_type, mime_type, file_size, processing_status,
      metadata, keywords, processed_at, processing_error, content_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (file_id) DO UPDATE SET
      file_name = EXCLUDED.file_name,
      original_name = EXCLUDED.original_name,
      file_path = EXCLUDED.file_path,
      file_type = EXCLUDED.file_type,
      mime_type = EXCLUDED.mime_type,
      processing_status = EXCLUDED.processing_status,
      processed_at = EXCLUDED.processed_at,
      processing_error = EXCLUDED.processing_error,
      metadata = COALESCE(EXCLUDED.metadata, research_files.metadata),
      keywords = COALESCE(EXCLUDED.keywords, research_files.keywords),
      content_hash = COALESCE(EXCLUDED.content_hash, research_files.content_hash)
    RETURNING *`,
    [
      projectId,
      userId,
      fileId,
      fileName,
      originalName,
      filePath,
      fileType,
      mimeType,
      fileSize,
      processingStatus,
      metadataJson,
      keywordsValue,
      processedAt,
      processingError,
      contentHash
    ]
  );

  return result.rows[0];
}

/**
 * Get all research files for a project
 */
export async function getResearchFiles(projectId, options = {}) {
  const includeChunks = options?.includeChunks === true;
  const chunkFilter = includeChunks
    ? ''
    : `AND COALESCE(metadata->>'isChunk', 'false') <> 'true'`;
  const result = await pool.query(
    `SELECT * FROM research_files
     WHERE project_id = $1
     ${chunkFilter}
     ORDER BY uploaded_at DESC`,
    [projectId]
  );

  return result.rows;
}

/**
 * Get a single research file by ID
 */
export async function getResearchFile(fileId) {
  const result = await pool.query(
    `SELECT * FROM research_files WHERE file_id = $1`,
    [fileId]
  );

  return result.rows[0];
}

/**
 * Update research file metadata
 */
export async function updateResearchFileMetadata(fileId, updates) {
  const {
    metadata,
    keywords,
    processingStatus,
    processedAt,
    processingError,
    contentHash
  } = updates;

  const setParts = [];
  const values = [];
  let paramCount = 1;

  if (metadata !== undefined) {
    setParts.push(`metadata = $${paramCount++}`);
    values.push(JSON.stringify(metadata));
  }

  if (keywords !== undefined) {
    setParts.push(`keywords = $${paramCount++}`);
    values.push(keywords);
  }

  if (processingStatus !== undefined) {
    setParts.push(`processing_status = $${paramCount++}`);
    values.push(processingStatus);
  }

  if (processedAt !== undefined) {
    setParts.push(`processed_at = $${paramCount++}`);
    values.push(processedAt);
  }

  if (processingError !== undefined) {
    setParts.push(`processing_error = $${paramCount++}`);
    values.push(processingError);
  }

  if (contentHash !== undefined) {
    setParts.push(`content_hash = $${paramCount++}`);
    values.push(contentHash);
  }

  if (setParts.length === 0) {
    throw new Error('No updates provided');
  }

  values.push(fileId);

  const query = `
    UPDATE research_files
    SET ${setParts.join(', ')}
    WHERE file_id = $${paramCount}
    RETURNING *
  `;

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Update research file fields beyond metadata (path/name/type/status).
 */
export async function updateResearchFileRecord(fileId, updates) {
  const setParts = [];
  const values = [];
  let paramCount = 1;

  const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);

  if (has('fileName')) {
    setParts.push(`file_name = $${paramCount++}`);
    values.push(updates.fileName);
  }
  if (has('originalName')) {
    setParts.push(`original_name = $${paramCount++}`);
    values.push(updates.originalName);
  }
  if (has('filePath')) {
    setParts.push(`file_path = $${paramCount++}`);
    values.push(updates.filePath);
  }
  if (has('fileType')) {
    setParts.push(`file_type = $${paramCount++}`);
    values.push(updates.fileType);
  }
  if (has('mimeType')) {
    setParts.push(`mime_type = $${paramCount++}`);
    values.push(updates.mimeType);
  }
  if (has('fileSize')) {
    setParts.push(`file_size = $${paramCount++}`);
    values.push(updates.fileSize);
  }
  if (has('metadata')) {
    setParts.push(`metadata = $${paramCount++}`);
    values.push(updates.metadata === null ? null : JSON.stringify(updates.metadata));
  }
  if (has('keywords')) {
    setParts.push(`keywords = $${paramCount++}`);
    values.push(updates.keywords);
  }
  if (has('processingStatus')) {
    setParts.push(`processing_status = $${paramCount++}`);
    values.push(updates.processingStatus);
  }
  if (has('processedAt')) {
    setParts.push(`processed_at = $${paramCount++}`);
    values.push(updates.processedAt);
  }
  if (has('processingError')) {
    setParts.push(`processing_error = $${paramCount++}`);
    values.push(updates.processingError);
  }
  if (has('contentHash')) {
    setParts.push(`content_hash = $${paramCount++}`);
    values.push(updates.contentHash);
  }

  if (setParts.length === 0) {
    throw new Error('No updates provided');
  }

  values.push(fileId);

  const query = `
    UPDATE research_files
    SET ${setParts.join(', ')}
    WHERE file_id = $${paramCount}
    RETURNING *
  `;

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Delete a research file
 */
export async function deleteResearchFile(fileId) {
  const result = await pool.query(
    `DELETE FROM research_files WHERE file_id = $1 RETURNING *`,
    [fileId]
  );

  return result.rows[0];
}

export async function deleteResearchFileChunksByParent(projectId, parentFileId) {
  const result = await pool.query(
    `DELETE FROM research_files
     WHERE project_id = $1
       AND metadata->>'isChunk' = 'true'
       AND metadata->>'parentFileId' = $2`,
    [projectId, parentFileId]
  );
  return result.rowCount ?? 0;
}

/**
 * Log file usage during generation
 */
export async function logFileUsage(researchFileId, projectId, userId, functionCalled, parameters) {
  const result = await pool.query(
    `INSERT INTO file_usage_log (
      research_file_id, project_id, user_id, function_called, parameters
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [researchFileId, projectId, userId, functionCalled, JSON.stringify(parameters)]
  );

  // Update access count on the file
  await pool.query(
    `UPDATE research_files
     SET access_count = access_count + 1,
         last_accessed = NOW(),
         used_in_generation = true
     WHERE id = $1`,
    [researchFileId]
  );

  return result.rows[0];
}

/**
 * Get project by ID (from database)
 */
export async function getProject(projectId) {
  const result = await pool.query(
    `SELECT * FROM projects WHERE id = $1`,
    [projectId]
  );

  return result.rows[0];
}

/**
 * Get all projects owned by a user (from database)
 */
export async function getProjectsByUserId(userId) {
  const result = await pool.query(
    `SELECT id, user_id, name, created_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Get total storage used by a user across all projects (research_files_size sum)
 */
export async function getTotalStorageUsedByUser(userId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(research_files_size, 0)), 0)::bigint AS total
     FROM projects WHERE user_id = $1`,
    [userId]
  );
  return Number(result.rows[0]?.total ?? 0);
}

/**
 * Get user by ID
 */
export async function getUser(userId) {
  const result = await pool.query(
    `SELECT * FROM users WHERE id = $1`,
    [userId]
  );

  return result.rows[0];
}

// ============================================================================
// Research Intake Functions
// ============================================================================

export async function createResearchIntakeSession(userId, payload = {}) {
  const params = [
    userId,
    payload.projectName || null,
    payload.objectiveDescription || '',
    payload.workflowMode || 'ai_generate',
    payload.maxRounds || 6
  ];
  const query = `INSERT INTO research_intake_sessions (user_id, project_name, objective_description, workflow_mode, max_rounds)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`;

  try {
    const result = await pool.query(query, params);
    return result.rows[0];
  } catch (error) {
    if (!shouldRetryWithMigrations(error)) throw error;
    console.warn('[db] Research intake table missing or schema drift detected. Running migrations and retrying...');
    await runMigrationsOnceForRepair();
    const retryResult = await pool.query(query, params);
    return retryResult.rows[0];
  }
}

export async function getResearchIntakeSession(sessionId, userId) {
  const result = await pool.query(
    `SELECT * FROM research_intake_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  return result.rows[0] || null;
}

export async function addResearchIntakeQuestion(
  sessionId,
  roundNumber,
  questionText,
  options = [],
  allowOther = true,
  searchContext = {},
  guidanceNote = null,
  reflectionPrompt = null,
  reviewFocus = null
) {
  const params = [
    sessionId,
    roundNumber,
    questionText,
    JSON.stringify(options),
    allowOther,
    JSON.stringify(searchContext || {}),
    guidanceNote,
    reflectionPrompt,
    reviewFocus
  ];
  let result;
  try {
    result = await pool.query(
      `INSERT INTO research_intake_questions (
        session_id, round_number, question_text, options, allow_other, search_context,
        guidance_note, reflection_prompt, review_focus
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (session_id, round_number)
       DO UPDATE SET
         question_text = EXCLUDED.question_text,
         options = EXCLUDED.options,
         allow_other = EXCLUDED.allow_other,
         search_context = EXCLUDED.search_context,
         guidance_note = EXCLUDED.guidance_note,
         reflection_prompt = EXCLUDED.reflection_prompt,
         review_focus = EXCLUDED.review_focus
       RETURNING *`,
      params
    );
  } catch (err) {
    const isNoConflictTarget = err.message && (
      err.message.includes('no unique or exclusion constraint') ||
      err.message.includes('ON CONFLICT')
    );
    if (isNoConflictTarget) {
      result = await pool.query(
        `INSERT INTO research_intake_questions (
          session_id, round_number, question_text, options, allow_other, search_context,
          guidance_note, reflection_prompt, review_focus
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        params
      );
    } else {
      throw err;
    }
  }
  await pool.query(
    `UPDATE research_intake_sessions
     SET total_rounds = GREATEST(total_rounds, $2), updated_at = NOW()
     WHERE id = $1`,
    [sessionId, roundNumber]
  );
  return result.rows[0];
}

export async function getLatestResearchIntakeQuestion(sessionId) {
  const result = await pool.query(
    `SELECT * FROM research_intake_questions
     WHERE session_id = $1
     ORDER BY round_number DESC, created_at DESC
     LIMIT 1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

export async function getResearchIntakeQuestionById(sessionId, questionId) {
  const result = await pool.query(
    `SELECT * FROM research_intake_questions WHERE id = $1 AND session_id = $2`,
    [questionId, sessionId]
  );
  return result.rows[0] || null;
}

export async function addResearchIntakeAnswer(sessionId, questionId, answerPayload = {}) {
  const result = await pool.query(
    `INSERT INTO research_intake_answers (session_id, question_id, selected_option_id, answer_text, other_text, reflection_text)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      sessionId,
      questionId,
      answerPayload.selectedOptionId || null,
      answerPayload.answerText || '',
      answerPayload.otherText || null,
      answerPayload.reflectionText || null
    ]
  );
  await pool.query(
    `UPDATE research_intake_sessions SET updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );
  return result.rows[0];
}

export async function listResearchIntakeAnswers(sessionId) {
  const result = await pool.query(
    `SELECT a.*, q.round_number, q.question_text, q.review_focus, q.reflection_prompt
     FROM research_intake_answers a
     JOIN research_intake_questions q ON q.id = a.question_id
     WHERE a.session_id = $1
     ORDER BY q.round_number ASC, a.created_at ASC`,
    [sessionId]
  );
  return result.rows;
}

export async function upsertResearchIntakeAnalysis(sessionId, analysis = {}) {
  const result = await pool.query(
    `INSERT INTO research_intake_analysis (
      session_id, pertinence_score, summary, what_is_strong, risks_or_gaps,
      pivot_suggestions, recommended_review_types, consistency_checks, adjustment_actions,
      generation_brief, supporting_references, selected_decision, final_objective, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
     ON CONFLICT (session_id) DO UPDATE SET
      pertinence_score = EXCLUDED.pertinence_score,
      summary = EXCLUDED.summary,
      what_is_strong = EXCLUDED.what_is_strong,
      risks_or_gaps = EXCLUDED.risks_or_gaps,
      pivot_suggestions = EXCLUDED.pivot_suggestions,
      recommended_review_types = EXCLUDED.recommended_review_types,
      consistency_checks = EXCLUDED.consistency_checks,
      adjustment_actions = EXCLUDED.adjustment_actions,
      generation_brief = EXCLUDED.generation_brief,
      supporting_references = EXCLUDED.supporting_references,
      selected_decision = EXCLUDED.selected_decision,
      final_objective = EXCLUDED.final_objective,
      updated_at = NOW()
     RETURNING *`,
    [
      sessionId,
      analysis.pertinenceScore ?? null,
      analysis.summary || null,
      JSON.stringify(analysis.whatIsStrong || []),
      JSON.stringify(analysis.risksOrGaps || []),
      JSON.stringify(analysis.pivotSuggestions || []),
      JSON.stringify(analysis.recommendedReviewTypes || []),
      JSON.stringify(analysis.consistencyChecks || []),
      JSON.stringify(analysis.adjustmentActions || []),
      JSON.stringify(analysis.generationBrief || {}),
      JSON.stringify(analysis.supportingReferences || []),
      analysis.selectedDecision || 'keep',
      analysis.finalObjective || null
    ]
  );
  await pool.query(
    `UPDATE research_intake_sessions
     SET status = 'completed', updated_at = NOW()
     WHERE id = $1`,
    [sessionId]
  );
  return result.rows[0];
}

export async function getResearchIntakeAnalysis(sessionId) {
  const result = await pool.query(
    `SELECT * FROM research_intake_analysis WHERE session_id = $1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

// ============================================================================
// User Zotero Functions (encrypted API key storage)
// ============================================================================

const ZOTERO_ALGORITHM = 'aes-256-gcm';
const ZOTERO_IV_LENGTH = 16;
const ZOTERO_TAG_LENGTH = 16;

function getZoteroEncryptionKey() {
  const key = process.env.ZOTERO_ENCRYPTION_KEY;
  if (!key || key.length < 64) {
    throw new Error('ZOTERO_ENCRYPTION_KEY must be set (64 hex chars for 32 bytes)');
  }
  return Buffer.from(key.slice(0, 64), 'hex');
}

function encryptZoteroApiKey(plaintext) {
  const key = getZoteroEncryptionKey();
  const iv = crypto.randomBytes(ZOTERO_IV_LENGTH);
  const cipher = crypto.createCipheriv(ZOTERO_ALGORITHM, key, iv, { authTagLength: ZOTERO_TAG_LENGTH });
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

function decryptZoteroApiKey(ciphertext) {
  const key = getZoteroEncryptionKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ZOTERO_ALGORITHM, key, iv, { authTagLength: ZOTERO_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
}

/**
 * Get user's Zotero connection (with decrypted API key).
 * Returns null if the user_zotero table does not exist (migrations not run).
 */
export async function getUserZotero(userId) {
  try {
    const result = await pool.query(
      `SELECT * FROM user_zotero WHERE user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) return null;
    const apiKey = decryptZoteroApiKey(row.zotero_api_key_encrypted);
    return {
      userId: row.user_id,
      zoteroUserId: row.zotero_user_id,
      apiKey,
      defaultCollectionKey: row.zotero_default_collection_key ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (e) {
    // Table missing (42P01) = migrations not run; treat as no Zotero linked
    if (e.code === '42P01') return null;
    console.error('Failed to get/decrypt Zotero API key:', e.message);
    return null;
  }
}

/**
 * Upsert user's Zotero connection (encrypts and stores API key)
 */
export async function upsertUserZotero(userId, apiKey, zoteroUserId) {
  const encrypted = encryptZoteroApiKey(apiKey);
  const result = await pool.query(
    `INSERT INTO user_zotero (user_id, zotero_api_key_encrypted, zotero_user_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       zotero_api_key_encrypted = EXCLUDED.zotero_api_key_encrypted,
       zotero_user_id = EXCLUDED.zotero_user_id,
       updated_at = NOW()
     RETURNING *`,
    [userId, encrypted, String(zoteroUserId)]
  );
  return result.rows[0];
}

/**
 * Update user's default Zotero collection/library (null = My Library)
 */
export async function updateUserZoteroDefaultCollection(userId, collectionKey) {
  const result = await pool.query(
    `UPDATE user_zotero SET zotero_default_collection_key = $2, updated_at = NOW()
     WHERE user_id = $1 RETURNING *`,
    [userId, collectionKey === '' || collectionKey === null ? null : collectionKey]
  );
  return result.rows[0];
}

/**
 * Delete user's Zotero connection
 */
export async function deleteUserZotero(userId) {
  const result = await pool.query(
    `DELETE FROM user_zotero WHERE user_id = $1 RETURNING *`,
    [userId]
  );
  return result.rows[0];
}

/**
 * Save pending Zotero OAuth request token (for callback exchange)
 */
export async function saveZoteroOAuthPending(requestToken, requestTokenSecret, userId) {
  try {
    await pool.query(
      `INSERT INTO zotero_oauth_pending (request_token, request_token_secret, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (request_token) DO UPDATE SET
         request_token_secret = EXCLUDED.request_token_secret,
         user_id = EXCLUDED.user_id,
         created_at = NOW()`,
      [requestToken, requestTokenSecret, userId]
    );
  } catch (e) {
    if (e.code === '42P01') return false; // table missing
    throw e;
  }
  return true;
}

/**
 * Get and delete pending Zotero OAuth state by request token
 */
export async function consumeZoteroOAuthPending(requestToken) {
  try {
    const result = await pool.query(
      `DELETE FROM zotero_oauth_pending
       WHERE request_token = $1 AND created_at > NOW() - INTERVAL '15 minutes'
       RETURNING request_token_secret, user_id`,
      [requestToken]
    );
    const row = result.rows[0];
    return row ? { requestTokenSecret: row.request_token_secret, userId: row.user_id } : null;
  } catch (e) {
    if (e.code === '42P01') return null;
    throw e;
  }
}

// ============================================================================
// Chat Messages Functions
// ============================================================================

/**
 * Save a chat message to the database
 */
export async function saveChatMessage(projectId, userId, role, content, messageType = 'user_message', metadata = {}) {
  const client = await pool.connect();
  try {
    // Get next sequence number - try using function first, fallback to manual query
    let sequenceNumber;
    try {
      const seqResult = await client.query(
        `SELECT get_next_chat_sequence($1) as next_seq`,
        [projectId]
      );
      sequenceNumber = seqResult.rows[0].next_seq;
    } catch (funcError) {
      // Function might not exist yet - use manual query
      const maxSeq = await client.query(
        `SELECT COALESCE(MAX(sequence_number), 0) as max_seq 
         FROM chat_messages WHERE project_id = $1`,
        [projectId]
      );
      sequenceNumber = parseInt(maxSeq.rows[0].max_seq, 10) + 1;
    }

    const result = await client.query(
      `INSERT INTO chat_messages (
        project_id, user_id, role, content, message_type, metadata, sequence_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [projectId, userId, role, content, messageType, JSON.stringify(metadata), sequenceNumber]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get chat messages for a project (ordered by sequence_number)
 */
export async function getChatMessages(projectId, limit = 50) {
  try {
    const result = await pool.query(
      `SELECT * FROM chat_messages
       WHERE project_id = $1
       ORDER BY sequence_number ASC
       LIMIT $2`,
      [projectId, limit]
    );

    return result?.rows ?? [];
  } catch (error) {
    // Table doesn't exist (42P01) - migrations not run yet, return empty array
    if (error.code === '42P01') {
      console.log('Chat messages table not yet created, returning empty array');
      return [];
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Get total message count for a project
 */
export async function getChatMessageCount(projectId) {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM chat_messages WHERE project_id = $1`,
    [projectId]
  );

  return parseInt(result.rows[0].count, 10);
}

/**
 * Delete all chat messages for a project (clear history)
 */
export async function deleteChatMessages(projectId) {
  const result = await pool.query(
    `DELETE FROM chat_messages WHERE project_id = $1`,
    [projectId]
  );
  return result.rowCount ?? 0;
}

/**
 * Get chat history formatted for AI context
 * Returns up to 20 most recent messages
 */
export async function getChatHistoryForContext(projectId) {
  const limit = 20;
  const result = await pool.query(
    `SELECT * FROM chat_messages
     WHERE project_id = $1
     ORDER BY sequence_number DESC
     LIMIT $2`,
    [projectId, limit]
  );
  const messages = result.rows.reverse();

  // Format messages for AI context
  return messages.map(msg => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    message_type: msg.message_type,
    metadata: (() => {
      if (msg.metadata === null || msg.metadata === undefined) return {};
      if (typeof msg.metadata !== 'string') return msg.metadata;
      try {
        return JSON.parse(msg.metadata);
      } catch {
        return {};
      }
    })(),
    created_at: msg.created_at
  }));
}
