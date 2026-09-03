// ============================================================
// secureStore.js — 凭据本地存放加固（v3.31 P1.3）
// 桌面端：token / AI Key 落盘走主进程 safeStorage（DPAPI），renderer 无明文持久化；
// 网页端：最小混淆兜底（非加密，仅防明文浏览/简单检索），文档同步告知局限。
// 旧明文自动兼容：读取时无混淆前缀按原值返回，写入时自动升级为混淆/加密。
// ============================================================
import { desktopBridge, IS_DESKTOP } from '../core/env'

export const OBF_PREFIX = 'qb1:'
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// 固定异或盐（混淆用途，非加密密钥；安全边界见 Settings 提示文案）
const OBF_SALT = 'qbao-local-obf-2026'

// UTF-8 字节编解码（base64 按字节处理，中文/emoji 不依赖 btoa/atob）
function utf8Bytes(str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1)
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
        i++
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return out
}
function utf8String(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]
    if (b < 0x80) { out += String.fromCharCode(b); i++ }
    else if (b < 0xe0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2 }
    else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      out += String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff))
      i += 4
    }
  }
  return out
}

export function b64encode(str) {
  const bytes = utf8Bytes(String(str == null ? '' : str))
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const c1 = bytes[i]
    const c2 = i + 1 < bytes.length ? bytes[i + 1] : NaN
    const c3 = i + 2 < bytes.length ? bytes[i + 2] : NaN
    out += B64_CHARS[c1 >> 2]
    out += B64_CHARS[((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4)]
    out += isNaN(c2) ? '=' : B64_CHARS[((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6)]
    out += isNaN(c3) ? '=' : B64_CHARS[c3 & 63]
  }
  return out
}

export function b64decode(str) {
  const clean = String(str || '').replace(/=+$/, '')
  if (!clean) return ''
  const bytes = []
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = B64_CHARS.indexOf(clean[i])
    const c2 = B64_CHARS.indexOf(clean[i + 1])
    const c3 = clean[i + 2] ? B64_CHARS.indexOf(clean[i + 2]) : -1
    const c4 = clean[i + 3] ? B64_CHARS.indexOf(clean[i + 3]) : -1
    if (c1 < 0 || c2 < 0) return null
    bytes.push((c1 << 2) | (c2 >> 4))
    if (c3 >= 0) bytes.push(((c2 & 15) << 4) | (c3 >> 2))
    if (c4 >= 0) bytes.push(((c3 & 3) << 6) | c4)
  }
  return utf8String(bytes)
}

// 最小混淆：XOR + base64，带前缀标记；失败时原样返回（读侧兼容旧明文）
export function obfuscate(value) {
  const s = String(value == null ? '' : value)
  if (!s) return s
  let xored = ''
  for (let i = 0; i < s.length; i++) {
    xored += String.fromCharCode(s.charCodeAt(i) ^ OBF_SALT.charCodeAt(i % OBF_SALT.length))
  }
  return OBF_PREFIX + b64encode(xored)
}

// 解混淆：无前缀 → 旧明文原样返回；前缀但解码失败 → null（数据损坏）
export function deobfuscate(value) {
  if (value == null) return value
  const s = String(value)
  if (s.indexOf(OBF_PREFIX) !== 0) return s
  try {
    const decoded = b64decode(s.slice(OBF_PREFIX.length))
    if (decoded === null || decoded === '') return null // 空负载/损坏视为无效
    let out = ''
    for (let i = 0; i < decoded.length; i++) {
      out += String.fromCharCode(decoded.charCodeAt(i) ^ OBF_SALT.charCodeAt(i % OBF_SALT.length))
    }
    return out
  } catch (e) { return null }
}

// —— 桌面端安全通道（主进程 safeStorage） ——
// name 统一加 'qbao_secret_' 前缀防命名冲突；返回值统一 { ok } / { ok:false, error|code }
export function secretAvailable() {
  const b = desktopBridge()
  if (!b || typeof b.secretAvailable !== 'function') return Promise.resolve(false)
  return b.secretAvailable().then((v) => !!v).catch(() => false)
}
export function secretSave(name, value) {
  const b = desktopBridge()
  if (!b || typeof b.secretSave !== 'function') return Promise.resolve({ ok: false, error: '无桌面桥' })
  return b.secretSave(name, value).catch(() => ({ ok: false, error: 'IPC 失败' }))
}
export function secretLoad(name) {
  const b = desktopBridge()
  if (!b || typeof b.secretLoad !== 'function') return Promise.resolve({ ok: false, error: '无桌面桥' })
  return b.secretLoad(name).catch(() => ({ ok: false, error: 'IPC 失败' }))
}
export function secretRemove(name) {
  const b = desktopBridge()
  if (!b || typeof b.secretRemove !== 'function') return Promise.resolve({ ok: false, error: '无桌面桥' })
  return b.secretRemove(name).catch(() => ({ ok: false, error: 'IPC 失败' }))
}

// 桌面端存储名工具
export function secretNameFor(scope, uid) {
  const u = uid ? '_u_' + uid : ''
  return scope + u
}

export { IS_DESKTOP }
