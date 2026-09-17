-- 020_v3.43_chat_media_guard.sql
-- 聊天媒体台账（v3.37.7 加固：带宽 / 磁盘 / 超大文件三重防护）
--
-- 背景：聊天上传此前只受「单文件 50MB」一条约束，其余无人管：
--   * 上传不计数 → 循环 POST /chat/upload 可写满磁盘（没有任何配额/限流）；
--   * 上传后不发送也留在盘上 → 孤儿文件没有清理路径，长期只涨不减；
--   * 附件永久留存 → 聊天被当成免费网盘，与「学习资料传递」定位背离。
-- 本表是上述治理的唯一事实来源：每一次成功落盘都记一行，配额、孤儿清理、
-- 保留期释放、撤回释放全部基于它。
--
-- 设计取舍：
--   * stored_name 唯一：磁盘文件名本身就是随机且唯一的（chat_<ts>_<rand>.<ext>），
--     因此它就是天然的幂等键，重复回填不会写重；
--   * message_id 可空：上传发生在「发送消息」之前，先记 NULL，发送成功后再回填。
--     message_id IS NULL 的行 = 孤儿（上传了但没发出去），是孤儿清理的判据；
--   * user_id 可空：本迁移上线前磁盘上已存在的历史文件无法反向确定上传者，
--     只能记 NULL（它们要么在 24 小时内作为孤儿被清理，要么按保留期释放）。
--     新上传一律带 user_id，配额只看 user_id 匹配的行；
--   * purged_at：保留期到点后删除磁盘字节但**保留台账行**，用于审计与
--     「用户到底存过多少」的追溯；配额统计只累加 purged_at IS NULL 的行；
--   * 不记缩略图：?w=480 派生图（<主名>.w480.<ext>）跟随主文件生死，
--     单独建账只会让清理逻辑复杂化。

CREATE TABLE IF NOT EXISTS chat_media_assets (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'file',
  file_size BIGINT NOT NULL,
  message_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purged_at TIMESTAMPTZ
);

-- 配额查询：按用户取「最近 1 天」与「未释放总量」
CREATE INDEX IF NOT EXISTS idx_chat_media_user_created ON chat_media_assets (user_id, created_at DESC);
-- 孤儿清理：message_id IS NULL AND purged_at IS NULL AND created_at < ?
CREATE INDEX IF NOT EXISTS idx_chat_media_orphans ON chat_media_assets (created_at) WHERE message_id IS NULL AND purged_at IS NULL;
-- 保留期释放：purged_at IS NULL AND created_at < ?
CREATE INDEX IF NOT EXISTS idx_chat_media_retention ON chat_media_assets (created_at) WHERE purged_at IS NULL;
-- 撤回/删除消息时按 message_id 反查
CREATE INDEX IF NOT EXISTS idx_chat_media_message ON chat_media_assets (message_id) WHERE message_id IS NOT NULL;