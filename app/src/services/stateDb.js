// ============================================================
// stateDb.js — 大块状态数据 IndexedDB 存储（v3.30 性能整改）
// localStorage 只存轻量骨架（章节元数据/策略/配置），
// 题目/答案/大考卷/SRS/历史这些几 MB 的大字段放这里，
// 彻底解决 2000+ 题题库超出 localStorage 5MB 上限 + 全量序列化卡顿。
// 内存 state 结构不变（题目常驻），仅持久化层分流。
// ============================================================

const DB_NAME = 'qbao_state_db'
const DB_VERSION = 1
const CH_STORE = 'chapters'   // key=chapterId, value={questions,userAnswers,quizSets}
const GL_STORE = 'global'     // key=global, value={srsData,generatedExams,history}

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

// 章节级：{cid, questions, userAnswers, quizSets}
export async function saveChapter(cid, data) {
  try { await tx(CH_STORE, 'readwrite', (s) => s.put({ cid, data })) } catch (e) { console.warn('[stateDb] saveChapter err', e) }
}

export async function saveChapters(list) {
  try {
    await tx(CH_STORE, 'readwrite', (s) => { list.forEach(({ cid, data }) => s.put({ cid, data })) })
  } catch (e) { console.warn('[stateDb] saveChapters err', e) }
}

export async function loadChapter(cid) {
  try {
    let out = null
    await tx(CH_STORE, 'readonly', (s) => { const r = s.get(cid); r.onsuccess = () => { out = r.result ? r.result.data : null } })
    return out
  } catch (e) { return null }
}

export async function loadAllChapters() {
  try {
    const map = {}
    await tx(CH_STORE, 'readonly', (s) => {
      const r = s.getAll()
      r.onsuccess = () => { (r.result || []).forEach((row) => { map[row.cid] = row.data }) }
    })
    return map
  } catch (e) { return {} }
}

export async function saveGlobal(data) {
  try { await tx(GL_STORE, 'readwrite', (s) => s.put({ key: 'global', data })) } catch (e) { console.warn('[stateDb] saveGlobal err', e) }
}

export async function loadGlobal() {
  try {
    let out = null
    await tx(GL_STORE, 'readonly', (s) => { const r = s.get('global'); r.onsuccess = () => { out = r.result ? r.result.data : null } })
    return out
  } catch (e) { return null }
}

export async function clearAll() {
  try {
    await tx(CH_STORE, 'readwrite', (s) => s.clear())
    await tx(GL_STORE, 'readwrite', (s) => s.clear())
  } catch (e) {}
}
