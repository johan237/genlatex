-- Migration: Create chat_messages table for persistent chat history
-- Run this with: psql $DATABASE_URL < lib/db-migrations/create-chat-messages.sql

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Message content
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  message_type VARCHAR(50) NOT NULL DEFAULT 'user_message',
  -- Values: 'user_message', 'text_response', 'code_modification', 'tool_call'
  
  -- Metadata (stored as JSONB for flexible storage)
  metadata JSONB DEFAULT '{}',
  -- Stores: filesModified, toolCalls, mode, codeSummary, etc.
  
  -- Ordering
  sequence_number INTEGER NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_project ON chat_messages(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sequence ON chat_messages(project_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_chat_messages_type ON chat_messages(message_type);

-- Create function to get next sequence number for a project
CREATE OR REPLACE FUNCTION get_next_chat_sequence(project_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  max_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(sequence_number), 0) INTO max_seq
  FROM chat_messages
  WHERE project_id = project_uuid;
  
  RETURN max_seq + 1;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON chat_messages TO your_app_user;

COMMENT ON TABLE chat_messages IS 'Stores persistent chat history for each project';
COMMENT ON COLUMN chat_messages.message_type IS 'Type of message: user_message, text_response, code_modification, or tool_call';
COMMENT ON COLUMN chat_messages.metadata IS 'JSONB field storing additional context like filesModified, toolCalls, mode, codeSummary';
