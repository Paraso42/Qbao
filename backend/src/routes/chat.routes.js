// =============================================================================
//  chat.routes.js — Chat & Friend System API
//  依赖: pool (../db), requireAuth/requireAdmin (../middleware), multer
// =============================================================================

const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 确保 uploads 目录存在
const chatUploadDir = path.join(__dirname, '..', '..', '..', 'uploads', 'chat');
if (!fs.existsSync(chatUploadDir)) fs.mkdirSync(chatUploadDir, { recursive: true });

const chatUpload = multer({
  storage: multer.diskStorage({
    destination: chatUploadDir,
    filename: function (req, file, cb) {
      // Fix Chinese filename encoding for display
      var origName = file.originalname;
      try { origName = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch(e) {}
      var ext = path.extname(origName) || '';
      var safeName = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
      // Store original name for later retrieval
      file.originalname = origName;
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: function (req, file, cb) {
    cb(null, true); // 接受所有类型（图片+文件）
  }
});

module.exports = function (app) {

  // ===========================================================================
  //  文件/图片提供
  // ===========================================================================

  // GET /api/v1/chat/files/:filename — 提供文件/图片下载
  app.get('/api/v1/chat/files/:filename', function (req, res) {
    var fp = path.join(chatUploadDir, req.params.filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: '文件不存在或已删除' });
    res.sendFile(fp);
  });

  // ===========================================================================
  //  用户搜索
  // ===========================================================================

  // GET /api/v1/chat/users/search?q=
  app.get('/api/v1/chat/users/search', requireAuth, async (req, res) => {
    try {
      var q = (req.query.q || '').trim();
      if (!q || q.length < 1) return res.json({ users: [] });

      var result = await pool.query(
        `SELECT id, username, display_name, avatar_url, last_seen_at
         FROM users
         WHERE id != $1
           AND (username ILIKE $2 OR display_name ILIKE $2)
         ORDER BY
           CASE WHEN username ILIKE $2 THEN 0 ELSE 1 END,
           username
         LIMIT 20`,
        [req.userId, '%' + q + '%']
      );
      res.json({ users: result.rows });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // ===========================================================================
  //  好友管理
  // ===========================================================================

  // GET /api/v1/chat/friends — 好友列表
  app.get('/api/v1/chat/friends', requireAuth, async (req, res) => {
    try {
      var result = await pool.query(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at,
                f.id AS friendship_id, f.created_at AS friend_since
         FROM friendships f
         JOIN users u ON (f.user_id = u.id OR f.friend_id = u.id)
         WHERE (f.user_id = $1 OR f.friend_id = $1)
           AND f.status = 'accepted'
           AND u.id != $1
         ORDER BY u.display_name`,
        [req.userId]
      );
      res.json({ friends: result.rows });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/chat/friends/request — 发送好友申请 { friendId, message? }
  app.post('/api/v1/chat/friends/request', requireAuth, async (req, res) => {
    try {
      var { friendId, message } = req.body;
      friendId = parseInt(friendId);

      if (!friendId || friendId === req.userId) {
        return res.status(422).json({ error: '无效的用户ID' });
      }

      // 检查目标用户是否存在
      var userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [friendId]);
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }

      // 检查是否已有关系
      var existing = await pool.query(
        'SELECT * FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
        [req.userId, friendId]
      );

      if (existing.rows.length > 0) {
        var rel = existing.rows[0];
        if (rel.status === 'accepted') {
          return res.status(422).json({ error: '已经是好友' });
        }
        if (rel.status === 'pending') {
          if (rel.user_id === req.userId) {
            return res.status(422).json({ error: '已发送过好友申请，请等待对方处理' });
          }
          // 对方已向我发送申请 → 自动接受
          await pool.query(
            "UPDATE friendships SET status = 'accepted', updated_at = NOW() WHERE id = $1",
            [rel.id]
          );
          return res.json({ accepted: true, friendshipId: rel.id });
        }
        if (rel.status === 'blocked') {
          return res.status(422).json({ error: '无法添加此用户' });
        }
      }

      var msg = (message || '').trim().substring(0, 200);
      var result = await pool.query(
        'INSERT INTO friendships (user_id, friend_id, status, message) VALUES ($1, $2, $3, $4) RETURNING *',
        [req.userId, friendId, 'pending', msg]
      );
      res.status(201).json({ requestId: result.rows[0].id });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/chat/friends/requests — 待处理的好友申请
  app.get('/api/v1/chat/friends/requests', requireAuth, async (req, res) => {
    try {
      var result = await pool.query(
        `SELECT f.id, f.user_id AS from_user_id, f.message, f.created_at,
                u.username, u.display_name
         FROM friendships f
         JOIN users u ON f.user_id = u.id
         WHERE f.friend_id = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC`,
        [req.userId]
      );
      res.json({ requests: result.rows });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/chat/friends/requests/:id/accept — 接受好友申请
  app.post('/api/v1/chat/friends/requests/:id/accept', requireAuth, async (req, res) => {
    try {
      var requestId = parseInt(req.params.id);
      var existing = await pool.query(
        'SELECT * FROM friendships WHERE id = $1 AND friend_id = $2 AND status = $3',
        [requestId, req.userId, 'pending']
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: '申请不存在或已处理' });
      }

      var rel = existing.rows[0];
      // 创建 direct 聊天室
      var roomResult = await pool.query(
        'INSERT INTO chat_rooms (type, created_by) VALUES ($1, $2) RETURNING id',
        ['direct', req.userId]
      );
      var roomId = roomResult.rows[0].id;

      // 添加双方为成员
      await pool.query(
        'INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2), ($1, $3)',
        [roomId, req.userId, rel.user_id]
      );

      // 发送系统消息
      await pool.query(
        "INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, '你们已成为好友，开始聊天吧！', 'text')",
        [roomId, req.userId]
      );

      // 更新好友关系
      await pool.query(
        "UPDATE friendships SET status = 'accepted', updated_at = NOW() WHERE id = $1",
        [requestId]
      );

      res.json({ accepted: true, roomId: roomId });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/chat/friends/requests/:id/reject — 拒绝好友申请
  app.post('/api/v1/chat/friends/requests/:id/reject', requireAuth, async (req, res) => {
    try {
      var requestId = parseInt(req.params.id);
      var result = await pool.query(
        'DELETE FROM friendships WHERE id = $1 AND friend_id = $2 AND status = $3',
        [requestId, req.userId, 'pending']
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: '申请不存在或已处理' });
      }
      res.json({ rejected: true });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/v1/chat/friends/:friendId — 删除好友
  app.delete('/api/v1/chat/friends/:friendId', requireAuth, async (req, res) => {
    var client = await pool.connect();
    try {
      var friendId = parseInt(req.params.friendId);

      // 查找好友关系
      var rel = await client.query(
        'SELECT * FROM friendships WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)) AND status = $3',
        [req.userId, friendId, 'accepted']
      );
      if (rel.rows.length === 0) {
        return res.status(404).json({ error: '好友关系不存在' });
      }

      // 找到对应的 direct 聊天室并移除
      var roomResult = await client.query(
        `SELECT crm.room_id FROM chat_room_members crm
         JOIN chat_rooms cr ON crm.room_id = cr.id
         WHERE cr.type = 'direct' AND crm.user_id IN ($1, $2)
         GROUP BY crm.room_id
         HAVING COUNT(*) = 2`,
        [req.userId, friendId]
      );

      await client.query('BEGIN');

      // 删除好友关系
      await client.query('DELETE FROM friendships WHERE id = $1', [rel.rows[0].id]);

      // 如果有关联聊天室，移除当前用户
      if (roomResult.rows.length > 0) {
        var roomId = roomResult.rows[0].room_id;
        // 发送系统消息
        await client.query(
          "INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, '好友关系已解除', 'text')",
          [roomId, req.userId]
        );
        // 移除当前用户
        await client.query(
          'DELETE FROM chat_room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, req.userId]
        );
      }

      await client.query('COMMIT');
      res.json({ deleted: true });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // ===========================================================================
  //  聊天室管理
  // ===========================================================================

  // GET /api/v1/chat/rooms — 我的会话列表
  app.get('/api/v1/chat/rooms', requireAuth, async (req, res) => {
    try {
      var result = await pool.query(
        `SELECT cr.*,
           (SELECT json_build_object(
              'id', cm.id, 'content', cm.content, 'msg_type', cm.msg_type,
              'user_id', cm.user_id, 'created_at', cm.created_at,
              'sender_name', (SELECT display_name FROM users WHERE id = cm.user_id)
            )
            FROM chat_messages cm
            WHERE cm.room_id = cr.id
            ORDER BY cm.created_at DESC LIMIT 1
           ) AS last_message,
           (SELECT COUNT(*) FROM chat_messages cm
            WHERE cm.room_id = cr.id
              AND cm.user_id != $1
              AND cm.created_at > COALESCE(
                (SELECT crm.last_read_at FROM chat_room_members crm
                 WHERE crm.room_id = cr.id AND crm.user_id = $1),
                '1970-01-01'
              )
           ) AS unread_count
         FROM chat_rooms cr
         JOIN chat_room_members crm ON cr.id = crm.room_id
         WHERE crm.user_id = $1
         ORDER BY
           COALESCE(
             (SELECT cm.created_at FROM chat_messages cm WHERE cm.room_id = cr.id ORDER BY cm.created_at DESC LIMIT 1),
             cr.created_at
           ) DESC`,
        [req.userId]
      );

      // 补充成员信息
      var rooms = result.rows;
      for (var i = 0; i < rooms.length; i++) {
        var membersResult = await pool.query(
          `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at
           FROM chat_room_members crm
           JOIN users u ON crm.user_id = u.id
           WHERE crm.room_id = $1`,
          [rooms[i].id]
        );
        rooms[i].members = membersResult.rows;
      }

      res.json({ rooms: rooms });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/chat/rooms — 创建会话
  app.post('/api/v1/chat/rooms', requireAuth, async (req, res) => {
    var client = await pool.connect();
    try {
      var { type, friendId, name, memberIds } = req.body;

      if (type === 'direct') {
        // 一对一聊天 — 检查是否已存在
        friendId = parseInt(friendId);
        if (!friendId || friendId === req.userId) {
          return res.status(422).json({ error: '无效的用户ID' });
        }

        // 检查是否已是好友
        var friendship = await client.query(
          `SELECT * FROM friendships
           WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
             AND status = 'accepted'`,
          [req.userId, friendId]
        );
        if (friendship.rows.length === 0) {
          return res.status(422).json({ error: '还不是好友，无法创建会话' });
        }

        // 检查是否已有 direct 聊天室
        var existingRoom = await client.query(
          `SELECT crm1.room_id FROM chat_room_members crm1
           JOIN chat_room_members crm2 ON crm1.room_id = crm2.room_id
           JOIN chat_rooms cr ON crm1.room_id = cr.id
           WHERE cr.type = 'direct'
             AND crm1.user_id = $1 AND crm2.user_id = $2`,
          [req.userId, friendId]
        );

        if (existingRoom.rows.length > 0) {
          return res.json({ roomId: existingRoom.rows[0].room_id, existed: true });
        }

        await client.query('BEGIN');
        var roomResult = await client.query(
          'INSERT INTO chat_rooms (type, created_by) VALUES ($1, $2) RETURNING id',
          ['direct', req.userId]
        );
        var roomId = roomResult.rows[0].id;
        await client.query(
          'INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2), ($1, $3)',
          [roomId, req.userId, friendId]
        );
        await client.query(
          "INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, '你们已成为好友，开始聊天吧！', 'text')",
          [roomId, req.userId]
        );
        await client.query('COMMIT');
        return res.status(201).json({ roomId: roomId });
      }

      if (type === 'group') {
        // 群聊
        var groupName = (name || '群聊').trim().substring(0, 128);
        var ids = (memberIds || []).filter(function(id) {
          return id !== req.userId;
        });
        if (ids.length === 0) {
          return res.status(422).json({ error: '至少需要邀请一位好友' });
        }

        // 验证所有成员都是好友
        var simpleCheck = await client.query(
          `SELECT friend_id FROM friendships
           WHERE status = 'accepted'
             AND (user_id = $1 OR friend_id = $1)`,
          [req.userId]
        );
        var friendSet = {};
        simpleCheck.rows.forEach(function(r) {
          friendSet[r.friend_id] = true;
        });
        // 需要检查的是 memberIds 中的每个 id 是否是好友
        var allFriends = ids.every(function(id) { return friendSet[id]; });
        // 更准确的检查
        var allFriendsCheck = true;
        for (var j = 0; j < ids.length; j++) {
          var checkResult = await client.query(
            `SELECT 1 FROM friendships
             WHERE status = 'accepted'
               AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))`,
            [req.userId, ids[j]]
          );
          if (checkResult.rows.length === 0) {
            allFriendsCheck = false;
            break;
          }
        }

        if (!allFriendsCheck) {
          return res.status(422).json({ error: '只能邀请好友加入群聊' });
        }

        await client.query('BEGIN');
        var groupResult = await client.query(
          'INSERT INTO chat_rooms (type, name, created_by) VALUES ($1, $2, $3) RETURNING id',
          ['group', groupName, req.userId]
        );
        var groupRoomId = groupResult.rows[0].id;

        // 添加创建者 + 所有成员
        var allMemberIds = [req.userId].concat(ids);
        for (var k = 0; k < allMemberIds.length; k++) {
          await client.query(
            'INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2)',
            [groupRoomId, allMemberIds[k]]
          );
        }

        // 系统消息
        var creatorName = '';
        var userResult = await client.query('SELECT display_name FROM users WHERE id = $1', [req.userId]);
        if (userResult.rows[0]) creatorName = userResult.rows[0].display_name;

        await client.query(
          'INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, $3, $4)',
          [groupRoomId, req.userId, creatorName + ' 创建了群聊「' + groupName + '」', 'text']
        );

        await client.query('COMMIT');
        return res.status(201).json({ roomId: groupRoomId });
      }

      return res.status(422).json({ error: '无效的会话类型' });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // GET /api/v1/chat/rooms/:roomId — 会话详情
  app.get('/api/v1/chat/rooms/:roomId', requireAuth, async (req, res) => {
    try {
      var roomId = parseInt(req.params.roomId);

      // 检查是否是该房间成员
      var memberCheck = await pool.query(
        'SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, req.userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: '无权查看此会话' });
      }

      var roomResult = await pool.query('SELECT * FROM chat_rooms WHERE id = $1', [roomId]);
      if (roomResult.rows.length === 0) {
        return res.status(404).json({ error: '会话不存在' });
      }

      var room = roomResult.rows[0];

      var membersResult = await pool.query(
        `SELECT u.id, u.username, u.display_name, u.last_seen_at, crm.joined_at
         FROM chat_room_members crm
         JOIN users u ON crm.user_id = u.id
         WHERE crm.room_id = $1`,
        [roomId]
      );
      room.members = membersResult.rows;

      res.json({ room: room });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/chat/rooms/:roomId/leave — 退出群聊
  app.post('/api/v1/chat/rooms/:roomId/leave', requireAuth, async (req, res) => {
    try {
      var roomId = parseInt(req.params.roomId);

      var roomCheck = await pool.query(
        "SELECT * FROM chat_rooms WHERE id = $1 AND type = 'group'",
        [roomId]
      );
      if (roomCheck.rows.length === 0) {
        return res.status(422).json({ error: '只能退出群聊' });
      }

      var userResult = await pool.query(
        'SELECT display_name FROM users WHERE id = $1',
        [req.userId]
      );
      var name = userResult.rows[0] ? userResult.rows[0].display_name : '用户';

      await pool.query(
        'INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, $3, $4)',
        [roomId, req.userId, name + ' 退出了群聊', 'text']
      );

      await pool.query(
        'DELETE FROM chat_room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, req.userId]
      );

      res.json({ left: true });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/chat/rooms/:roomId/add-members — 拉人进群
  app.post('/api/v1/chat/rooms/:roomId/add-members', requireAuth, async (req, res) => {
    var client = await pool.connect();
    try {
      var roomId = parseInt(req.params.roomId);
      var { userIds } = req.body;

      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(422).json({ error: '请选择要邀请的用户' });
      }

      var roomCheck = await client.query(
        "SELECT * FROM chat_rooms WHERE id = $1 AND type = 'group'",
        [roomId]
      );
      if (roomCheck.rows.length === 0) {
        return res.status(422).json({ error: '只能向群聊添加成员' });
      }

      // 检查当前用户是否在群中
      var selfCheck = await client.query(
        'SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, req.userId]
      );
      if (selfCheck.rows.length === 0) {
        return res.status(403).json({ error: '你不在该群聊中' });
      }

      var userResult = await client.query(
        'SELECT display_name FROM users WHERE id = $1',
        [req.userId]
      );
      var inviterName = userResult.rows[0] ? userResult.rows[0].display_name : '用户';

      var addedNames = [];
      for (var i = 0; i < userIds.length; i++) {
        var uid = parseInt(userIds[i]);
        // 跳过已在群中的
        var exists = await client.query(
          'SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, uid]
        );
        if (exists.rows.length > 0) continue;

        await client.query(
          'INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2)',
          [roomId, uid]
        );

        var nameResult = await client.query(
          'SELECT display_name FROM users WHERE id = $1',
          [uid]
        );
        addedNames.push(nameResult.rows[0] ? nameResult.rows[0].display_name : ('用户#' + uid));
      }

      if (addedNames.length > 0) {
        await client.query(
          'INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, $3, $4)',
          [roomId, req.userId, inviterName + ' 邀请了 ' + addedNames.join('、') + ' 加入群聊', 'text']
        );
      }

      res.json({ added: addedNames.length });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // ===========================================================================
  //  消息
  // ===========================================================================

  // GET /api/v1/chat/rooms/:roomId/messages?before=&limit=
  app.get('/api/v1/chat/rooms/:roomId/messages', requireAuth, async (req, res) => {
    try {
      var roomId = parseInt(req.params.roomId);

      // 检查权限
      var memberCheck = await pool.query(
        'SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, req.userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: '无权查看此会话消息' });
      }

      var limit = Math.min(parseInt(req.query.limit) || 50, 100);
      var before = parseInt(req.query.before) || 0;

      var query = `SELECT cm.*, u.display_name AS sender_name, u.username AS sender_username
                   FROM chat_messages cm
                   LEFT JOIN users u ON cm.user_id = u.id
                   WHERE cm.room_id = $1`;
      var params = [roomId];

      if (before > 0) {
        query += ' AND cm.id < $2';
        params.push(before);
      }

      query += ' ORDER BY cm.created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      var result = await pool.query(query, params);
      // 反转使消息按时间升序
      var messages = result.rows.reverse();

      res.json({ messages: messages });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/chat/rooms/:roomId/messages — 发送消息
  app.post('/api/v1/chat/rooms/:roomId/messages', requireAuth, async (req, res) => {
    try {
      var roomId = parseInt(req.params.roomId);
      var { content, images, file_info, msg_type, quiz_data, reply_to } = req.body;


      // 检查权限
      var memberCheck = await pool.query(
        'SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, req.userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: '无权在此会话发送消息' });
      }

      var finalContent = (content || '').trim();
      var finalImages = Array.isArray(images) ? images : [];
      var finalType = msg_type || 'text';

      // 根据消息类型验证
      if (finalType === 'text' && !finalContent && finalImages.length === 0 && !file_info) {
        return res.status(422).json({ error: '消息内容不能为空' });
      }
      if (finalType === 'image' && finalImages.length === 0) {
        return res.status(422).json({ error: '图片消息需要包含图片' });
      }
      if (finalType === 'file' && !file_info) {
        return res.status(422).json({ error: '文件消息需要包含文件信息' });
      }
      if ((finalType === 'quiz_share' || finalType === 'bank_share') && !quiz_data) {
        return res.status(422).json({ error: '题目分享需要包含题目数据' });
      }

      // Normalize quiz_data question answers to letter format (A/B/C/D...)
      if (quiz_data && quiz_data.questions) {
        quiz_data.questions.forEach(function(q) {
          console.log('[POST /msg normalize] before:', q.answer, 'type:', typeof q.answer);
          if (q.answer !== undefined && q.answer !== null && q.answer !== '') {
            var labels = ['A','B','C','D','E','F'];
            if (typeof q.answer === 'number' || /^\d+$/.test(String(q.answer))) {
              // Numeric index (0,1,2) or string number ('0','1','2') → letter
              var n = Number(q.answer);
              if (n >= 0 && n < labels.length) q.answer = labels[n];
            } else if (typeof q.answer === 'string') {
              // Already a letter — uppercase it
              q.answer = q.answer.toUpperCase();
            }
          }
          console.log('[POST /msg normalize] after:', q.answer, 'type:', typeof q.answer);
        });
      }

      var result = await pool.query(
        `INSERT INTO chat_messages (room_id, user_id, content, msg_type, images, file_info, quiz_data, reply_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          roomId, req.userId, finalContent, finalType,
          JSON.stringify(finalImages),
          file_info ? JSON.stringify(file_info) : null,
          quiz_data ? JSON.stringify(quiz_data) : null,
          reply_to ? JSON.stringify(reply_to) : null
        ]
      );

      // 更新 room 成员的最后读取时间（发消息 = 已读自己的消息）
      await pool.query(
        'UPDATE chat_room_members SET last_read_at = NOW() WHERE room_id = $1 AND user_id = $2',
        [roomId, req.userId]
      );

      // 添加 sender 信息
      var msg = result.rows[0];
      var userResult = await pool.query(
        'SELECT display_name, username FROM users WHERE id = $1',
        [req.userId]
      );
      msg.sender_name = userResult.rows[0] ? userResult.rows[0].display_name : '';
      msg.sender_username = userResult.rows[0] ? userResult.rows[0].username : '';

      res.status(201).json({ message: msg });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/chat/rooms/:roomId/read — 标记已读
  app.post('/api/v1/chat/rooms/:roomId/read', requireAuth, async (req, res) => {
    try {
      var roomId = parseInt(req.params.roomId);
      await pool.query(
        'UPDATE chat_room_members SET last_read_at = NOW() WHERE room_id = $1 AND user_id = $2',
        [roomId, req.userId]
      );
      res.json({ read: true });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // ===========================================================================
  //  上传
  // ===========================================================================

  // POST /api/v1/chat/upload — 上传图片/文件
  app.post('/api/v1/chat/upload', requireAuth, chatUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(422).json({ error: '请选择文件' });
      var url = '/api/v1/chat/files/' + req.file.filename;
      res.json({
        url: url,
        name: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype
      });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // ===========================================================================
  //  消息撤回
  // ===========================================================================

  // POST /api/v1/chat/messages/:id/revoke — 撤回消息（2分钟内）
  app.post('/api/v1/chat/messages/:id/revoke', requireAuth, async (req, res) => {
    try {
      var msgId = parseInt(req.params.id);
      var msgResult = await pool.query(
        'SELECT * FROM chat_messages WHERE id = $1 AND user_id = $2',
        [msgId, req.userId]
      );
      if (msgResult.rows.length === 0) {
        return res.status(404).json({ error: '消息不存在或无权撤回' });
      }

      var msg = msgResult.rows[0];
      var elapsed = Date.now() - new Date(msg.created_at).getTime();
      if (elapsed > 2 * 60 * 1000) {
        return res.status(422).json({ error: '超过2分钟的消息无法撤回' });
      }

      await pool.query(
        'UPDATE chat_messages SET is_revoked = true, content = $1, updated_at = NOW() WHERE id = $2',
        ['消息已撤回', msgId]
      );

      res.json({ revoked: true });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/chat/messages/:id/update-quiz — 更新题目分享的作答结果
  app.post('/api/v1/chat/messages/:id/update-quiz', requireAuth, async (req, res) => {
    try {
      var msgId = parseInt(req.params.id);
      var quizData = req.body.quiz_data;
      if (!quizData) return res.status(422).json({ error: 'quiz_data is required' });

      // Verify the message exists and user is a member of the room
      var msgResult = await pool.query('SELECT room_id FROM chat_messages WHERE id = $1', [msgId]);
      if (msgResult.rows.length === 0) {
        return res.status(404).json({ error: '消息不存在' });
      }

      await pool.query(
        'UPDATE chat_messages SET quiz_data = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(quizData), msgId]
      );

      res.json({ updated: true });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  // ===========================================================================
  //  轮询
  // ===========================================================================

  // GET /api/v1/chat/updates — 轮询未读和更新
  app.get('/api/v1/chat/updates', requireAuth, async (req, res) => {
    try {
      // 总的未读消息数
      var unreadResult = await pool.query(
        `SELECT COALESCE(SUM(
           (SELECT COUNT(*) FROM chat_messages cm
            WHERE cm.room_id = cr.id
              AND cm.user_id != $1
              AND cm.created_at > COALESCE(
                (SELECT crm.last_read_at FROM chat_room_members crm
                 WHERE crm.room_id = cr.id AND crm.user_id = $1),
                '1970-01-01'
              ))
         ), 0) AS total_unread
         FROM chat_rooms cr
         JOIN chat_room_members crm ON cr.id = crm.room_id
         WHERE crm.user_id = $1`,
        [req.userId]
      );
      var totalUnread = parseInt(unreadResult.rows[0].total_unread);

      // 待处理好友申请数
      var requestsResult = await pool.query(
        "SELECT COUNT(*) AS cnt FROM friendships WHERE friend_id = $1 AND status = 'pending'",
        [req.userId]
      );
      var pendingRequests = parseInt(requestsResult.rows[0].cnt);

      // 最近更新的房间
      var updatedRooms = await pool.query(
        `SELECT cr.id
         FROM chat_rooms cr
         JOIN chat_room_members crm ON cr.id = crm.room_id
         WHERE crm.user_id = $1
           AND EXISTS (
             SELECT 1 FROM chat_messages cm
             WHERE cm.room_id = cr.id
               AND cm.updated_at > NOW() - INTERVAL '30 seconds'
           )
         ORDER BY (SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.room_id = cr.id) DESC`,
        [req.userId]
      );

      res.json({
        totalUnread: totalUnread,
        pendingRequests: pendingRequests,
        updatedRoomIds: updatedRooms.rows.map(function(r) { return r.id; })
      });
    } catch (e) {
      console.error('[chat] error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

};
