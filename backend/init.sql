CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_data (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT user_data_unique_user UNIQUE (user_id)
);
CREATE TABLE IF NOT EXISTS backups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(256) NOT NULL DEFAULT '',
  state_json JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_backups_uid ON backups(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS shared_banks (
  id SERIAL PRIMARY KEY,
  share_code VARCHAR(16) UNIQUE NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(256) NOT NULL,
  questions JSONB NOT NULL,
  password VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  download_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ai_request_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  model VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'ok',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
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
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_points INTEGER NOT NULL DEFAULT 0;
