'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('chat 路由治理', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);
  });

  it('创建会话类型非法 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/chat/rooms')
      .set('Authorization', 'Bearer ' + token)
      .send({ type: 'secret' });

    expect(res.status).toBe(422);
  });

  it('发送消息 msg_type 非法 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/chat/rooms/1/messages')
      .set('Authorization', 'Bearer ' + token)
      .send({ msg_type: 'bad' });

    expect(res.status).toBe(422);
  });

  it('非房间成员不能修改 quiz_data → 403', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT room_id FROM chat_messages WHERE id = \$1/, async () => ({ rows: [{ room_id: 1 }] })],
      [/SELECT 1 FROM chat_room_members WHERE room_id = \$1 AND user_id = \$2/, async () => ({ rows: [] })],
    ]);

    const res = await request(app)
      .post('/api/v1/chat/messages/1/update-quiz')
      .set('Authorization', 'Bearer ' + token)
      .send({ quiz_data: { questions: [] } });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('无权修改此消息');
  });
});
