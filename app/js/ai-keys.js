// ============================================================
// ai-keys.js — AI API Key 本机存储（v3.27）
// 职责：Provider API Key 只保存在当前设备的 localStorage，
//       绝不进入 state.aiConfig，也不会随 user_data 同步到服务端。
// 说明：Electron 后续可升级为 safeStorage；浏览器端保持 localStorage。
// ============================================================

var AI_KEYS_STORAGE_KEY = 'qbao_ai_keys_v1';

function currentAiKeyStorageKey() {
  try {
    if (typeof getUser === 'function') {
      var user = getUser();
      if (user && user.id) return AI_KEYS_STORAGE_KEY + '_u_' + user.id;
    }
  } catch (e) {}
  return AI_KEYS_STORAGE_KEY;
}

function loadAiKeyStore() {
  try {
    var raw = localStorage.getItem(currentAiKeyStorageKey());
    var parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('[ai-keys] load failed:', e);
    return {};
  }
}

function saveAiKeyStore(store) {
  try {
    localStorage.setItem(currentAiKeyStorageKey(), JSON.stringify(store || {}));
  } catch (e) {
    console.error('[ai-keys] save failed:', e);
  }
}

function getAiApiKey(provider) {
  var p = String(provider || '').trim();
  if (!p) return '';
  var store = loadAiKeyStore();
  return typeof store[p] === 'string' ? store[p] : '';
}

function setAiApiKey(provider, key) {
  var p = String(provider || '').trim();
  if (!p) return false;
  var store = loadAiKeyStore();
  var value = String(key || '').trim();
  if (value) {
    store[p] = value;
  } else {
    delete store[p];
  }
  saveAiKeyStore(store);
  return true;
}

function removeAiApiKey(provider) {
  return setAiApiKey(provider, '');
}

function hasAiApiKey(provider) {
  return getAiApiKey(provider).length > 0;
}

function hasAnyAiApiKey() {
  var store = loadAiKeyStore();
  return Object.keys(store).some(function (p) {
    return typeof store[p] === 'string' && store[p].length > 0;
  });
}

// 把旧版 state.aiConfig 中的密钥迁移到本机 KeyStore，并删除 state 中的密钥。
// 本地已有 Key 时保持本地优先，不会用旧 state 覆盖。
// 返回迁移的 provider 数量。
function migrateLegacyAiKeysFromState(s) {
  if (!s || !s.aiConfig || typeof s.aiConfig !== 'object') return 0;

  var ac = s.aiConfig;
  var legacy = {};

  if (ac.providerKeys && typeof ac.providerKeys === 'object') {
    Object.keys(ac.providerKeys).forEach(function (p) {
      var key = ac.providerKeys[p];
      if (typeof key === 'string' && key.trim()) legacy[p] = key.trim();
    });
  }

  // 最旧版本：单 key 直接挂在 apiKey 上，按当前 provider 归属。
  if (typeof ac.apiKey === 'string' && ac.apiKey.trim()) {
    var fallbackProvider = (typeof ac.provider === 'string' && ac.provider) ? ac.provider : 'ecnu';
    if (!legacy[fallbackProvider]) legacy[fallbackProvider] = ac.apiKey.trim();
  }

  var store = loadAiKeyStore();
  var migrated = 0;
  Object.keys(legacy).forEach(function (p) {
    if (!store[p]) {
      store[p] = legacy[p];
      migrated++;
    }
  });
  if (migrated > 0) saveAiKeyStore(store);

  // 无论是否迁移成功，都不能让密钥继续留在可同步的 state 中。
  delete ac.apiKey;
  delete ac.providerKeys;
  return migrated;
}

// 最后防线：任何地方准备持久化/同步 state 前，强制剥离密钥字段。
function stripAiSecretsFromState(s) {
  if (!s || !s.aiConfig || typeof s.aiConfig !== 'object') return s;
  delete s.aiConfig.apiKey;
  delete s.aiConfig.providerKeys;
  return s;
}
