'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('AI 后台任务 API', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
  });

  it('创建任务时只落库非敏感请求，不保存 API Key', async () => {
    let insertedRequest = null;
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/INSERT INTO ai_tasks \(user_id, chapter_id, status, request_json\)/, async (_sql, params) => {
        insertedRequest = JSON.parse(params[3]);
        return {
          rows: [{
            id: 1,
            user_id: params[0],
            chapter_id: params[1] || null,
            status: params[2],
            request_json: insertedRequest,
            result_json: null,
            error: null,
            created_at: new Date().toISOString(),
            started_at: null,
            finished_at: null,
          }],
        };
      }],
    ]);

    const res = await request(app)
      .post('/api/v1/ai/tasks')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send({ textContent: '资料', typeCounts: { single: 2, judge: 0, term: 0, short: 0 }, chapterId: 'ch1' });

    expect(res.status).toBe(202);
    expect(res.body.task.id).toBe(1);
    expect(insertedRequest.provider).toBe('ecnu');
    expect(insertedRequest.model).toBe('ecnu-plus');
    expect(insertedRequest.body.textContent).toBe('资料');
    expect(JSON.stringify(insertedRequest)).not.toContain('sk-test-key');
  });

  it('同一章节已有进行中任务 → 409（多端并发防重复生成 round5.1）', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT id FROM ai_tasks WHERE user_id = \$1 AND chapter_id = \$2 AND status IN/, async () => ({ rows: [{ id: 7 }] })],
    ]);

    const res = await request(app)
      .post('/api/v1/ai/tasks')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send({ textContent: '资料', typeCounts: { single: 1, judge: 0, term: 0, short: 0 }, chapterId: 'ch1' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('已有任务在生成中');
  });

  it('未知 Provider 创建任务 → 422', async () => {
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);

    const res = await request(app)
      .post('/api/v1/ai/tasks')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'unknown')
      .set('x-ai-model', 'unknown-model')
      .send({ textContent: '资料' });

    expect(res.status).toBe(422);
  });

  it('任务列表返回当前用户任务', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT \* FROM ai_tasks\s+WHERE user_id = \$1/, async () => ({
        rows: [{
          id: 1,
          user_id: 1,
          chapter_id: 'ch1',
          status: 'queued',
          request_json: { provider: 'ecnu', model: 'ecnu-plus', body: { textContent: 'x' } },
          result_json: null,
          error: null,
          created_at: new Date().toISOString(),
          started_at: null,
          finished_at: null,
        }],
      })],
    ]);

    const res = await request(app)
      .get('/api/v1/ai/tasks')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
  });
});
