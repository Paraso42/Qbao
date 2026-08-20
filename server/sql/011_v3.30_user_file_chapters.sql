-- v3.30: 文件池一份文件可关联多个章节（user_files_chapters 关联表）
-- user_files.chapter_id 保留为"最近归属"兼容字段（GET /files 显示用）；
-- 多章节权威数据在此表：AI 出题（/ai/generate 与后台任务队列）按关联表读取章节资料。

CREATE TABLE IF NOT EXISTS user_files_chapters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (file_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_user_files_chapters_user_chapter
    ON user_files_chapters(user_id, chapter_id);

CREATE INDEX IF NOT EXISTS idx_user_files_chapters_file
    ON user_files_chapters(file_id);

-- 回填既有单值归属（历史文件分配保持可用）
INSERT INTO user_files_chapters (user_id, file_id, chapter_id)
SELECT user_id, id, chapter_id FROM user_files WHERE chapter_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 授权给应用角色（同 010 模式：以 postgres 建表后 app 角色无权限）
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qbao') THEN
        GRANT ALL PRIVILEGES ON TABLE user_files_chapters TO qbao;
        GRANT USAGE, SELECT ON SEQUENCE user_files_chapters_id_seq TO qbao;
    END IF;
END $$;
