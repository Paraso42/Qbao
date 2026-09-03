'use strict';

// P3.1 错题 AI 讲解端点测试：成功计费 / 失败不计费 / 校验与鉴权。
const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

function openaiShape(content) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  };
}

function validBody() {
  return {
    question: {
      type: 'single',
      question: '函数 f(x)=x^2 的导数是？',
      options: ['2x', 'x', 'x^2', '2'],
      answer: 0,
      tag: '导数',
    },
    userAnswer: 1,
  };
}

describe('AI 错题讲解端点 (P3.1)', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(7, 'user');
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      // 配额：免费额度内（COUNT 返回 0）
      [/SELECT COUNT\(\*\)::int AS c FROM ai_request_log/, async () => ({ rows: [{ c: 0 }] })],
      [/SELECT COUNT\(\*\)::int AS c FROM ai_tasks/, async () => ({ rows: [{ c: 0 }] })],
    ]);
  });

  afterEach(() => {
    delete globalThis.fetch;
  });

  it('成功：返回讲解文本并记账（started + ok，免费额度内不扣分）', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts && opts.body) });
      return openaiShape('第一步：求导……\n因此答案是 **2x**。');
    };
    const res = await request(app)
      .post('/api/v1/ai/explain')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.explanation).toContain('第一步');
    expect(res.body.model).toBe('ecnu-plus');
    expect(res.body.provider).toBe('ecnu');
    // 请求确实把题目/用户作答/标准答案拼进了 messages
    const userMsg = calls[0].body.messages[1].content;
    expect(userMsg).toContain('f(x)=x^2');
    expect(userMsg).toContain('标准答案');
    expect(userMsg).toContain('用户的作答');
  });

  it('用户未作答时消息不含作答行、仍可讲解', async () => {
    globalThis.fetch = async () => openaiShape('（用户未作答，直接讲思路）');
    const body = validBody();
    delete body.userAnswer;
    const res = await request(app)
      .post('/api/v1/ai/explain')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.explanation).toContain('未作答');
  });

  it('provider 调用失败 → 502 且不返回讲解（不计费路径）', async () => {
    globalThis.fetch = async () => { throw new Error('upstream down') };
    const res = await request(app)
      .post('/api/v1/ai/explain')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send(validBody());
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('讲解生成失败');
  });

  it('AI 返回空内容 → 502', async () => {
    globalThis.fetch = async () => openaiShape('');
    const res = await request(app)
      .post('/api/v1/ai/explain')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send(validBody());
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('未返回讲解内容');
  });

  it('body 校验：question.question 缺失 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/explain')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .send({ question: { type: 'single', options: ['a', 'b'] } });
    expect(res.status).toBe(422);
  });

  it('缺少 AI API Key → 401', async () => {
    const res = await request(app)
      .post('/api/v1/ai/explain')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send(validBody());
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('AI API Key');
  });

  it('未知 Provider → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/explain')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'nope')
      .set('x-ai-model', 'nope-model')
      .send(validBody());
    expect(res.status).toBe(422);
  });

  it('超额时成功讲解会走扣费路径（成功才计费语义）', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT COUNT\(\*\)::int AS c FROM ai_request_log/, async () => ({ rows: [{ c: 20 }] })],
      [/SELECT COUNT\(\*\)::int AS c FROM ai_tasks/, async () => ({ rows: [{ c: 0 }] })],
      [/INSERT INTO points_ledger/, async () => ({ rows: [{ id: 1 }] })],
      [/UPDATE user_points/, async () => ({ rows: [{ balance: 95 }] })],
    ]);
    globalThis.fetch = async () => openaiShape('超额讲解内容');
    const res = await request(app)
      .post('/api/v1/ai/explain')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send(validBody());
    expect(res.status).toBe(200);
    expect(res.body.explanation).toContain('超额讲解内容');
  });
});
