'use strict';

const { buildSelfCheckMessages, runAiSelfCheck } = require('../src/services/aiSelfCheck');
const { finalizeAiQuestions } = require('../src/services/aiQuestionFinalizer');

describe('AI 自动判定服务', () => {
  it('构建审核 prompt 时包含资料与待审题目', () => {
    const messages = buildSelfCheckMessages('资料内容', [{ question: '1+1=?', tag: '数学' }]);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('资料内容');
    expect(messages[1].content).toContain('1+1=?');
  });

  it('审核结果会再次经过结构校验', async () => {
    const provider = {
      chatCompletions: async () => ({
        choices: [{
          message: {
            content: JSON.stringify([
              { type: 'single', question: '2+2=?', options: ['3', '4'], answer: 1, tag: '数学', strategy: 'new' },
              { type: 'single', question: '非法题', options: ['x'], answer: 9, tag: '数学', strategy: 'new' },
            ]),
          },
        }],
      }),
    };

    const result = await runAiSelfCheck({
      provider,
      apiKey: 'sk-test-key-1234567890',
      model: 'ecnu-plus',
      modelConfig: { maxOutput: 4096 },
      sourceText: '2+2=4',
      questions: [{ question: '原始题', tag: '数学' }],
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].question).toBe('2+2=?');
    expect(result.warnings).toHaveLength(1);
  });

  it('关闭 selfCheck 时只做本机结构校验，不调用审核模型', async () => {
    const provider = { chatCompletions: vi.fn() };
    const result = await finalizeAiQuestions({
      selfCheck: false,
      provider,
      apiKey: 'sk-test-key-1234567890',
      model: 'ecnu-plus',
      modelConfig: { maxOutput: 4096 },
      sourceText: '',
      rawQuestions: [{ type: 'judge', question: '对错题', options: ['正确', '错误'], answer: 0, tag: '常识', strategy: 'new' }],
    });

    expect(result.questions).toHaveLength(1);
    expect(result.selfCheck.performed).toBe(false);
    expect(provider.chatCompletions).not.toHaveBeenCalled();
  });
});
