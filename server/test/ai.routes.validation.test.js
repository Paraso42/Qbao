'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('AI 路由参数与 Provider 校验', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);
  });

  it('typeCounts 非法类型 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .send({ textContent: '资料', typeCounts: { single: 'many' } });

    expect(res.status).toBe(422);
  });

  it('单次生成超过 200 题 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .send({ typeCounts: { single: 50, judge: 50, term: 50, short: 51 } });

    expect(res.status).toBe(422);
  });

  it('缺少 AI API Key → 401', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send({ textContent: '资料', typeCounts: { single: 1 } });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('AI API Key');
  });

  it('未知 Provider → 422，不再静默回退', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'unknown-provider')
      .set('x-ai-model', 'some-model')
      .send({ textContent: '资料', typeCounts: { single: 1 } });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('未知 AI 供应商');
  });

  it('Provider 与模型不匹配 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'deepseek')
      .set('x-ai-model', 'gpt-4o')
      .send({ textContent: '资料', typeCounts: { single: 1 } });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('模型与供应商不匹配');
  });

  it('/ai/test 未知 Provider → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/test')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'nope')
      .set('x-ai-model', 'nope-model')
      .send({ message: 'ping' });

    expect(res.status).toBe(422);
  });

  it('P0.8 上传超出配额 → 400 且 multer 落盘文件被清理（无磁盘残留）', async () => {
    const fs = require('fs');
    const path = require('path');
    const uploadRoot = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });
    const before = fs.readdirSync(uploadRoot).length;
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      // 已用完当日免费解析次数 → 走扣费；余额不足 → ApiError 400
      [/SELECT COUNT\(\*\)::int AS c FROM ai_request_log/, async () => ({ rows: [{ c: 20 }] })],
      [/UPDATE users SET storage_points = storage_points -/, async () => ({ rows: [] })],
      [/SELECT storage_points FROM users/, async () => ({ rows: [{ storage_points: 2 }] })],
    ]);
    // P0.7 后配额检查在真实 pool 上走事务；helpers 默认把 pool.connect 也 stub 成
    // fake client，测试封闭（不触真实 PostgreSQL），失败路径应 400 并清理落盘文件。
    const res = await request(app)
      .post('/api/v1/ai/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('files', Buffer.from('quota-fail-sample-content'), { filename: 'sample.txt' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('积分不足');
    const after = fs.readdirSync(uploadRoot).length;
    expect(after).toBe(before); // 配额失败路径已清理本次落盘文件
  });

  // —— P0-6：审计行只在参数校验通过后写入 ——
  it('缺少 AI API Key → 401 且不写 ai_request_log（P0-6 审计噪音回归）', async () => {
    const seen = [];
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/INSERT INTO ai_request_log/, async (sql, params) => { seen.push(params); return { rows: [] }; }],
    ]);
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send({ textContent: '资料', typeCounts: { single: 1 } });

    expect(res.status).toBe(401);
    // 旧实现：先写 started 再校验 Key，401 时 catch 又因 req.aiModel 已赋值补写 error，
    // 单次失败请求在 ai_request_log 留下两条噪音。修复后 0 条。
    expect(seen).toEqual([]);
  });

  it('/ai/providers 需要登录（P1-5：不再匿名暴露上游 provider 清单）', async () => {
    const anon = await request(app).get('/api/v1/ai/providers');
    expect(anon.status).toBe(401);

    const authed = await request(app)
      .get('/api/v1/ai/providers')
      .set('Authorization', 'Bearer ' + token);
    expect(authed.status).toBe(200);
    expect(Array.isArray(authed.body.providers)).toBe(true);
    expect(Array.isArray(authed.body.models)).toBe(true);
  });

  // —— P1-4：AI 上传通道与其它三条通道共用白名单 + 总体积上限 ——
  describe('P1-4 上传白名单与总体积上限', () => {
    const fs = require('fs');
    const path = require('path');
    const uploadRoot = path.join(__dirname, '..', '..', 'uploads');
    const countFiles = () => (fs.existsSync(uploadRoot) ? fs.readdirSync(uploadRoot).length : 0);

    it('非白名单扩展名 → 422，且一个字节都不落盘', async () => {
      const before = countFiles();
      const res = await request(app)
        .post('/api/v1/ai/upload')
        .set('Authorization', 'Bearer ' + token)
        .attach('files', Buffer.from('MZ-executable-body'), { filename: 'payload.exe' });

      expect(res.status).toBe(422);
      expect(res.body.error).toContain('不支持的文件类型');
      // 旧实现：只有体积限制，.exe 会先被 multer 写进 uploads/ 再报「不支持」。
      // 现在 fileFilter 在落盘前拦截，磁盘文件数必须不变。
      expect(countFiles()).toBe(before);
    });

    it('可脚本化类型（.svg/.html）同样被拦下', async () => {
      const before = countFiles();
      for (const filename of ['x.svg', 'x.html']) {
        const res = await request(app)
          .post('/api/v1/ai/upload')
          .set('Authorization', 'Bearer ' + token)
          .attach('files', Buffer.from('<script>alert(1)</script>'), { filename });
        expect(res.status).toBe(422);
      }
      expect(countFiles()).toBe(before);
    });

    it('单次总量超过 60MB → 413，并清理本请求已落盘分片', async () => {
      // 注意：进入体积检查必须先是合法扩展名（否则 422 短路）。配额走「免费次数内」
      // 分支（fake pool 的空结果 → used=0 < AI_UPLOAD_FREE_DAILY），不触发扣费。
      const before = countFiles();
      // 4 × 16MB = 64MB > 60MB 总量上限，同时每片都低于 multer 的单文件 20MB 上限
      // ——否则会被单文件限制先拦下（413 文案变成「单个文件超过 20MB」），测不到总量守卫。
      const chunk = Buffer.alloc(16 * 1024 * 1024, 0x61);
      let req = request(app)
        .post('/api/v1/ai/upload')
        .set('Authorization', 'Bearer ' + token);
      for (let i = 0; i < 4; i++) req = req.attach('files', chunk, { filename: 'part' + i + '.txt' });

      const res = await req;
      expect(res.status).toBe(413);
      expect(res.body.error).toContain('总体积过大');
      // 三个分片都已落盘，必须在 413 出口被清掉，否则每次超限请求都留下 63MB 垃圾
      expect(countFiles()).toBe(before);
    });
  });
});
