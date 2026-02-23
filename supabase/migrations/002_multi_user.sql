-- Mast Multi-User Migration
-- Adds user_id columns, device_keys table, and Row Level Security.
-- Run in Supabase SQL editor after 001_initial_schema.sql.

-- 1. device_keys table — maps daemon device keys to authenticated users
CREATE TABLE IF NOT EXISTS device_keys (
  key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  paired_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_keys_user_id ON device_keys(user_id);

-- 2. Add user_id to sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- 3. Add user_id to push_tokens
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);

-- 4. Enable Row Level Security on all tables
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_keys ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies — sessions
CREATE POLICY sessions_select ON sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY sessions_insert ON sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY sessions_update ON sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY sessions_delete ON sessions FOR DELETE
  USING (auth.uid() = user_id);

-- 6. RLS Policies — messages (scoped through session ownership)
CREATE POLICY messages_select ON messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM sessions WHERE sessions.id = messages.session_id AND sessions.user_id = auth.uid()
  ));

CREATE POLICY messages_insert ON messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM sessions WHERE sessions.id = messages.session_id AND sessions.user_id = auth.uid()
  ));

CREATE POLICY messages_update ON messages FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM sessions WHERE sessions.id = messages.session_id AND sessions.user_id = auth.uid()
  ));

CREATE POLICY messages_delete ON messages FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM sessions WHERE sessions.id = messages.session_id AND sessions.user_id = auth.uid()
  ));

-- 7. RLS Policies — push_tokens
CREATE POLICY push_tokens_select ON push_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY push_tokens_insert ON push_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY push_tokens_delete ON push_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- 8. RLS Policies — device_keys
CREATE POLICY device_keys_select ON device_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY device_keys_insert ON device_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY device_keys_delete ON device_keys FOR DELETE
  USING (auth.uid() = user_id);
