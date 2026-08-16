'use strict';

const {
  sanitizeStateJson,
  sanitizeAiConfigObject,
  hasSensitiveAiConfig,
} = require('../src/lib/aiStateSanitizer');

describe('aiStateSanitizer', () => {
  it('剥离 state_json.aiConfig 中的 apiKey 与 providerKeys', () => {
    const state = {
      subjects: { s1: { name: '数学' } },
      aiConfig: {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-should-not-be-stored',
        providerKeys: { openai: 'sk-provider-key', deepseek: 'sk-ds-key' },
        systemPrompt: '保留',
      },
    };

    const clean = sanitizeStateJson(state);

    expect(clean.aiConfig.provider).toBe('openai');
    expect(clean.aiConfig.model).toBe('gpt-4o');
    expect(clean.aiConfig.systemPrompt).toBe('保留');
    expect(clean.aiConfig.apiKey).toBeUndefined();
    expect(clean.aiConfig.providerKeys).toBeUndefined();
    expect(clean.subjects).toEqual(state.subjects);
  });

  it('sanitizeAiConfigObject 单独清理 aiConfig 对象', () => {
    const clean = sanitizeAiConfigObject({
      model: 'ecnu-plus',
      apiKey: 'secret',
      providerKeys: { ecnu: 'secret' },
    });

    expect(clean).toEqual({ model: 'ecnu-plus' });
  });

  it('hasSensitiveAiConfig 能识别需要清理的旧数据', () => {
    expect(hasSensitiveAiConfig({ aiConfig: { apiKey: 'x' } })).toBe(true);
    expect(hasSensitiveAiConfig({ aiConfig: { providerKeys: { ecnu: 'x' } } })).toBe(true);
    expect(hasSensitiveAiConfig({ aiConfig: { model: 'gpt-4o' } })).toBe(false);
    expect(hasSensitiveAiConfig(null)).toBe(false);
  });

  it('不修改原对象', () => {
    const state = { aiConfig: { apiKey: 'secret', model: 'gpt-4o' } };
    sanitizeStateJson(state);
    expect(state.aiConfig.apiKey).toBe('secret');
  });
});
