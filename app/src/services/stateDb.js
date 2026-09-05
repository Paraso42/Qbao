// ============================================================
// stateDb.js — 大块状态数据 IndexedDB 存储（v3.30 性能整改）
// localStorage 只存轻量骨架（章节元数据/策略/配置），
// 题目/答案/大考卷/历史这些几 MB 的大字段放这里，
// 彻底解决 2000+ 题题库超出 localStorage 5MB 上限 + 全量序列化卡顿。
// 内存 state 结构不变（题目常驻），仅持久化层分流。
// ============================================================

const DB_NAME = 'qbao_state_db'
const DB_VERSION = 1
const CH_STORE = 'chapters'   // key=chapterId, value={questions,userAnswers,quizSets}
const GL_STORE = 'global'     // key=global, value={generatedExams,history}

// v3.36.1 账户隔离加固：IndexedDB 大字段按账号分区（行键加 uid 前缀）。
// 旧版共享区的行（无前缀）仅当当前账号骨架引用其 cid 时才被采纳（cid 为随机
// 全局唯一 id，跨账号引用概率为 0），未引用的旧行天然隔离不再浮出水面。
let _dbUid = null
export function setStateDbUid(uid) { _dbUid = (uid === null || uid === undefined || uid === '') ? null : String(uid) }
export function getStateDbUid() { return _dbUid }
function keyFor(k) { return _dbUid ? _dbUid + ':' + String(k) : String(k) }
function unKey(k) {
  if (!_dbUid || typeof k !== 'string') return k
  const p = _dbUid + ':'
  return k.indexOf(p) === 0 ? k.slice(p.length) : k
}

let _dbPromise = null

function openDb() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(CH_STORE)) db.createObjectStore(CH_STORE, { keyPath: 'cid' })
      if (!db.objectStoreNames.contains(GL_STORE)) db.createObjectStore(GL_STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { _dbPromise = null; reject(req.error) }
  })
  _dbPromise.catch(() => { _dbPromise = null })
  return _dbPromise
}

async function tx(storeName, mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode)
    const store = t.objectStore(storeName)
    let result
    const req = fn(store)
    if (req && typeof req.onsuccess === 'undefined' && req && typeof req.then === 'function') {
      req.then((r) => { result = r }).catch(reject)
    }
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('idb abort'))
  })
}

// 章节级：{cid, questions, userAnswers, quizSets}（行键按账号分区，旧版无前缀行兼容读取）
export async function saveChapter(cid, data) {
  try { await tx(CH_STORE, 'readwrite', (s) => s.put({ cid: keyFor(cid), data })) } catch (e) { console.warn('[stateDb] saveChapter err', e) }
}

export async function saveChapters(list) {
  try {
    await tx(CH_STORE, 'readwrite', (s) => { list.forEach(({ cid, data }) => s.put({ cid: keyFor(cid), data })) })
  } catch (e) { console.warn('[stateDb] saveChapters err', e) }
}

export async function loadChapter(cid) {
  try {
    let out = null
    await tx(CH_STORE, 'readonly', (s) => { const r = s.get(keyFor(cid)); r.onsuccess = () => { out = r.result ? r.result.data : null } })
    return out
  } catch (e) { return null }
}

export async function loadAllChapters() {
  try {
    const map = {}
    await tx(CH_STORE, 'readonly', (s) => {
      const r = s.getAll()
      // 仅采纳：本账号分区行 + 旧版无前缀行（无前缀行由 hydrate 的骨架引用守卫决定是否使用）
      r.onsuccess = () => { (r.result || []).forEach((row) => { map[unKey(row.cid)] = row.data }) }
    })
    return map
  } catch (e) { return {} }
}

export async function saveGlobal(data) {
  try { await tx(GL_STORE, 'readwrite', (s) => s.put({ key: keyFor('global'), data })) } catch (e) { console.warn('[stateDb] saveGlobal err', e) }
}

export async function loadGlobal() {
  try {
    let out = null
    // v3.36.1 账户隔离：登录态（uid 已设）只读本账号分区行 —— 旧版无前缀 global 行
    // 属跨账号混杂数据（历史/大考卷无归属校验），绝不采纳；其数据在云端，登录后
    // 由云端拉取恢复。离线态（uid=null）无前缀行就是主键，正常读取。
    await tx(GL_STORE, 'readonly', (s) => {
      const r = s.get(keyFor('global'))
      r.onsuccess = () => { out = r.result ? r.result.data : null }
    })
    return out
  } catch (e) { return null }
}

// —— 通用键值（v3.36 存储配额治理）——
// 活动会话/考卷镜像等「刷新必达」通道的大数据放这里（global store 内独立 key），
// 不再占用 localStorage：2000+ 题一轮会话可达数 MB，塞入 localStorage 会撑爆
// iOS ~5MB 总量，导致骨架键写不进、每次答题弹「本地保存失败：存储空间已满」。
export async function saveMisc(key, data) {
  if (typeof indexedDB === 'undefined') return // node 测试环境：静默 no-op（与旧通道一致）
  try { await tx(GL_STORE, 'readwrite', (s) => s.put({ key: keyFor(key), data })) } catch (e) { console.warn('[stateDb] saveMisc err', e) }
}

export async function loadMisc(key) {
  if (typeof indexedDB === 'undefined') return null
  try {
    let out = null
    // 与 loadGlobal 同策略：登录态（uid 已设）只读本账号分区行，绝不回退旧全局行
    await tx(GL_STORE, 'readonly', (s) => {
      const r = s.get(keyFor(key))
      r.onsuccess = () => { out = r.result ? r.result.data : null }
    })
    return out
  } catch (e) { return null }
}

export async function clearAll() {
  try {
    await tx(CH_STORE, 'readwrite', (s) => s.clear())
    await tx(GL_STORE, 'readwrite', (s) => s.clear())
  } catch (e) {}
}
