'use strict';

const {
  normalizeQuestions,
  repairJson,
  tryExtractCompletedObjects,
} = require('../src/services/aiQuestionParser');

describe('AI 题目解析服务', () => {
  it('包装对象会被展开为题目数组', () => {
    const result = normalizeQuestions({
      multipleChoice: [
        { question: '1+1=?', options: ['1', '2'], answer: 1, tag: '数学', strategy: 'new' },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('single');
  });

  it('answer 字母 A/B/C/D 转为下标', () => {
    const result = normalizeQuestions([
      { question: '水的沸点？', options: ['0°C', '50°C', '100°C'], answer: 'C', tag: '物理', strategy: 'new' },
    ]);

    expect(result[0].answer).toBe(2);
  });

  it('repairJson 修复缺失冒号', () => {
    expect(repairJson('{"question" "你好"}')).toBe('{"question": "你好"}');
  });

  it('tryExtractCompletedObjects 从流式文本中提取闭合对象', () => {
    const text = '```json\n[{"question":"第一题","tag":"a","strategy":"new"},{"question":"第二题",';
    const first = tryExtractCompletedObjects(text, 0);
    expect(first).toHaveLength(1);
    expect(first[0].question).toBe('第一题');
  });
});
