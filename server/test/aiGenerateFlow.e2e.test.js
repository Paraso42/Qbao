'use strict';

// /api/v1/ai/tasks 全链路（路由 → 服务端任务队列 → Provider 适配器 → 出题后处理 → 落库）
// 用可控假池 + 假 fetch 打通「创建任务 → worker 领取 → 调上游 → 校验/整理 → 完成」，
// 断言发往 ECNU 的请求体形态、题目类型/答案形态与任务终态，覆盖 queue worker 这条
// 与 /ai/generate 直连路径**不同**的代码路径（v3.27 起客户端默认走任务队列）。

const request = require('supertest');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');
const { pool } = require('../src/db');
const { processNextAiTask } = require('../src/services/aiTaskService');
const { getAiTask } = require('../src/services/aiTaskService');

const app = createApp();

const UPSTREAM = 'https://chat.ecnu.edu.cn/open/api/v1/chat/completions';

// —— 有状态假池：只实现 worker 全链路真正会碰到的 SQL ——
function installStatefulPool() {
  const db = { tasks: [], nextId: 1 };
  const query = async (sql, params = []) => {
    const s = String(sql);
    if (/SELECT is_banned FROM users/.test(s)) return { rows: [] };
    if (/INSERT INTO ai_generation_locks/.test(s)) return { rows: [{ id: 1 }], rowCount: 1 };
    if (/DELETE FROM ai_generation_locks/.test(s)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO ai_tasks/.test(s)) {
      const row = {
        id: db.nextId++,
        user_id: params[0],
        chapter_id: params[1] || null,
        status: params[2],
        request_json: JSON.parse(params[3]),
        result_json: null,
        error: null,
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
      };
      db.tasks.push(row);
      return { rows: [Object.assign({}, row)], rowCount: 1 };
    }
    if (/SELECT COUNT\(\*\)::int AS c FROM ai_tasks/.test(s)) return { rows: [{ c: 0 }] };
    if (/SELECT id FROM ai_tasks/.test(s)) {
      const t = db.tasks.find((x) => x.status === 'queued');
      return { rows: t ? [{ id: t.id }] : [] };
    }
    if (/UPDATE ai_tasks\s+SET status = \$2, started_at = NOW\(\)/.test(s)) {
      const t = db.tasks.find((x) => x.id === params[0]);
      if (t) { t.status = params[1]; t.started_at = new Date().toISOString(); }
      return { rows: [Object.assign({}, t)], rowCount: 1 };
    }
    if (/UPDATE ai_tasks\s+SET status = \$2, result_json/.test(s)) {
      const t = db.tasks.find((x) => x.id === params[0]);
      if (t) { t.status = params[1]; t.result_json = JSON.parse(params[2]); t.finished_at = new Date().toISOString(); }
      return { rows: [Object.assign({}, t)], rowCount: 1 };
    }
    if (/UPDATE ai_tasks\s+SET status = \$2, error/.test(s)) {
      const t = db.tasks.find((x) => x.id === params[0]);
      if (t) { t.status = params[1]; t.error = params[2]; t.finished_at = new Date().toISOString(); }
      return { rows: [Object.assign({}, t)], rowCount: 1 };
    }
    if (/SELECT \* FROM ai_tasks WHERE id = \$1 AND user_id = \$2/.test(s)) {
      const t = db.tasks.find((x) => x.id === params[1] && x.user_id === params[0]);
      return { rows: t ? [Object.assign({}, t)] : [] };
    }
    if (/SELECT status FROM ai_tasks WHERE id = \$1/.test(s)) {
      const t = db.tasks.find((x) => x.id === params[0]);
      return { rows: t ? [{ status: t.status }] : [] };
    }
    if (/FROM ai_request_log/.test(s)) return { rows: [{ c: 0 }] };
    return { rows: [], rowCount: 0 };
  };
  pool.query = query;
  pool.connect = async () => ({
    query: async (sql, params = []) => {
      const s = String(sql).trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return { rows: [] };
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      return query(sql, params);
    },
    release: () => {},
  });
  return db;
}

// 假上游：ECNU OpenAI 兼容响应
function installUpstream({ questions, status = 200, statusText = 'OK', raw = null, scripts = null }) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    const call = { url: String(url), opts, body: JSON.parse((opts && opts.body) || '{}') };
    calls.push(call);
    const scripted = scripts ? scripts[Math.min(calls.length - 1, scripts.length - 1)] : null;
    if (scripted && scripted.raw !== undefined) {
      return { ok: true, status: 200, statusText: 'OK', text: async () => scripted.raw };
    }
    const payload = raw !== null
      ? raw
      : JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: 'ecnu-plus',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(questions) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 },
      });
    return { ok: status >= 200 && status < 300, status, statusText, text: async () => payload };
  };
  return { calls, restore: () => { global.fetch = orig; } };
}

async function drainWorker(max = 6) {
  for (let i = 0; i < max; i++) {
    const ran = await processNextAiTask();
    if (!ran) return;
  }
}

function sampleQuestions() {
  return [
    { id: 'q1', type: 'single', question: '以下哪项属于操作系统？', options: ['Windows', 'Word', 'Excel', 'Chrome'], answer: 0, tag: '操作系统', strategy: 'new', explanation: 'Windows 是操作系统。' },
    { id: 'q2', type: 'single', question: 'CPU 的中文全称是？', options: ['中央处理器', '内存', '硬盘', '显卡'], answer: 0, tag: '硬件', strategy: 'new', explanation: 'CPU = 中央处理器。' },
    { id: 'q3', type: 'judge', question: 'RAM 断电后数据会丢失。', options: ['正确', '错误'], answer: 0, tag: '存储器', strategy: 'new', explanation: 'RAM 是易失性存储。' },
    { id: 'q4', type: 'term', question: '请解释「进程」。', answer: '进程是程序在数据集合上的一次运行活动，是系统资源分配的基本单位。', tag: '进程', strategy: 'new', explanation: '' },
    { id: 'q5', type: 'short', question: '简述进程与线程的区别。', answer: '进程是资源分配的基本单位，线程是 CPU 调度的基本单位；同一进程内的线程共享地址空间。', tag: '进程', strategy: 'new', explanation: '' },
  ];
}

describe('AI 出题全链路（任务队列）', () => {
  let token;
  let upstream;
  let db;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    db = installStatefulPool();
  });

  afterEach(() => { if (upstream) upstream.restore(); });

  it('创建任务 → worker 领取 → 上游出题 → 整理落库 → completed，且发往 ECNU 的请求形态正确', async () => {
    upstream = installUpstream({ questions: sampleQuestions() });

    const created = await request(app)
      .post('/api/v1/ai/tasks')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-0123456789')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send({
        textContent: '操作系统是管理计算机硬件与软件资源的程序。CPU 是中央处理器，RAM 是随机存取存储器。',
        typeCounts: { single: 2, judge: 1, term: 1, short: 1 },
        selfCheck: false,
      });

    expect(created.status).toBe(202);
    expect(created.body.task.status).toBe('queued');
    expect(JSON.stringify(created.body.task)).not.toContain('sk-live-test-key');

    await drainWorker();

    // 发往上游的请求形态（这是"正常 AI 出题过程"真正打到 ECNU 的那一跳）
    expect(upstream.calls.length).toBe(1);
    const call = upstream.calls[0];
    expect(call.url).toBe(UPSTREAM);
    expect(call.opts.method).toBe('POST');
    expect(call.opts.headers.Authorization).toBe('Bearer sk-test-key-0123456789');
    expect(call.opts.headers['Content-Type']).toBe('application/json');
    expect(call.body.model).toBe('ecnu-plus');
    expect(call.body.stream).toBe(false);
    expect(call.body.messages.length).toBe(2);
    expect(call.body.messages[0].role).toBe('system');
    expect(call.body.messages[1].role).toBe('user');
    expect(call.body.messages[1].content).toContain('操作系统是管理计算机硬件与软件资源的程序');
    expect(call.body.max_tokens).toBeGreaterThanOrEqual(1024);
    expect(call.opts.signal).toBeTruthy();

    // 任务终态与题目整理结果
    const task = await getAiTask(1, 1);
    expect(task.status).toBe('completed');
    expect(task.error).toBe(null);
    const result = task.result;
    expect(Array.isArray(result.questions)).toBe(true);
    expect(result.questions.length).toBe(5);
    const byType = {};
    result.questions.forEach((q) => { byType[q.type] = (byType[q.type] || 0) + 1; });
    expect(byType).toEqual({ single: 2, judge: 1, term: 1, short: 1 });
    // 客观题答案必须是合法下标；判断题选项固定
    result.questions.filter((q) => q.type === 'single').forEach((q) => {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(Number.isInteger(q.answer)).toBe(true);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.options.length);
    });
    const judge = result.questions.find((q) => q.type === 'judge');
    expect(judge.options).toEqual(['正确', '错误']);
    expect([0, 1]).toContain(judge.answer);
    // 用量透传（前端显示 token 消耗）
    expect(result.usage).toEqual({ prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 });
    expect(db.tasks[0].status).toBe('completed');
  });

  it('上游 401（Key 无效）→ 任务 failed 且错误文案带上游信息，不误报为题目解析失败', async () => {
    upstream = installUpstream({ questions: null, status: 401, statusText: 'Unauthorized', raw: '{"detail":"invalid api key"}' });

    await request(app)
      .post('/api/v1/ai/tasks')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-bad-key-0123456789')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send({ textContent: '资料', typeCounts: { single: 1 }, selfCheck: false });

    await drainWorker();

    const task = await getAiTask(1, 1);
    expect(task.status).toBe('failed');
    expect(task.error).toContain('401');
    expect(task.error).toContain('invalid api key');
  });

  it('上游首次返回非 JSON（HTTP 200）→ 触发纠正性重试，第二次拿到纯 JSON 后任务仍能 completed', async () => {
    upstream = installUpstream({
      scripts: [
        { raw: '抱歉，我无法完成该请求。' },
        { raw: JSON.stringify({ id: 'c2', object: 'chat.completion', model: 'ecnu-plus', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify([{ id: 'q1', type: 'single', question: '1+1=?', options: ['1', '2', '3', '4'], answer: 1, tag: '算术', strategy: 'new', explanation: '等于 2。' }]) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) },
      ],
    });

    await request(app)
      .post('/api/v1/ai/tasks')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-0123456789')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send({ textContent: '资料', typeCounts: { single: 1 }, selfCheck: false });

    await drainWorker(10);

    // 关键回归：适配器曾把"HTTP 200 + 非 JSON"直接抛出，"纠正性重试"分支永远走不到，
    // 任务立刻 failed；修复后第一次的原始输出被带进纠正提示词，第二次正常出题。
    expect(upstream.calls.length).toBe(2);
    expect(upstream.calls[1].body.messages[1].content).toContain('抱歉，我无法完成该请求。');
    expect(upstream.calls[1].body.messages[1].content).toContain('上次返回了无效JSON');
    const task = await getAiTask(1, 1);
    expect(task.status).toBe('completed');
    expect(task.result.questions.length).toBe(1);
    expect(task.result.questions[0].question).toBe('1+1=?');
  });

  it('上游连续返回非 JSON 垃圾 → 重试后 0 题，任务必须 failed（不得报完成却 0 题）', async () => {
    upstream = installUpstream({ questions: null, raw: '抱歉，我无法完成该请求。' });

    await request(app)
      .post('/api/v1/ai/tasks')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-0123456789')
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send({ textContent: '资料', typeCounts: { single: 1 }, selfCheck: false });

    await drainWorker(10);

    // 1 次首次调用 + ≤2 次纠正性重试 + 题型缺口补题（top-up 两轮，各自重试）
    expect(upstream.calls.length).toBeGreaterThanOrEqual(3);
    // 前三次必须是"首次 + 纠正性重试"：原始垃圾输出被带进纠正提示词
    expect(upstream.calls[1].body.messages[1].content).toContain('上次返回了无效JSON');
    expect(upstream.calls[2].body.messages[1].content).toContain('上次返回了无效JSON');
    const task = await getAiTask(1, 1);
    expect(task.status).toBe('failed');
    expect(task.error).toContain('AI 未返回可用题目');
  });
});
