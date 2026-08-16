'use strict';

const { validateQuestionSet } = require('../src/services/aiQuestionValidator');

describe('AI 题目结构校验器', () => {
  it('合法客观题全部保留', () => {
    const result = validateQuestionSet([
      { type: 'single', question: '1+1=?', options: ['1', '2', '3', '4'], answer: 1, tag: '数学', strategy: 'new' },
      { type: 'judge', question: '地球是圆的吗？', options: ['正确', '错误'], answer: 0, tag: '地理', strategy: 'new' },
    ]);

    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(0);
  });

  it('单选题 answer 越界会被拦截', () => {
    const result = validateQuestionSet([
      { type: 'single', question: '1+1=?', options: ['1', '2'], answer: 9, tag: '数学', strategy: 'new' },
    ]);

    expect(result.validCount).toBe(0);
    expect(result.invalidCount).toBe(1);
    expect(result.warnings[0].errors.join(',')).toContain('answer 越界');
  });

  it('缺 tag 或题干过短会被拦截', () => {
    const result = validateQuestionSet([
      { type: 'term', question: 'ab', tag: 'x', strategy: 'new' },
      { type: 'short', question: '这是合法题干', strategy: 'new' },
    ]);

    expect(result.validCount).toBe(0);
    expect(result.invalidCount).toBe(2);
  });
});
