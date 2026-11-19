-- Add is_admin column to users table for admin users (unlimited generations, projects, chat)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
