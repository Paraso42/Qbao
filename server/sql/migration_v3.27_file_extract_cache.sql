-- v3.27: user_files 文件提取缓存列。
-- 旧行全部为 pending；下一次 AI 出题时会按需提取并回填。
-- 幂等，可重复执行。

ALTER TABLE user_files ADD COLUMN IF NOT EXISTS extract_status VARCHAR(16) NOT NULL DEFAULT 'pending';
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS text_hash VARCHAR(128);
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS source_mtime_ms BIGINT;
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS source_size BIGINT;

CREATE INDEX IF NOT EXISTS idx_user_files_extract_status
  ON user_files(user_id, extract_status);
