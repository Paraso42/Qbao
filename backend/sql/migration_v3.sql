-- Qbao v3.3 Migration: Answer persistence + File management
-- Run against test database first: psql -U qbao -d qbao_test -f migration_v3.sql

-- 1. Answer sessions: server-side persistence for quiz progress
CREATE TABLE IF NOT EXISTS answer_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id VARCHAR(64) NOT NULL,
  session_name VARCHAR(256) NOT NULL DEFAULT '',
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_answer_sessions_uid ON answer_sessions(user_id);

-- 2. User file pool
CREATE TABLE IF NOT EXISTS user_files (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name VARCHAR(512) NOT NULL,
  stored_name VARCHAR(128) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_path VARCHAR(1024) NOT NULL,
  mime_type VARCHAR(128) NOT NULL DEFAULT '',
  chapter_id VARCHAR(64),
  in_pool BOOLEAN NOT NULL DEFAULT true,
  pool_expires_at TIMESTAMP,
  points_extended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_files_uid ON user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_chapter ON user_files(user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_user_files_pool ON user_files(user_id, in_pool) WHERE in_pool = true;

-- 3. Storage points column on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_points INTEGER NOT NULL DEFAULT 0;
