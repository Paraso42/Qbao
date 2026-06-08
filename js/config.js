const API_BASE = '/api/v1';
let authToken = null;
let authUser = null;
let isOnlineMode = false;
let syncPending = false;
let syncTimer = null;
let aiTimer = null;
let aiGenerating = false;
let aiTaskRunnerActive = false;
let aiTaskAbortController = null;
let aiProviders = [
  { id: 'ecnu', name: 'ECNU (华师大)', models: [
    { id: 'ecnu-plus', name: 'ecnu-plus', streaming: true, jsonSchema: true },
    { id: 'ecnu-max', name: 'ecnu-max', streaming: true, jsonSchema: true }
  ]},
  { id: 'deepseek', name: 'DeepSeek', models: [
    { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', streaming: true, jsonSchema: false },
    { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', streaming: true, jsonSchema: false }
  ]},
  { id: 'openai', name: 'OpenAI ChatGPT', models: [
    { id: 'gpt-4o', name: 'gpt-4o', streaming: true, jsonSchema: true },
    { id: 'gpt-4o-mini', name: 'gpt-4o-mini', streaming: true, jsonSchema: true },
    { id: 'gpt-4.1', name: 'gpt-4.1', streaming: true, jsonSchema: true }
  ]},
  { id: 'gemini', name: 'Google Gemini', models: [
    { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash', streaming: true, jsonSchema: false },
    { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro', streaming: true, jsonSchema: false }
  ]}
];
let aiCurrentProvider = 'ecnu';