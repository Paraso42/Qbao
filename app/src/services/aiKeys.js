// ============================================================
// aiKeys.js — AI API Key 本机存储（v3.27 语义 + v3.31 P1.3 加固）
// 职责：Provider API Key 只保存在当前设备，绝不进入 state.aiConfig，
//       也不会随 user_data 同步到服务端。
// v3.31 存储分层：
//   桌面端 → 主进程 safeStorage（DPAPI 加密）落盘，renderer 无明文持久化；
//   网页端 → localStorage 最小混淆（非加密，防明文浏览），设置页明示局限。
//   旧明文/旧键自动兼容读取并迁移。
// ============================================================
import { IS_DESKTOP } from '../core/env'
import { obfuscate, deobfuscate, secretSave, secretLoad, secretRemove, secretNameFor } from './secureStore'

export const AI_KEYS_STORAGE_KEY = 'qbao_ai_keys_v1'

// 桌面端内存镜像（同步 API 需要）：uid 变化自动失效重载
let _desktopMem = null // { uid, store }

function currentUid() {
  try {
    const raw = localStorage.getItem('qbao_user')
    if (raw) {
      const u = JSON.parse(raw)
      if (u && u.id) return String(u.id)
    }
  } catch (e) {}
  return ''
}

export function currentAiKeyStorageKey() {
  const uid = currentUid()
  return uid ? AI_KEYS_STORAGE_KEY + '_u_' + uid : AI_KEYS_STORAGE_KEY
}

// —— 网页端（localStorage 混淆存取） ——
export function loadAiKeyStore() {
  try {
    const raw = localStorage.getItem(currentAiKeyStorageKey())
    if (!raw) return {}
    // 逐 key 解混淆（旧明文键无前缀则原样返回）；整体损坏返回空
    let store = {}
    try { store = JSON.parse(raw) } catch (e) { return {} }
    const out = {}
    Object.keys(store || {}).forEach(function (p) {
      const v = store[p]
      if (typeof v === 'string' && v.length) {
        const plain = deobfuscate(v)
        if (plain !== null && plain !== undefined) out[p] = plain
      } else {
        out[p] = v
      }
    })
    return out
  } catch (e) {
    console.error('[ai-keys] load failed:', e)
    return {}
  }
}

export function saveAiKeyStore(store) {
  try {
    // 混淆落盘：每 key 混淆，整体也保持 JSON 结构
    const enc = {}
    Object.keys(store || {}).forEach(function (p) {
      const v = store[p]
      enc[p] = (typeof v === 'string' && v.length > 0) ? obfuscate(v) : v
    })
    localStorage.setItem(currentAiKeyStorageKey(), JSON.stringify(enc))
  } catch (e) {
    console.error('[ai-keys] save failed:', e)
  }
}

// —— 桌面端：安全存储（safeStorage） ——
async function persistDesktop(store, uid) {
  const r = await secretSave(secretNameFor('aikeys', uid), JSON.stringify(store))
  if (r && r.ok) {
    // 成功落安全存储后移除明文旧键（renderer 无明文持久化）
    try {
      const legacyKey = uid ? AI_KEYS_STORAGE_KEY + '_u_' + uid : AI_KEYS_STORAGE_KEY
      localStorage.removeItem(legacyKey)
    } catch (e) {}
    return true
  }
  // safeStorage 不可用等：降级走网页路径（混淆 localStorage），保证功能可用
  if (IS_DESKTOP) {
    console.warn('[ai-keys] safeStorage 不可用，降级 localStorage（仅混淆）', r && r.error)
  }
  const legacy = {}
  Object.keys(store || {}).forEach(function (p) {
    legacy[p] = (typeof store[p] === 'string' && store[p].length > 0) ? obfuscate(store[p]) : store[p]
  })
  try { localStorage.setItem(uid ? AI_KEYS_STORAGE_KEY + '_u_' + uid : AI_KEYS_STORAGE_KEY, JSON.stringify(legacy)) } catch (e) {}
  return false
}

// boot 预热：把当前账号的密钥从 safeStorage 载入内存（登录切换后同样调用）
export async function initSecureKeyStore() {
  if (!IS_DESKTOP) return false
  const uid = currentUid()
  try {
    const r = await secretLoad(secretNameFor('aikeys', uid))
    if (r && r.ok && r.value) {
      const parsed = JSON.parse(r.value || '{}')
      _desktopMem = { uid, store: parsed && typeof parsed === 'object' ? parsed : {} }
      // 旧明文（升级遗留）立即迁移删除
      try {
        const legacyKey = uid ? AI_KEYS_STORAGE_KEY + '_u_' + uid : AI_KEYS_STORAGE_KEY
        localStorage.removeItem(legacyKey)
      } catch (e) {}
      return true
    }
  } catch (e) {}
  // 无安全存储记录：迁移旧 localStorage 明文/混淆
  const legacyRaw = (() => { try { return localStorage.getItem(uid ? AI_KEYS_STORAGE_KEY + '_u_' + uid : AI_KEYS_STORAGE_KEY) } catch (e) { return null } })()
  if (legacyRaw) {
    try {
      const legacy = loadAiKeyStore() // 已做混淆/明文兼容
      if (Object.keys(legacy).length > 0) {
        _desktopMem = { uid, store: legacy }
        await persistDesktop(legacy, uid)
        return true
      }
    } catch (e) {}
  }
  _desktopMem = { uid, store: {} }
  return false
}

// 桌面同步读：内存就绪直接返回；未就绪（极端时序）回退 legacy localStorage 读取
function desktopStore() {
  if (!IS_DESKTOP) return null
  const uid = currentUid()
  if (_desktopMem && _desktopMem.uid === uid) return _desktopMem.store
  // uid 变化或未预热：fallback 旧键（迁移前的数据仍在时）
  try {
    const legacy = loadAiKeyStore()
    if (Object.keys(legacy).length > 0) return legacy
  } catch (e) {}
  return {}
}

// —— 公共 API（get/set/remove/has） ——
export function getAiApiKey(provider) {
  const p = String(provider || '').trim()
  if (!p) return ''
  const desk = desktopStore()
  if (desk !== null) {
    return typeof desk[p] === 'string' ? desk[p] : ''
  }
  const store = loadAiKeyStore()
  return typeof store[p] === 'string' ? store[p] : ''
}

export function setAiApiKey(provider, key) {
  const p = String(provider || '').trim()
  if (!p) return false
  const value = String(key || '').trim()
  const uid = currentUid()
  if (IS_DESKTOP) {
    if (!_desktopMem || _desktopMem.uid !== uid) _desktopMem = { uid, store: desktopStore() || {} }
    const store = _desktopMem.store
    if (value) store[p] = value
    else delete store[p]
    persistDesktop(store, uid) // fire-and-forget（失败已降级写 localStorage）
    return true
  }
  const store = loadAiKeyStore()
  if (value) store[p] = value
  else delete store[p]
  saveAiKeyStore(store)
  return true
}

export function removeAiApiKey(provider) { return setAiApiKey(provider, '') }
export function hasAiApiKey(provider) { return getAiApiKey(provider).length > 0 }

export function hasAnyAiApiKey() {
  const desk = desktopStore()
  if (desk !== null) {
    return Object.keys(desk).some(function (p) {
      return typeof desk[p] === 'string' && desk[p].length > 0
    })
  }
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

  const store = IS_DESKTOP ? (desktopStoreInMem(ac)) : loadAiKeyStore()
  let migrated = 0
  Object.keys(legacy).forEach(function (p) {
    if (!store[p]) { store[p] = legacy[p]; migrated++ }
  })
  if (migrated > 0) {
    if (IS_DESKTOP) persistDesktop(store, currentUid())
    else saveAiKeyStore(store)
  }

  delete ac.apiKey
  delete ac.providerKeys
  return migrated
}

function desktopStoreInMem() {
  const uid = currentUid()
  if (!_desktopMem || _desktopMem.uid !== uid) _desktopMem = { uid, store: {} }
  return _desktopMem.store
}

// 最后防线：任何地方准备持久化/同步 state 前，强制剥离密钥字段。
export function stripAiSecretsFromState(s) {
  if (!s || !s.aiConfig || typeof s.aiConfig !== 'object') return s
  delete s.aiConfig.apiKey
  delete s.aiConfig.providerKeys
  return s
}
