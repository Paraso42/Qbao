-- 018_v3.41_identity_notices.sql
-- 本轮复查 P0-2 / P0-3 修复。
--
-- 背景：以下 schema 长期只存在于线上库（手工 DDL），从未落成迁移：
--   (1) users 的 role / is_banned / avatar_url / last_login_at / last_active_at
--       —— 被 auth.routes.js、middleware.js、scripts/bootstrap_admin.js 直接引用；
--   (2) notices 表 —— 被 notices.routes.v2.js 的 7 个端点直接使用。
-- 结果是「按 docs/DEPLOY.md 的文档路径新装一个库」根本跑不起来：
--   init.sql + 迁移建出的库缺这些列/表 → 注册即 42703、所有鉴权请求 500。
-- 本迁移把线上既有形态补齐为仓库内可复现的 DDL（全部 IF NOT EXISTS，幂等）。
--
-- 说明：迁移 015 号位在本仓库历史上为空号（从未存在对应文件），编号从 016 继续，
-- 不占用 015 以免与线上 schema_migrations 中可能存在的记录冲突。

-- —— (1) users：补齐代码已依赖的身份/状态列 ——
-- role：'user' | 'admin'。auth.routes.js 用 WHERE role='admin' 判定首个注册者，
--       middleware 的 requireAdmin 亦依赖；默认 'user' 与历史行为一致。
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user';
-- is_banned：middleware.js 每个鉴权请求都会 SELECT is_banned。
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(512);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
-- last_active_at：用户最近活动时间（与 004 的 last_seen_at 并存，语义不同：
-- last_seen_at 由聊天「在线」使用，last_active_at 由用户中心展示）。
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- —— (2) notices：公告栏 ——
-- 列集合严格按 notices.routes.v2.js 的读写字段推导：
--   GET /notices      → content, type, link, sort_order, duration, enabled, expire_at
--   GET /notices/all  → 上述 + id, created_at, updated_at, created_by(→users)
--   POST/PUT          → content, type, link, expire_at, duration, created_by
--   PUT /notices/sort → sort_order, updated_at
CREATE TABLE IF NOT EXISTS notices (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'notice',
  link VARCHAR(1024),
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- duration：前端单条展示毫秒数，路由默认 4000
  duration INTEGER NOT NULL DEFAULT 4000,
  expire_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 列表查询固定 ORDER BY sort_order ASC, id ASC
CREATE INDEX IF NOT EXISTS idx_notices_order ON notices(sort_order, id);
-- 匿名可见列表过滤 enabled + expire_at
CREATE INDEX IF NOT EXISTS idx_notices_enabled ON notices(enabled, expire_at);
