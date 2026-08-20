-- 迁移 v3.10: 为聊天消息加 updated_at 列以支持题目作答实时同步
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_chat_messages_updated ON chat_messages(room_id, updated_at DESC);
