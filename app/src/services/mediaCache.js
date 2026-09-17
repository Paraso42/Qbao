// ============================================================
// mediaCache.js — 聊天图片的本地持久缓存（v3.37.6）
//
// 背景（真实事故）：「每次加载对话内图片都要很久」。
// 原因是三层叠加：
//   1) 服务端媒体地址带短时效签名票（?t=exp.sig），旧实现每次下发消息列表都重新
//      签发，URL 每次都变 —— 而 URL 就是浏览器的缓存键，于是缓存命中率恒为 0；
//   2) 浏览器对一个源只开一条 HTTP/2 连接，一屏图片共享同一条流的带宽；
//   3) 列表里放的是整图。
// 第 1、3 条已在服务端/上传侧修掉（票据按时间桶对齐、列表改用 ?w=480 小图）。
// 这一层做的是官方聊天软件都会做的事：**把图片按「文件」缓存到本地**，
// 同一张图第二次出现在屏幕上就不再走网络（换 session、换票据、离线都一样）。
//
// 设计要点：
//   - 键是稳定的：文件名 + 宽度变体，票/续期参数一律不参与（见 mediaKey）；
//   - 存 Blob 到 IndexedDB（与 services/stateDb.js 一样，node 测试环境静默 no-op）；
//   - 渲染走 URL.createObjectURL，命中时同步可用，不产生任何请求；
//   - 任何一步失败都退化成「照常走网络」，绝不因为缓存把图弄丢。
// ============================================================

const DB_NAME = 'qbao-media'
const DB_VERSION = 1
const STORE = 'blobs'
const MAX_ENTRIES = 400
const MAX_BLOB_BYTES = 8 * 1024 * 1024

const mem = new Map() // key -> objectURL（本次会话已解析过的）
let dbPromise = null

function idbAvailable() {
  return typeof indexedDB !== 'undefined'
}

function canObjectUrl() {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
}

function openDb() {
  if (!idbAvailable()) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function tx(db, mode, fn) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode)
      const store = t.objectStore(STORE)
      const out = fn(store)
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out)
      t.onerror = () => resolve(null)
      t.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

// 稳定缓存键：只取文件名，宽度变体（?w=480 缩略图）另算一个键。
// ticket、nonce 之类的易变参数一律不参与，否则缓存永远不会命中。
export function mediaKey(url) {
  if (typeof url !== 'string' || !url) return ''
  if (url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return ''
  const q = url.indexOf('?')
  const path = q === -1 ? url : url.slice(0, q)
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!name) return ''
  const m = /[?&]w=(\d+)/.exec(url)
  return m ? name + '#w' + m[1] : name
}

// 列表用宽度变体：给媒体地址加 ?w=480（缩略图）。
// 三个必须守住的边界：幂等（已有 w= 就不再追加）、跳过 blob:/data:、
// 参数分隔符按原地址是否已有查询串决定 —— 拼错任何一个都会让图片直接 404。
export function withMediaWidth(url, width) {
  if (typeof url !== 'string' || !url) return url
  if (url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return url
  const w = Number(width)
  if (!Number.isFinite(w) || w <= 0) return url
  if (/[?&]w=\d+/.test(url)) return url
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 'w=' + w
}

// 渲染取址：本地已有这张图就用 blob: 地址（同步、零请求），否则回退网络地址。
// 注意命中时必须**整串替换**，不能再往 blob: 地址上拼查询参数（会变成坏地址）。
export function cachedOrOriginal(url, map) {
  if (typeof url !== 'string' || !url) return url
  const key = mediaKey(url)
  if (!key || !map) return url
  const hit = map[key]
  return typeof hit === 'string' && hit ? hit : url
}

// 已解析好的本地地址（同步命中，渲染时可直接用）
export function cachedUrl(url) {
  const key = mediaKey(url)
  if (!key) return ''
  return mem.get(key) || ''
}

function remember(key, blob) {
  if (!canObjectUrl()) return ''
  try {
    const old = mem.get(key)
    if (old) { try { URL.revokeObjectURL(old) } catch { /* ignore */ } }
    const objUrl = URL.createObjectURL(blob)
    mem.set(key, objUrl)
    return objUrl
  } catch {
    return ''
  }
}

function forget(key) {
  const old = mem.get(key)
  if (old) { try { URL.revokeObjectURL(old) } catch { /* ignore */ } }
  mem.delete(key)
}

// 批量把「已经在本地」的图解析成 objectURL，返回 { key: objectUrl }。
// 只读本地，不发请求；未命中的键不出现在返回值里，调用方照常走网络。
export async function ensureLoaded(urls) {
  const out = {}
  const list = Array.isArray(urls) ? urls : []
  const need = []
  for (const u of list) {
    const key = mediaKey(u)
    if (!key) continue
    const hit = mem.get(key)
    if (hit) { out[key] = hit; continue }
    if (need.indexOf(key) === -1) need.push(key)
  }
  if (!need.length) return out
  const db = await openDb()
  if (!db) return out
  for (const key of need) {
    const rec = await tx(db, 'readonly', (store) => store.get(key))
    if (!rec || !rec.blob) continue
    const objUrl = remember(key, rec.blob)
    if (objUrl) out[key] = objUrl
  }
  return out
}

// 把一次网络响应存进本地（同一次会话内浏览器 HTTP 缓存已命中，几乎不额外耗流量）
export async function putMedia(url, blob) {
  const key = mediaKey(url)
  if (!key || !blob || !blob.size || blob.size > MAX_BLOB_BYTES) return ''
  const objUrl = remember(key, blob)
  const db = await openDb()
  if (db) {
    await tx(db, 'readwrite', (store) => store.put({ key, blob, at: Date.now() }))
    prune(db)
  }
  return objUrl
}

async function prune(db) {
  try {
    const keys = await tx(db, 'readonly', (store) => store.getAllKeys())
    if (!Array.isArray(keys) || keys.length <= MAX_ENTRIES) return
    const all = await tx(db, 'readonly', (store) => store.getAll())
    if (!Array.isArray(all)) return
    all.sort((a, b) => (a.at || 0) - (b.at || 0))
    const drop = all.slice(0, all.length - MAX_ENTRIES)
    await tx(db, 'readwrite', (store) => { for (const r of drop) store.delete(r.key) })
  } catch { /* 清理失败不影响使用 */ }
}

// 网络取回一份并落盘。失败静默（渲染侧仍有 <img> 的原地址兜底）。
export async function warmMedia(url) {
  const key = mediaKey(url)
  if (!key || mem.has(key)) return ''
  if (typeof fetch !== 'function') return ''
  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res || !res.ok) return ''
    const blob = await res.blob()
    if (!blob || !blob.size) return ''
    return await putMedia(url, blob)
  } catch {
    return ''
  }
}

// 上传成功后调用：发送者自己的图直接从本地文件渲染，不必再从服务器下一遍。
export async function seedMedia(url, blob) {
  if (!blob) return ''
  return putMedia(url, blob)
}

// 退出登录/切换账号时清掉，避免把上一个账号的图留在本机
export async function clearMediaCache() {
  for (const key of Array.from(mem.keys())) forget(key)
  const db = await openDb()
  if (db) await tx(db, 'readwrite', (store) => store.clear())
}

// 仅供测试：重置模块级状态
export function _resetForTest() {
  for (const key of Array.from(mem.keys())) forget(key)
  dbPromise = null
}
