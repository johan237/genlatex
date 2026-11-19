/**
 * Database Migration Endpoint
 * Run this to add new columns to existing users table and create missing tables
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db.js';

export async function POST(request) {
  try {
    console.log('Starting database migrations...');
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Add new columns if they don't exist
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
        ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
        ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free',
        ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ai_tokens_used INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ai_tokens_reset_at TIMESTAMPTZ DEFAULT NOW();
      `);

      // Create project_shares table if it doesn't exist
      // Note: project_id doesn't have a foreign key constraint because projects are stored in files, not DB
      await client.query(`
        CREATE TABLE IF NOT EXISTS project_shares (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL,
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
      
      await client.query('COMMIT');
      
      console.log('Migrations completed successfully!');
      
      return NextResponse.json({
        success: true,
        message: 'Database migrations completed successfully'
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

