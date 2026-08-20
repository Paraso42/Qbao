-- v3.4: Quiz session status tracking + avatar file storage
ALTER TABLE answer_sessions ADD COLUMN IF NOT EXISTS subject_id VARCHAR(64);
ALTER TABLE answer_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'in_progress';
-- in_progress = actively answering, can be updated
-- completed = quiz finished, immutable
