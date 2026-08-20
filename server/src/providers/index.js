// Provider factory — selects the correct AI provider implementation
const {
  getProviderCatalogEntry,
  getModelCatalogEntry,
  getAllProviderCatalogEntries,
} = require('./catalog');
const { createOpenAICompatibleProvider } = require('./openaiCompatible');

// ECNU/DeepSeek/OpenAI 共享 OpenAI-compatible 实现。
const OPENAI_COMPATIBLE_PROVIDERS = {
  ecnu: createOpenAICompatibleProvider({
    name: 'ecnu',
    baseUrl: 'https://chat.ecnu.edu.cn/open/api/v1',
    defaultModel: 'ecnu-plus',
    envKey: 'ECNU_API_KEY',
    supportsJsonSchema(model) {
      return model === 'ecnu-plus' || model === 'ecnu-max' || model === 'ecnu-turbo';
    },
    supportsStreamWithJsonSchema(model) {
      return model === 'ecnu-plus' || model === 'ecnu-max' || model === 'ecnu-turbo';
    },
  }),
  deepseek: createOpenAICompatibleProvider({
    name: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    envKey: 'DEEPSEEK_API_KEY',
    mapResponseFormat(format) {
      if (format && format.type === 'json_schema') return { type: 'json_object' };
      return format;
    },
    supportsJsonSchema() { return false; },
    supportsStreamWithJsonSchema() { return true; },
  }),
  openai: createOpenAICompatibleProvider({
    name: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    envKey: 'OPENAI_API_KEY',
    supportsJsonSchema() { return true; },
    supportsStreamWithJsonSchema() { return true; },
  }),
};

function getProvider(name) {
  if (!name) return OPENAI_COMPATIBLE_PROVIDERS.ecnu;
  const id = name.toLowerCase();
  if (OPENAI_COMPATIBLE_PROVIDERS[id]) return OPENAI_COMPATIBLE_PROVIDERS[id];
  if (id === 'gemini') return require('./gemini');
  return OPENAI_COMPATIBLE_PROVIDERS.ecnu; // 兼容旧调用；生成/测试接口已通过 resolveProvider 严格校验。
}

function getProviderByModel(model) {
  if (!model) return 'ecnu';
  if (model.startsWith('ecnu-')) return 'ecnu';
  if (model.startsWith('deepseek-')) return 'deepseek';
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
  if (model.startsWith('gemini-')) return 'gemini';
  return 'ecnu';
}

function getProviderConfig(name) {
  return getProviderCatalogEntry(name);
}

function getAllProviders() {
  return getAllProviderCatalogEntries();
}

// 严格解析：未知 provider 返回 null，供生成/测试接口做 422 校验。
function resolveProvider(name) {
  const config = getProviderConfig(name);
  if (!config) return null;
  return getProvider(config.id);
}

function getModelConfig(providerName, modelId) {
  return getModelCatalogEntry(providerName, modelId);
}

module.exports = { getProvider, getProviderByModel, getProviderConfig, getAllProviders, getModelConfig, resolveProvider };