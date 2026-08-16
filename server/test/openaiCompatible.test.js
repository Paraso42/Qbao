'use strict';

const { getProvider } = require('../src/providers');

describe('OpenAI-compatible Provider 工厂', () => {
  it('ECNU/DeepSeek/OpenAI 返回统一基座实例', () => {
    const ecnu = getProvider('ecnu');
    const deepseek = getProvider('deepseek');
    const openai = getProvider('openai');

    expect(ecnu.name).toBe('ecnu');
    expect(deepseek.name).toBe('deepseek');
    expect(openai.name).toBe('openai');

    expect(typeof ecnu.chatCompletions).toBe('function');
    expect(typeof ecnu.streamChatCompletions).toBe('function');
  });

  it('能力函数与目录保持一致', () => {
    expect(getProvider('ecnu').supportsJsonSchema('ecnu-plus')).toBe(true);
    expect(getProvider('deepseek').supportsJsonSchema('deepseek-v4-flash')).toBe(false);
    expect(getProvider('openai').supportsJsonSchema('gpt-4o')).toBe(true);
    expect(getProvider('gemini').supportsJsonSchema('gemini-2.5-flash')).toBe(false);
  });
});
