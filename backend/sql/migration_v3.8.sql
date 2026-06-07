-- Migration v3.8: User Feedback / Issue Reporting System
-- Created: 2026-06-07

CREATE TABLE IF NOT EXISTS issues (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unread',
  has_new_for_user BOOLEAN NOT NULL DEFAULT false,
  has_new_for_admin BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issue_messages (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_issues_user_id ON issues(user_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issue_messages_issue_id ON issue_messages(issue_id);
ALTER TABLE issue_messages ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
