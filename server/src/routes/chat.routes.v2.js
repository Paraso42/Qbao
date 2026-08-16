'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const {
  chatIdParamsSchema,
  chatMessageIdParamsSchema,
  chatFriendIdParamsSchema,
  chatRequestIdParamsSchema,
  chatUserSearchQuerySchema,
  friendRequestBodySchema,
  createRoomSchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  addMembersSchema,
  updateQuizSchema,
} = require('../schemas/chat.schema');

const chatUploadDir = path.join(__dirname, '..', '..', '..', 'uploads', 'chat');
if (!fs.existsSync(chatUploadDir)) fs.mkdirSync(chatUploadDir, { recursive: true });

const chatUpload = multer({
  storage: multer.diskStorage({
    destination: chatUploadDir,
    filename: function (req, file, cb) {
      let origName = file.originalname || '';
      try { origName = Buffer.from(origName, 'latin1').toString('utf8'); } catch (_) {}
      const ext = path.extname(origName || '') || '';
      file.originalname = origName;
      cb(null, 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

module.exports = function (app) {
  // 文件下载/预览。路径做 basename 校验，防止穿越。
  app.get('/api/v1/chat/files/:filename', asyncHandler(async (req, res) => {
    const requested = req.params.filename;
    const filename = path.basename(requested);
    if (filename !== requested || filename.includes('..')) throw new ApiError(404, '文件不存在或已删除');

    const filePath = path.join(chatUploadDir, filename);
    if (!fs.existsSync(filePath)) throw new ApiError(404, '文件不存在或已删除');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath);
  }));

  app.get('/api/v1/chat/users/search', validate({ query: chatUserSearchQuerySchema }), requireAuth, asyncHandler(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ users: [] });

    const result = await pool.query(
      `SELECT id, username, display_name, avatar_url, last_seen_at
       FROM users
       WHERE id != $1 AND (username ILIKE $2 OR display_name ILIKE $2)
       ORDER BY CASE WHEN username ILIKE $2 THEN 0 ELSE 1 END, username
       LIMIT 20`,
      [req.userId, '%' + q + '%']
    );
    res.json({ users: result.rows });
  }));

  app.get('/api/v1/chat/friends', requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
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
  }));

  app.post('/api/v1/chat/friends/request', validate({ body: friendRequestBodySchema }), requireAuth, asyncHandler(async (req, res) => {
    const friendId = req.body.friendId;
    if (friendId === req.userId) throw new ApiError(422, '无效的用户ID');

    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [friendId]);
    if (userCheck.rows.length === 0) throw new ApiError(404, '用户不存在');

    const existing = await pool.query(
      'SELECT * FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
      [req.userId, friendId]
    );
    if (existing.rows.length > 0) {
      const rel = existing.rows[0];
      if (rel.status === 'accepted') throw new ApiError(422, '已经是好友');
      if (rel.status === 'pending') {
        if (rel.user_id === req.userId) throw new ApiError(422, '已发送过好友申请，请等待对方处理');
        await pool.query("UPDATE friendships SET status = 'accepted', updated_at = NOW() WHERE id = $1", [rel.id]);
        return res.json({ accepted: true, friendshipId: rel.id });
      }
      if (rel.status === 'blocked') throw new ApiError(422, '无法添加此用户');
    }

    const msg = (req.body.message || '').trim().substring(0, 200);
    const result = await pool.query(
      'INSERT INTO friendships (user_id, friend_id, status, message) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.userId, friendId, 'pending', msg]
    );
    res.status(201).json({ requestId: result.rows[0].id });
  }));

  app.get('/api/v1/chat/friends/requests', requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT f.id, f.user_id AS from_user_id, f.message, f.created_at, u.username, u.display_name
       FROM friendships f
       JOIN users u ON f.user_id = u.id
       WHERE f.friend_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.userId]
    );
    res.json({ requests: result.rows });
  }));

  app.post('/api/v1/chat/friends/requests/:id/accept', validate({ params: chatRequestIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const client = await pool.connect();
    try {
      const existing = await client.query(
        'SELECT * FROM friendships WHERE id = $1 AND friend_id = $2 AND status = $3',
        [req.params.id, req.userId, 'pending']
      );
      if (existing.rows.length === 0) throw new ApiError(404, '申请不存在或已处理');

      await client.query('BEGIN');
      const rel = existing.rows[0];
      const roomResult = await client.query(
        "INSERT INTO chat_rooms (type, created_by) VALUES ('direct', $1) RETURNING id",
        [req.userId]
      );
      await client.query(
        'INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2), ($1, $3)',
        [roomResult.rows[0].id, req.userId, rel.user_id]
      );
      await client.query(
        "INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, '你们已成为好友，开始聊天吧！', 'text')",
        [roomResult.rows[0].id, req.userId]
      );
      await client.query("UPDATE friendships SET status = 'accepted', updated_at = NOW() WHERE id = $1", [req.params.id]);
      await client.query('COMMIT');

      res.json({ accepted: true, roomId: roomResult.rows[0].id });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  }));

  app.post('/api/v1/chat/friends/requests/:id/reject', validate({ params: chatRequestIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      "DELETE FROM friendships WHERE id = $1 AND friend_id = $2 AND status = 'pending' RETURNING id",
      [req.params.id, req.userId]
    );
    if (result.rowCount === 0) throw new ApiError(404, '申请不存在或已处理');
    res.json({ rejected: true });
  }));

  app.delete('/api/v1/chat/friends/:friendId', validate({ params: chatFriendIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rel = await client.query(
        "SELECT * FROM friendships WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)) AND status = 'accepted'",
        [req.userId, req.params.friendId]
      );
      if (rel.rows.length === 0) throw new ApiError(404, '好友关系不存在');

      const roomResult = await client.query(
        `SELECT crm.room_id
         FROM chat_room_members crm
         JOIN chat_rooms cr ON crm.room_id = cr.id
         WHERE cr.type = 'direct' AND crm.user_id IN ($1, $2)
         GROUP BY crm.room_id
         HAVING COUNT(*) = 2`,
        [req.userId, req.params.friendId]
      );

      await client.query('DELETE FROM friendships WHERE id = $1', [rel.rows[0].id]);
      if (roomResult.rows.length > 0) {
        const roomId = roomResult.rows[0].room_id;
        await client.query(
          "INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, '好友关系已解除', 'text')",
          [roomId, req.userId]
        );
        await client.query('DELETE FROM chat_room_members WHERE room_id = $1 AND user_id = $2', [roomId, req.userId]);
      }
      await client.query('COMMIT');
      res.json({ deleted: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  }));

  app.get('/api/v1/chat/rooms', requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT cr.*,
              (SELECT json_build_object(
                 'id', cm.id, 'content', cm.content, 'msg_type', cm.msg_type,
                 'user_id', cm.user_id, 'created_at', cm.created_at,
                 'sender_name', (SELECT display_name FROM users WHERE id = cm.user_id))
               FROM chat_messages cm
               WHERE cm.room_id = cr.id
               ORDER BY cm.created_at DESC LIMIT 1) AS last_message,
              (SELECT COUNT(*) FROM chat_messages cm
               WHERE cm.room_id = cr.id AND cm.user_id != $1
                 AND cm.created_at > COALESCE(
                   (SELECT crm.last_read_at FROM chat_room_members crm
                    WHERE crm.room_id = cr.id AND crm.user_id = $1), '1970-01-01')) AS unread_count
       FROM chat_rooms cr
       JOIN chat_room_members crm ON cr.id = crm.room_id
       WHERE crm.user_id = $1
       ORDER BY COALESCE(
         (SELECT cm.created_at FROM chat_messages cm WHERE cm.room_id = cr.id ORDER BY cm.created_at DESC LIMIT 1),
         cr.created_at) DESC`,
      [req.userId]
    );

    const rooms = result.rows;
    const roomIds = rooms.map((room) => room.id);
    if (roomIds.length > 0) {
      const membersResult = await pool.query(
        `SELECT crm.room_id, u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at
         FROM chat_room_members crm
         JOIN users u ON crm.user_id = u.id
         WHERE crm.room_id = ANY($1::int[])`,
        [roomIds]
      );
      const membersByRoom = {};
      membersResult.rows.forEach((member) => {
        if (!membersByRoom[member.room_id]) membersByRoom[member.room_id] = [];
        membersByRoom[member.room_id].push(member);
      });
      rooms.forEach((room) => { room.members = membersByRoom[room.id] || []; });
    } else {
      rooms.forEach((room) => { room.members = []; });
    }

    res.json({ rooms });
  }));

  app.post('/api/v1/chat/rooms', validate({ body: createRoomSchema }), requireAuth, asyncHandler(async (req, res) => {
    const client = await pool.connect();
    try {
      if (req.body.type === 'direct') {
        const friendId = req.body.friendId;
        if (!friendId || friendId === req.userId) throw new ApiError(422, '无效的用户ID');

        const friendship = await client.query(
          "SELECT * FROM friendships WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)) AND status = 'accepted'",
          [req.userId, friendId]
        );
        if (friendship.rows.length === 0) throw new ApiError(422, '还不是好友，无法创建会话');

        const existingRoom = await client.query(
          `SELECT crm1.room_id
           FROM chat_room_members crm1
           JOIN chat_room_members crm2 ON crm1.room_id = crm2.room_id
           JOIN chat_rooms cr ON crm1.room_id = cr.id
           WHERE cr.type = 'direct' AND crm1.user_id = $1 AND crm2.user_id = $2`,
          [req.userId, friendId]
        );
        if (existingRoom.rows.length > 0) {
          return res.json({ roomId: existingRoom.rows[0].room_id, existed: true });
        }

        await client.query('BEGIN');
        const roomResult = await client.query("INSERT INTO chat_rooms (type, created_by) VALUES ('direct', $1) RETURNING id", [req.userId]);
        await client.query('INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2), ($1, $3)', [roomResult.rows[0].id, req.userId, friendId]);
        await client.query("INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, '你们已成为好友，开始聊天吧！', 'text')", [roomResult.rows[0].id, req.userId]);
        await client.query('COMMIT');
        return res.status(201).json({ roomId: roomResult.rows[0].id });
      }

      if (req.body.type === 'group') {
        const groupName = (req.body.name || '群聊').trim().substring(0, 128);
        const ids = (req.body.memberIds || []).filter((id) => id !== req.userId);
        if (ids.length === 0) throw new ApiError(422, '至少需要邀请一位好友');

        for (const id of ids) {
          const check = await client.query(
            "SELECT 1 FROM friendships WHERE status = 'accepted' AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))",
            [req.userId, id]
          );
          if (check.rows.length === 0) throw new ApiError(422, '只能邀请好友加入群聊');
        }

        await client.query('BEGIN');
        const groupResult = await client.query('INSERT INTO chat_rooms (type, name, created_by) VALUES ($1, $2, $3) RETURNING id', ['group', groupName, req.userId]);
        const allMemberIds = [req.userId].concat(ids);
        for (const userId of allMemberIds) {
          await client.query('INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2)', [groupResult.rows[0].id, userId]);
        }
        const userResult = await client.query('SELECT display_name FROM users WHERE id = $1', [req.userId]);
        const creatorName = userResult.rows[0] ? userResult.rows[0].display_name : '用户';
        await client.query(
          'INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, $3, $4)',
          [groupResult.rows[0].id, req.userId, creatorName + ' 创建了群聊「' + groupName + '」', 'text']
        );
        await client.query('COMMIT');
        return res.status(201).json({ roomId: groupResult.rows[0].id });
      }

      throw new ApiError(422, '无效的会话类型');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  }));

  app.get('/api/v1/chat/rooms/:roomId', validate({ params: chatIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const memberCheck = await pool.query('SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2', [req.params.roomId, req.userId]);
    if (memberCheck.rows.length === 0) throw new ApiError(403, '无权查看此会话');

    const roomResult = await pool.query('SELECT * FROM chat_rooms WHERE id = $1', [req.params.roomId]);
    if (roomResult.rows.length === 0) throw new ApiError(404, '会话不存在');

    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.last_seen_at, crm.joined_at
       FROM chat_room_members crm
       JOIN users u ON crm.user_id = u.id
       WHERE crm.room_id = $1`,
      [req.params.roomId]
    );
    const room = roomResult.rows[0];
    room.members = membersResult.rows;
    res.json({ room });
  }));

  app.post('/api/v1/chat/rooms/:roomId/leave', validate({ params: chatIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const roomCheck = await pool.query("SELECT * FROM chat_rooms WHERE id = $1 AND type = 'group'", [req.params.roomId]);
    if (roomCheck.rows.length === 0) throw new ApiError(422, '只能退出群聊');

    const memberCheck = await pool.query('SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2', [req.params.roomId, req.userId]);
    if (memberCheck.rows.length === 0) throw new ApiError(403, '你不在该群聊中');

    const userResult = await pool.query('SELECT display_name FROM users WHERE id = $1', [req.userId]);
    const name = userResult.rows[0] ? userResult.rows[0].display_name : '用户';
    await pool.query('INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, $3, $4)', [req.params.roomId, req.userId, name + ' 退出了群聊', 'text']);
    await pool.query('DELETE FROM chat_room_members WHERE room_id = $1 AND user_id = $2', [req.params.roomId, req.userId]);
    res.json({ left: true });
  }));

  app.post('/api/v1/chat/rooms/:roomId/add-members', validate({ params: chatIdParamsSchema, body: addMembersSchema }), requireAuth, asyncHandler(async (req, res) => {
    const roomCheck = await pool.query("SELECT * FROM chat_rooms WHERE id = $1 AND type = 'group'", [req.params.roomId]);
    if (roomCheck.rows.length === 0) throw new ApiError(422, '只能向群聊添加成员');

    const selfCheck = await pool.query('SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2', [req.params.roomId, req.userId]);
    if (selfCheck.rows.length === 0) throw new ApiError(403, '你不在该群聊中');

    const userResult = await pool.query('SELECT display_name FROM users WHERE id = $1', [req.userId]);
    const inviterName = userResult.rows[0] ? userResult.rows[0].display_name : '用户';

    const addedNames = [];
    for (const uid of req.body.userIds) {
      const exists = await pool.query('SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2', [req.params.roomId, uid]);
      if (exists.rows.length > 0) continue;
      await pool.query('INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2)', [req.params.roomId, uid]);
      const nameResult = await pool.query('SELECT display_name FROM users WHERE id = $1', [uid]);
      addedNames.push(nameResult.rows[0] ? nameResult.rows[0].display_name : ('用户#' + uid));
    }

    if (addedNames.length > 0) {
      await pool.query(
        'INSERT INTO chat_messages (room_id, user_id, content, msg_type) VALUES ($1, $2, $3, $4)',
        [req.params.roomId, req.userId, inviterName + ' 邀请了 ' + addedNames.join('、') + ' 加入群聊', 'text']
      );
    }

    res.json({ added: addedNames.length });
  }));

  app.get('/api/v1/chat/rooms/:roomId/messages', validate({ params: chatIdParamsSchema, query: listMessagesQuerySchema }), requireAuth, asyncHandler(async (req, res) => {
    const memberCheck = await pool.query('SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2', [req.params.roomId, req.userId]);
    if (memberCheck.rows.length === 0) throw new ApiError(403, '无权查看此会话消息');

    const limit = req.query.limit || 50;
    const before = req.query.before || 0;
    let query = `SELECT cm.*, u.display_name AS sender_name, u.username AS sender_username
                 FROM chat_messages cm
                 LEFT JOIN users u ON cm.user_id = u.id
                 WHERE cm.room_id = $1`;
    const params = [req.params.roomId];

    if (before > 0) {
      query += ' AND cm.id < $2';
      params.push(before);
    }
    query += ' ORDER BY cm.created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query(query, params);
    res.json({ messages: result.rows.reverse() });
  }));

  app.post('/api/v1/chat/rooms/:roomId/messages', validate({ params: chatIdParamsSchema, body: sendMessageSchema }), requireAuth, asyncHandler(async (req, res) => {
    const memberCheck = await pool.query('SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2', [req.params.roomId, req.userId]);
    if (memberCheck.rows.length === 0) throw new ApiError(403, '无权在此会话发送消息');

    const finalContent = (req.body.content || '').trim();
    const finalImages = Array.isArray(req.body.images) ? req.body.images : [];
    const finalType = req.body.msg_type || 'text';

    if (finalType === 'text' && !finalContent && finalImages.length === 0 && !req.body.file_info) {
      throw new ApiError(422, '消息内容不能为空');
    }
    if (finalType === 'image' && finalImages.length === 0) throw new ApiError(422, '图片消息需要包含图片');
    if (finalType === 'file' && !req.body.file_info) throw new ApiError(422, '文件消息需要包含文件信息');
    if ((finalType === 'quiz_share' || finalType === 'bank_share') && !req.body.quiz_data) {
      throw new ApiError(422, '题目分享需要包含题目数据');
    }

    const result = await pool.query(
      `INSERT INTO chat_messages (room_id, user_id, content, msg_type, images, file_info, quiz_data, reply_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.params.roomId,
        req.userId,
        finalContent,
        finalType,
        JSON.stringify(finalImages),
        req.body.file_info ? JSON.stringify(req.body.file_info) : null,
        req.body.quiz_data ? JSON.stringify(req.body.quiz_data) : null,
        req.body.reply_to ? JSON.stringify(req.body.reply_to) : null,
      ]
    );

    await pool.query('UPDATE chat_room_members SET last_read_at = NOW() WHERE room_id = $1 AND user_id = $2', [req.params.roomId, req.userId]);

    const userResult = await pool.query('SELECT display_name, username FROM users WHERE id = $1', [req.userId]);
    const msg = result.rows[0];
    msg.sender_name = userResult.rows[0] ? userResult.rows[0].display_name : '';
    msg.sender_username = userResult.rows[0] ? userResult.rows[0].username : '';

    res.status(201).json({ message: msg });
  }));

  app.post('/api/v1/chat/rooms/:roomId/read', validate({ params: chatIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    await pool.query('UPDATE chat_room_members SET last_read_at = NOW() WHERE room_id = $1 AND user_id = $2', [req.params.roomId, req.userId]);
    res.json({ read: true });
  }));

  app.post('/api/v1/chat/upload', requireAuth, chatUpload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(422, '请选择文件');
    res.json({
      url: '/api/v1/chat/files/' + req.file.filename,
      name: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  }));

  app.post('/api/v1/chat/messages/:id/revoke', validate({ params: chatMessageIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const msgResult = await pool.query('SELECT * FROM chat_messages WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (msgResult.rows.length === 0) throw new ApiError(404, '消息不存在或无权撤回');

    const msg = msgResult.rows[0];
    const elapsed = Date.now() - new Date(msg.created_at).getTime();
    if (elapsed > 2 * 60 * 1000) throw new ApiError(422, '超过2分钟的消息无法撤回');

    await pool.query(
      `UPDATE chat_messages
       SET is_revoked = true,
           content = '消息已撤回',
           images = '[]'::jsonb,
           file_info = NULL,
           quiz_data = NULL,
           reply_to = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );
    res.json({ revoked: true });
  }));

  app.post('/api/v1/chat/messages/:id/update-quiz', validate({ params: chatMessageIdParamsSchema, body: updateQuizSchema }), requireAuth, asyncHandler(async (req, res) => {
    const msgResult = await pool.query('SELECT room_id FROM chat_messages WHERE id = $1', [req.params.id]);
    if (msgResult.rows.length === 0) throw new ApiError(404, '消息不存在');

    // 越权修复：必须确认当前用户是该消息所属房间成员。
    const memberCheck = await pool.query(
      'SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2',
      [msgResult.rows[0].room_id, req.userId]
    );
    if (memberCheck.rows.length === 0) throw new ApiError(403, '无权修改此消息');

    await pool.query(
      'UPDATE chat_messages SET quiz_data = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(req.body.quiz_data), req.params.id]
    );
    res.json({ updated: true });
  }));

  app.get('/api/v1/chat/updates', requireAuth, asyncHandler(async (req, res) => {
    const unreadResult = await pool.query(
      `SELECT COALESCE(SUM(
         (SELECT COUNT(*) FROM chat_messages cm
          WHERE cm.room_id = cr.id AND cm.user_id != $1
            AND cm.created_at > COALESCE(
              (SELECT crm.last_read_at FROM chat_room_members crm
               WHERE crm.room_id = cr.id AND crm.user_id = $1), '1970-01-01'))), 0) AS total_unread
       FROM chat_rooms cr
       JOIN chat_room_members crm ON cr.id = crm.room_id
       WHERE crm.user_id = $1`,
      [req.userId]
    );
    const totalUnread = parseInt(unreadResult.rows[0].total_unread);

    const requestsResult = await pool.query("SELECT COUNT(*) AS cnt FROM friendships WHERE friend_id = $1 AND status = 'pending'", [req.userId]);
    const pendingRequests = parseInt(requestsResult.rows[0].cnt);

    const updatedRooms = await pool.query(
      `SELECT cr.id
       FROM chat_rooms cr
       JOIN chat_room_members crm ON cr.id = crm.room_id
       WHERE crm.user_id = $1
         AND EXISTS (
           SELECT 1 FROM chat_messages cm
           WHERE cm.room_id = cr.id AND cm.updated_at > NOW() - INTERVAL '30 seconds')
       ORDER BY (SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.room_id = cr.id) DESC`,
      [req.userId]
    );

    res.json({
      totalUnread,
      pendingRequests,
      updatedRoomIds: updatedRooms.rows.map((r) => r.id),
    });
  }));
};
