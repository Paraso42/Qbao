'use strict';
// vitest 配置了 globals: true（test/describe/afterEach/expect 均为全局）
// 这里用 expect 实现 node:assert 的最小子集，保持断言写法与其它用例一致
const assert = {
  strictEqual: (a, b, msg) => expect(a, msg).toBe(b),
  ok: (v, msg) => expect(!!v, msg).toBe(true),
};

const { runAiSelfCheck, buildSelfCheckMessages } = require('../src/services/aiSelfCheck');
const { resolveProvider } = require('../src/providers');

const UPSTREAM = 'https://chat.ecnu.edu.cn/open/api/v1/chat/completions';
const QUESTIONS = [
  { type: 'single', question: '暗反应发生在哪里？', options: ['类囊体薄膜', '叶绿体基质', '细胞质基质', '线粒体'], answer: 1, tag: '场所', strategy: 'new', explanation: '在叶绿体基质中。' },
  { type: 'judge', question: '光反应在类囊体薄膜上进行。', options: ['正确', '错误'], answer: 0, tag: '场所', strategy: 'new', explanation: '正确。' },
];

function reply(content, completionTokens) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({
      id: 'c', object: 'chat.completion', model: 'ecnu-plus',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 400, completion_tokens: completionTokens, total_tokens: 400 + completionTokens },
    }),
  };
}

// 依次返回多个响应；超出后重复最后一个
function installUpstream(responses) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    const body = JSON.parse((opts && opts.body) || '{}');
    calls.push({ url: String(url), body });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return typeof r === 'function' ? r(body) : r;
  };
  return { calls, restore: () => { global.fetch = orig; } };
}

const provider = resolveProvider('ecnu');
const ARGS = { provider, apiKey: 'sk-live-test-key-0123456789', model: 'ecnu-plus', modelConfig: { maxOutput: 4096 }, sourceText: '光合作用分为光反应与暗反应。' };

describe('AI 自动判定 —— 模型空转兜底重试', () => {
  let up = null;
  afterEach(() => { if (up) { up.restore(); up = null; } });

  test('首次返回空数组且几乎没消耗 tokens → 补显式指令重试并采用第二次结果', async () => {
    up = installUpstream([
      reply('[]', 2),
      reply(JSON.stringify(QUESTIONS), 111),
    ]);
    const r = await runAiSelfCheck({ ...ARGS, questions: QUESTIONS });

    assert.strictEqual(up.calls.length, 2, '第二次成功后不得再多打上游');
    assert.strictEqual(up.calls[0].url, UPSTREAM);
    // 第一次是原始提示词：不含「原样保留」约束
    assert.ok(!up.calls[0].body.messages[0].content.includes('原样保留'));
    // 第二次追加了显式指令
    assert.ok(up.calls[1].body.messages[0].content.includes('原样保留'), '第二次提示词须含原样保留约束');
    // 两次都带上了完整题目载荷
    assert.ok(up.calls[1].body.messages[1].content.includes('暗反应发生在哪里'));
    assert.strictEqual(r.questions.length, 2);
    assert.strictEqual(r.retried, true);
    assert.strictEqual(r.unengaged, null, '第二次已真正参与，不应再标记空转');
  });

  test('连续空转（达最大尝试次数）→ 返回空题目且标记 unengaged，且不无限重试', async () => {
    up = installUpstream([reply('[]', 2), reply('[]', 2)]);
    const r = await runAiSelfCheck({ ...ARGS, questions: QUESTIONS });

    assert.strictEqual(up.calls.length, 3, '最多 3 次尝试后必须停止');
    assert.strictEqual(r.questions.length, 0);
    assert.strictEqual(r.retried, true);
    assert.ok(r.unengaged && r.unengaged.completionTokens === 2, '须记录空转信号');
  });

  test('前两次空转、第三次成功 → 采用第三次结果', async () => {
    up = installUpstream([reply('[]', 2), reply('[]', 2), reply(JSON.stringify(QUESTIONS), 130)]);
    const r = await runAiSelfCheck({ ...ARGS, questions: QUESTIONS });

    assert.strictEqual(up.calls.length, 3);
    assert.strictEqual(r.questions.length, 2);
    assert.strictEqual(r.retried, true);
    assert.strictEqual(r.unengaged, null);
    // 第 2、3 次尝试都应带严格指令
    assert.ok(up.calls[1].body.messages[0].content.includes('原样保留'));
    assert.ok(up.calls[2].body.messages[0].content.includes('原样保留'));
  });

  test('模型认真审完并把题全删了（消耗大量 tokens）→ 不重试、不误判为空转', async () => {
    up = installUpstream([reply('[]', 800)]);
    const r = await runAiSelfCheck({ ...ARGS, questions: QUESTIONS });

    assert.strictEqual(up.calls.length, 1, '真实审核结果不得重试');
    assert.strictEqual(r.questions.length, 0);
    assert.strictEqual(r.retried, false);
    assert.strictEqual(r.unengaged, null);
  });

  test('正常返回修复后的数组 → 单次调用，retried=false', async () => {
    up = installUpstream([reply(JSON.stringify(QUESTIONS), 140)]);
    const r = await runAiSelfCheck({ ...ARGS, questions: QUESTIONS });

    assert.strictEqual(up.calls.length, 1);
    assert.strictEqual(r.questions.length, 2);
    assert.strictEqual(r.retried, false);
    assert.strictEqual(r.unengaged, null);
  });

  test('buildSelfCheckMessages: strictKeepAll 只影响提示词，不改动载荷', () => {
    const plain = buildSelfCheckMessages('资料', QUESTIONS);
    const strict = buildSelfCheckMessages('资料', QUESTIONS, { strictKeepAll: true });
    assert.ok(!plain[0].content.includes('原样保留'));
    assert.ok(strict[0].content.includes('原样保留'));
    assert.strictEqual(plain[1].content, strict[1].content);
    assert.ok(strict[0].content.trimEnd().split('\n').pop().startsWith('7. 只输出纯 JSON 数组'));
  });
});
