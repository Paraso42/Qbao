-- round6：同章节生成互斥锁表
-- 服务端任务路径（ai_tasks）与直连路径（/api/v1/ai/generate）共用一张锁：
-- 任意时刻同一 (user_id, chapter_id) 至多一个生成在“排队或执行”，
-- 从根上杜绝多端/旧版客户端并发生成导致“一次点击出一轮以上”的问题。
CREATE TABLE IF NOT EXISTS ai_generation_locks (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  chapter_id VARCHAR(255) NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'direct',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_generation_locks_user_chapter_key
  ON ai_generation_locks (user_id, chapter_id);
