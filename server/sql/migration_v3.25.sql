-- v3.25: 双形态（桌面+网页）互通 — user_data 乐观锁版本号
-- 说明：PUT/PATCH /api/v1/data 支持可选 rev，冲突返回 409；旧客户端不带 rev 时行为不变
ALTER TABLE user_data ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
