'use strict';

const {
  getAllProviderCatalogEntries,
  getProviderCatalogEntry,
  getModelCatalogEntry,
} = require('../src/providers/catalog');

describe('AI Provider Catalog', () => {
  it('四个官方 Provider 都具备能力描述', () => {
    const providers = getAllProviderCatalogEntries();
    expect(providers.map((p) => p.id).sort()).toEqual(['deepseek', 'ecnu', 'gemini', 'openai']);

    for (const provider of providers) {
      expect(provider.capabilities).toBeTruthy();
      expect(provider.defaults).toBeTruthy();
      expect(provider.models.length).toBeGreaterThan(0);
    }
  });

  it('ecnu-turbo 已补入目录，前端旧配置不失效', () => {
    expect(getModelCatalogEntry('ecnu', 'ecnu-turbo')).toBeTruthy();
  });

  it('未知 Provider 与不匹配模型返回 null', () => {
    expect(getProviderCatalogEntry('unknown')).toBeNull();
    expect(getModelCatalogEntry('deepseek', 'gpt-4o')).toBeNull();
  });
});
