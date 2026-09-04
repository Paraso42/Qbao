'use strict';

// globals: true（vitest.config）—— 直接使用全局 describe/it/expect/vi，不做 CJS require。

const { installFakePool } = require('./helpers');
const { assertChapterCanGenerate } = require('../src/services/chapterSessionGuard');
const pointsService = require('../src/services/pointsService');

describe('chapterSessionGuard（出题前会话规则，round4）', () => {
  let calls;
  let savedAward;

  beforeEach(() => {
    calls = { updateStatus: [], deleteIds: [] };
    // 打桩发分（守卫在调用点读属性，运行时替换即可）
    savedAward = pointsService.awardQuizCompletion;
    pointsService.awardQuizCompletion = vi.fn(async () => ({ awarded: true, points: 4, balance: 10 }));
  });
  afterEach(() => {
    pointsService.awardQuizCompletion = savedAward;
    vi.restoreAllMocks();
  });

  function poolWith(row) {
    installFakePool([
      [/SELECT id, questions, user_answers, stats FROM answer_sessions/, () => ({ rows: row ? [row] : [] })],
      [/UPDATE answer_sessions SET status = 'completed'/, (sql, params) => {
        calls.updateStatus.push(params);
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }],
      [/DELETE FROM answer_sessions/, (sql, params) => {
        calls.deleteIds.push(params[0]);
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }],
    ]);
  }

  it('无进行中会话 → 放行', async () => {
    poolWith(null);
    await expect(assertChapterCanGenerate(1, 'ch1')).resolves.toBeUndefined();
  });

  it('有未答完的会话 → 409，给出已答/总题数', async () => {
    poolWith({
      id: 11,
      questions: [{ question: 'A' }, { question: 'B' }, { question: 'C' }],
      user_answers: [0, undefined, null],
      stats: { objCorrect: 1 },
    });
    await expect(assertChapterCanGenerate(1, 'ch1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('已答 1/3 题'),
    });
  });

  it('已全部作答却仍是 in_progress（离线答完/结算中断）→ 自动升级 completed 并补结算，不再锁死出题', async () => {
    const row = {
      id: 22,
      questions: [{ question: 'A' }, { question: 'B' }, { question: 'C' }],
      user_answers: [0, 1, 2],
      stats: { objCorrect: 3 },
    };
    poolWith(row);
    await expect(assertChapterCanGenerate(1, 'ch1')).resolves.toBeUndefined();
    expect(calls.updateStatus).toHaveLength(1);
    expect(calls.updateStatus[0][0]).toBe(22);
    expect(pointsService.awardQuizCompletion).toHaveBeenCalledTimes(1);
    expect(pointsService.awardQuizCompletion.mock.calls[0][3]).toEqual({ objCorrect: 3 });
  });

  it('空题会话（垃圾数据）→ 删除并放行', async () => {
    poolWith({ id: 33, questions: [], user_answers: [], stats: {} });
    await expect(assertChapterCanGenerate(1, 'ch1')).resolves.toBeUndefined();
    expect(calls.deleteIds).toEqual([33]);
  });
});
