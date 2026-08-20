-- v3.27: 服务端 AI 任务队列 v1。
-- v1 仅支持非流式生成任务；流式任务仍走现有 /ai/generate SSE。

CREATE TABLE IF NOT EXISTS ai_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chapter_id VARCHAR(64),
    status VARCHAR(16) NOT NULL DEFAULT 'queued', -- queued | running | completed | failed | canceled
    request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_json JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_user_status
    ON ai_tasks(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_status
    ON ai_tasks(status, id);

-- 授权给应用角色（避免"数据库错误":迁移以 superuser 建表后 app 角色无权限）。
-- 其他业务表由应用角色自建自持，但 ai_tasks 由迁移(以 postgres)创建，
-- 若不授权则 INSERT/SELECT 都会 Permission denied。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qbao') THEN
        GRANT ALL PRIVILEGES ON TABLE ai_tasks TO qbao;
        GRANT USAGE, SELECT ON SEQUENCE ai_tasks_id_seq TO qbao;
    END IF;
END $$;
