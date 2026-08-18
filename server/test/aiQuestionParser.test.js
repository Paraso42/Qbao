'use strict';

const {
  normalizeQuestions,
  repairJson,
  tryExtractCompletedObjects,
  applyTypeQuota,
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

  it('applyTypeQuota 按题型配额裁剪（5:5:3:2，过量产出 9:6:0:0 → 5:5:3:2）', () => {
    const raw = [];
    for (let i = 0; i < 9; i++) raw.push({ type: 'single', question: '单选' + i, options: ['a', 'b'], answer: 0, tag: 't', strategy: 'new' });
    for (let i = 0; i < 6; i++) raw.push({ type: 'judge', question: '判断' + i, options: ['正确', '错误'], answer: 0, tag: 't', strategy: 'new' });
    for (let i = 0; i < 3; i++) raw.push({ type: 'term', question: '名解' + i, tag: 't', strategy: 'new' });
    for (let i = 0; i < 2; i++) raw.push({ type: 'short', question: '简答' + i, tag: 't', strategy: 'new' });

    const result = applyTypeQuota(raw, { single: 5, judge: 5, term: 3, short: 2 });
    const dist = { single: 0, judge: 0, term: 0, short: 0 };
    result.questions.forEach((q) => dist[q.type]++);

    expect(dist).toEqual({ single: 5, judge: 5, term: 3, short: 2 });
    expect(result.questions).toHaveLength(15);
    expect(result.shortfall).toEqual({ single: 0, judge: 0, term: 0, short: 0 });
  });

  it('applyTypeQuota 未指定配额时原样放行', () => {
    const raw = [{ type: 'single', question: 'q', options: ['a', 'b'], answer: 0, tag: 't', strategy: 'new' }];
    expect(applyTypeQuota(raw).questions).toHaveLength(1);
    expect(applyTypeQuota(raw, null).questions).toHaveLength(1);
  });

  it('applyTypeQuota 某题型产出不足时给出 shortfall', () => {
    const raw = [{ type: 'single', question: 'q', options: ['a', 'b'], answer: 0, tag: 't', strategy: 'new' }];
    const result = applyTypeQuota(raw, { single: 5, judge: 5, term: 3, short: 2 });
    expect(result.shortfall).toEqual({ single: 4, judge: 5, term: 3, short: 2 });
  });
});
