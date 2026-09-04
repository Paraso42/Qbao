'use strict';

const { buildChapterHistoryPrompt } = require('../src/lib/chapterHistoryPrompt');

describe('chapterHistoryPrompt（round4.2 共享历史上下文）', () => {
  it('有 tagStats 时生成完整进度段落（含薄弱点与要求）', () => {
    const out = buildChapterHistoryPrompt({
      totalQuestions: 12,
      tagStats: { 力学: { total: 8, correct: 5, wrong: 3 }, 电学: { total: 4, correct: 4, wrong: 0 } },
      topWrongTags: ['力学'],
    });
    expect(out).toContain('已完成 12 道题');
    expect(out).toContain('力学: 出过8题，对5错3');
    expect(out).toContain('薄弱知识点（错题最多）：力学');
    expect(out).toContain('变式题');
    expect(out).toContain('单选题(single) → 判断题(judge)');
  });

  it('无 tagStats / 空对象 → 返回空串（不污染提示词）', () => {
    expect(buildChapterHistoryPrompt(null)).toBe('');
    expect(buildChapterHistoryPrompt({})).toBe('');
    expect(buildChapterHistoryPrompt({ tagStats: {} })).toBe('');
  });
});
