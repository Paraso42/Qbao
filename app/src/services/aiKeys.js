// ============================================================
// aiKeys.js — AI API Key 本机存储（v3.27 语义不变）
// 职责：Provider API Key 只保存在当前设备的 localStorage，
//       绝不进入 state.aiConfig，也不会随 user_data 同步到服务端。
// ============================================================

export const AI_KEYS_STORAGE_KEY = 'qbao_ai_keys_v1'

function currentAiKeyStorageKey() {
  try {
    const raw = localStorage.getItem('qbao_user')
    if (raw) {
      const user = JSON.parse(raw)
      if (user && user.id) return AI_KEYS_STORAGE_KEY + '_u_' + user.id
    }
  } catch (e) {}
  return AI_KEYS_STORAGE_KEY
}

export function loadAiKeyStore() {
  try {
    const raw = localStorage.getItem(currentAiKeyStorageKey())
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    console.error('[ai-keys] load failed:', e)
    return {}
  }
}

export function saveAiKeyStore(store) {
  try {
    localStorage.setItem(currentAiKeyStorageKey(), JSON.stringify(store || {}))
  } catch (e) {
    console.error('[ai-keys] save failed:', e)
  }
}

export function getAiApiKey(provider) {
  const p = String(provider || '').trim()
  if (!p) return ''
  const store = loadAiKeyStore()
  return typeof store[p] === 'string' ? store[p] : ''
}

export function setAiApiKey(provider, key) {
  const p = String(provider || '').trim()
  if (!p) return false
  const store = loadAiKeyStore()
  const value = String(key || '').trim()
  if (value) store[p] = value
  else delete store[p]
  saveAiKeyStore(store)
  return true
}

export function removeAiApiKey(provider) { return setAiApiKey(provider, '') }
export function hasAiApiKey(provider) { return getAiApiKey(provider).length > 0 }

export function hasAnyAiApiKey() {
  const store = loadAiKeyStore()
  return Object.keys(store).some(function (p) {
    return typeof store[p] === 'string' && store[p].length > 0
  })
}

// 把旧版 state.aiConfig 中的密钥迁移到本机 KeyStore，并删除 state 中的密钥。
export function migrateLegacyAiKeysFromState(s) {
  if (!s || !s.aiConfig || typeof s.aiConfig !== 'object') return 0
  const ac = s.aiConfig
  const legacy = {}

  if (ac.providerKeys && typeof ac.providerKeys === 'object') {
    Object.keys(ac.providerKeys).forEach(function (p) {
      const key = ac.providerKeys[p]
      if (typeof key === 'string' && key.trim()) legacy[p] = key.trim()
    })
  }
  if (typeof ac.apiKey === 'string' && ac.apiKey.trim()) {
    const fallbackProvider = (typeof ac.provider === 'string' && ac.provider) ? ac.provider : 'ecnu'
    if (!legacy[fallbackProvider]) legacy[fallbackProvider] = ac.apiKey.trim()
  }

  const store = loadAiKeyStore()
  let migrated = 0
  Object.keys(legacy).forEach(function (p) {
    if (!store[p]) { store[p] = legacy[p]; migrated++ }
  })
  if (migrated > 0) saveAiKeyStore(store)

  delete ac.apiKey
  delete ac.providerKeys
  return migrated
}

// 最后防线：任何地方准备持久化/同步 state 前，强制剥离密钥字段。
export function stripAiSecretsFromState(s) {
  if (!s || !s.aiConfig || typeof s.aiConfig !== 'object') return s
  delete s.aiConfig.apiKey
  delete s.aiConfig.providerKeys
  return s
}
