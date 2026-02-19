-- Mast Supabase Schema — Phase 5
-- Run this in the Supabase SQL editor to create the required tables.

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  parts JSONB DEFAULT '[]'::jsonb,
  streaming BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Push tokens table
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- No RLS for Phase 5 (single-user). Will add when multi-user is needed.
