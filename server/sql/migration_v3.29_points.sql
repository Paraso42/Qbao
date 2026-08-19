-- v3.29: 积分系统（points_ledger 台账 + answer_sessions 答题奖励快照 + ai_request_log 配额索引）。
-- 余额缓存字段 users.storage_points 已于 v3 预留；本迁移补齐台账/幂等/限额支撑。

CREATE TABLE IF NOT EXISTS points_ledger (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,                      -- 正=赚取，负=消耗；expiry_reset 为 -旧余额
    balance_after INTEGER NOT NULL,              -- 变动后余额快照（对账依据）
    reason VARCHAR(32) NOT NULL,                 -- signup|daily_login|quiz_answer|achievement|share_download|ai_generate|ai_upload|file_extend|admin_adjust|expiry_reset
    ref_type VARCHAR(32),                        -- signup|daily_login|achievement|share_download|file_extend|quiz_session
    ref_id VARCHAR(128),                         -- 一次性事件幂等键；file_extend/ai_*/admin_adjust 留 NULL 允许多次
    note VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, ref_type, ref_id)            -- PG 中 NULL 互不冲突：一次性发放幂等，多次事件不受限
);

CREATE INDEX IF NOT EXISTS idx_points_ledger_user_time
    ON points_ledger(user_id, created_at DESC);   -- 本人台账分页 / 对账

CREATE INDEX IF NOT EXISTS idx_points_ledger_user_reason
    ON points_ledger(user_id, reason, created_at); -- 每日赚分上限 / 分享单库封顶 SUM 查询

-- 答题奖励按增量结算：已发放的统计快照（如 {"correct": 12}），跨轮次/重复同步不乱发
ALTER TABLE answer_sessions ADD COLUMN IF NOT EXISTS points_awarded_stats JSONB;

-- AI 每日免费额度计数源（ai_request_log user+time 聚合）
CREATE INDEX IF NOT EXISTS idx_ai_request_log_user_time
    ON ai_request_log(user_id, created_at);

-- 授权给应用角色（同 ai_tasks 迁移模式：以 postgres 建表后 app 角色无权限）
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qbao') THEN
        GRANT ALL PRIVILEGES ON TABLE points_ledger TO qbao;
        GRANT USAGE, SELECT ON SEQUENCE points_ledger_id_seq TO qbao;
    END IF;
END $$;
