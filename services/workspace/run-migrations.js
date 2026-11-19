#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { Pool } from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from genlatex directory so DATABASE_URL is set
const envPath = join(__dirname, '.env');
dotenv.config({ path: envPath });
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to genlatex/.env or set the environment variable.');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

async function runSQLFile(filePath) {
  const client = await pool.connect();
  try {
    console.log(`📄 Running migration: ${filePath}`);
    const sql = readFileSync(filePath, 'utf8');
    await client.query(sql);
    console.log(`✅ Completed: ${filePath}`);
  } catch (error) {
    console.error(`❌ Error running ${filePath}:`, error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 Starting Database Migrations');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Database: ${connectionString.replace(/:[^:@]+@/, ':****@')}`); // Hide password
    
    await client.query('BEGIN');
    
    // Step 1: Enable extensions
    console.log('\n📦 Step 1: Enabling PostgreSQL extensions...');
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    console.log('✅ Extensions enabled');

    // Step 2: Run basic schema migrations (from db.js)
    console.log('\n📦 Step 2: Creating base tables (users, sessions, projects, project_shares)...');
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
      ADD COLUMN IF NOT EXISTS advanced_chat_requests INTEGER DEFAULT 0;
    `);

    // Allow password_hash NULL for OAuth-only and Better Auth (password lives in account table)
    await client.query(`
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    `).catch(() => { /* already nullable */ });

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

    console.log('✅ Base tables created (users, sessions, projects, project_shares, user_zotero)');

    await client.query('COMMIT');
    client.release();

    // Step 3: Run SQL migration files
    console.log('\n📦 Step 3: Running SQL migration files...');
    const migrationsDir = resolve(__dirname, 'lib', 'db-migrations');
    
    // Run migrations in order
    const migrationFiles = [
      'users-password-hash-nullable.sql',
      'create-chat-messages.sql',
      'create-research-files.sql',
      'create-research-intake.sql',
      'research-intake-questions-unique.sql',
      'add-content-hash.sql',
      'enhance-research-files.sql',
      'exclude-chunk-files-from-stats.sql',
      'create-user-zotero.sql',
      'create-zotero-oauth-pending.sql',
      'add-user-zotero-default-collection.sql',
      'add-is-admin.sql'
    ];

    for (const file of migrationFiles) {
      const filePath = resolve(migrationsDir, file);
      if (!existsSync(filePath)) {
        console.warn(`⚠️  Migration file not found: ${filePath}, skipping...`);
        continue;
      }
      await runSQLFile(filePath);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All migrations completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migrations
runMigrations().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
