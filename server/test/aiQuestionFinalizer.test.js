'use strict';

// round6 数量保障回归：自检（selfCheck）复核可能删除题目导致实际数量 < 要求数量
// （实测要求 15 题 → 自检后只返回 14）。修复：最终收口后再补一轮缺失题型。
const { finalizeAiQuestions } = require('../src/services/aiQuestionFinalizer');

function q(question, type, i) {
  const base = { id: i + 1, question, type, tag: 't', strategy: 'new', explanation: 'e' };
  if (type === 'single') return Object.assign({}, base, { options: ['A1', 'A2', 'A3', 'A4'], answer: 0 });
  if (type === 'judge') return Object.assign({}, base, { options: ['正确', '错误'], answer: 0 });
  return Object.assign({}, base, { options: [], answer: 0 });
}

function build(types) {
  const list = [];
  let n = 0;
  ['single', 'judge', 'term', 'short'].forEach((t) => {
    for (let i = 0; i < types[t]; i++) {
      list.push(q('题目' + t + (i + 1) + '_' + Math.random().toString(36).slice(2, 6), t, n++));
    }
  });
  return list;
}

function mkProvider(scripted) {
  let call = 0;
  return {
    name: 'fake',
    supportsJsonSchema: () => false,
    async chatCompletions() {
      const payload = scripted[Math.min(call, scripted.length - 1)];
      call++;
      if (payload === 'GARBAGE') return { choices: [{ message: { content: '这不是JSON' } }] };
      return { choices: [{ message: { content: JSON.stringify(payload) } }] };
    },
  };
}

const TC = { single: 5, judge: 5, term: 3, short: 2 };
const BASE = { provider: null, apiKey: 'sk-test', model: 'm', modelConfig: { maxOutput: 8192 }, sourceText: '资料' };

describe('aiQuestionFinalizer 数量保障 (round6)', () => {
  it('自检删题导致缺口 → 自检后补题，最终数量=要求数量', async () => {
    const raw = build(TC); // 15 题，配额无缺口，无需预补题
    const selfCheckResult = build({ single: 4, judge: 5, term: 3, short: 2 }); // 自检删 1 道单选
    const topUpQ = q('补出的单选', 'single', 999);
    const provider = mkProvider([selfCheckResult, [topUpQ]]);

    const out = await finalizeAiQuestions(Object.assign({}, BASE, {
      selfCheck: true, provider, rawQuestions: raw, typeCounts: TC,
    }));

    expect(out.questions).toHaveLength(15);
    expect(out.selfCheck.performed).toBe(true);
    expect(out.topUp.performed).toBe(true);
    expect(out.topUp.attempts).toBeGreaterThanOrEqual(1);
    expect(out.typeShortfall).toEqual({ single: 0, judge: 0, term: 0, short: 0 });
    expect(out.warnings.some((w) => w.indexOf('题型配额未完全满足') >= 0)).toBe(false);
    // 补出的题目确实并入
    expect(out.questions.some((x) => x.question === '补出的单选')).toBe(true);
  });

  it('自检后补题仍失败（两次无效返回）→ 优雅降级返回可用题目并给缺口警告', async () => {
    const raw = build(TC);
    const selfCheckResult = build({ single: 4, judge: 5, term: 3, short: 2 });
    const provider = mkProvider([selfCheckResult, 'GARBAGE', 'GARBAGE']);

    const out = await finalizeAiQuestions(Object.assign({}, BASE, {
      selfCheck: true, provider, rawQuestions: raw, typeCounts: TC,
    }));

    expect(out.questions).toHaveLength(14);
    expect(out.warnings.some((w) => w.indexOf('题型配额未完全满足') >= 0)).toBe(true);
    expect(out.typeShortfall.single).toBe(1);
  });

  it('未开自检的既有补题路径不回退（缺口在预补题阶段补足）', async () => {
    const raw = build({ single: 5, judge: 5, term: 2, short: 2 }); // 缺 1 名词解释
    const topUpQ = q('补出的名词解释', 'term', 999);
    const provider = mkProvider([[topUpQ]]);

    const out = await finalizeAiQuestions(Object.assign({}, BASE, {
      selfCheck: false, provider, rawQuestions: raw, typeCounts: TC,
    }));

    expect(out.questions).toHaveLength(15);
    expect(out.typeShortfall).toEqual({ single: 0, judge: 0, term: 0, short: 0 });
    expect(out.questions.some((x) => x.question === '补出的名词解释')).toBe(true);
  });
});
