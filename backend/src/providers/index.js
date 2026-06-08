// Provider factory — selects the correct AI provider implementation

const PROVIDERS = {
  ecnu: {
    id: 'ecnu',
    name: 'ECNU (华师大)',
    models: [
      { id: 'ecnu-plus', name: 'ecnu-plus', streaming: true, jsonSchema: true },
      { id: 'ecnu-max', name: 'ecnu-max', streaming: true, jsonSchema: false }
    ]
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', streaming: true, jsonSchema: true },
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', streaming: true, jsonSchema: true }
    ]
  },
  openai: {
    id: 'openai',
    name: 'OpenAI ChatGPT',
    models: [
      { id: 'gpt-4o', name: 'gpt-4o', streaming: true, jsonSchema: true },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini', streaming: true, jsonSchema: true },
      { id: 'gpt-4.1', name: 'gpt-4.1', streaming: true, jsonSchema: true }
    ]
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    models: [
      { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash', streaming: true, jsonSchema: false },
      { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro', streaming: true, jsonSchema: false }
    ]
  }
};

function getProvider(name) {
  if (!name) return require('./ecnu');
  const id = name.toLowerCase();
  switch (id) {
    case 'ecnu': return require('./ecnu');
    case 'deepseek': return require('./deepseek');
    case 'openai': return require('./openai');
    case 'gemini': return require('./gemini');
    default: return require('./ecnu');
  }
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
  const id = (name || 'ecnu').toLowerCase();
  return PROVIDERS[id] || PROVIDERS.ecnu;
}

function getAllProviders() {
  return Object.values(PROVIDERS).map(function(p) { return { id: p.id, name: p.name, models: p.models }; });
}

module.exports = { getProvider, getProviderByModel, getProviderConfig, getAllProviders, PROVIDERS };
