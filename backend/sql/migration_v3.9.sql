-- Migration v3.9: Chat & Friend System
-- Created: 2026-06-07

-- 好友关系表
CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | accepted | blocked
  message VARCHAR(200) DEFAULT '',               -- 好友申请附带消息
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user_id ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend_id ON friendships(friend_id);

-- 聊天室表
CREATE TABLE IF NOT EXISTS chat_rooms (
  id SERIAL PRIMARY KEY,
  type VARCHAR(16) NOT NULL DEFAULT 'direct', -- direct | group
  name VARCHAR(128),                          -- 群聊名称（direct 类型为空）
  avatar_url VARCHAR(512),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 聊天室成员
CREATE TABLE IF NOT EXISTS chat_room_members (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMP NOT NULL DEFAULT NOW(),
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_room_id ON chat_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_crm_user_id ON chat_room_members(user_id);

-- 聊天消息（统一处理文字/图片/文件/题目分享）
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  msg_type VARCHAR(16) NOT NULL DEFAULT 'text', -- text | image | file | quiz_share | bank_share
  images JSONB DEFAULT '[]'::jsonb,             -- 图片 URL 列表
  file_info JSONB DEFAULT NULL,                 -- {name, size, url, mimeType}
  quiz_data JSONB DEFAULT NULL,                 -- 题目分享: {questions[], setName, chapterName, fromUserName}
  reply_to JSONB DEFAULT NULL,                  -- 引用回复: {messageId, content, userName}
  is_revoked BOOLEAN NOT NULL DEFAULT false,    -- 消息是否已撤回
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(room_id, created_at DESC);

-- 用户在线状态（持久标记）
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;
