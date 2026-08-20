// 章节复习资料二进制存储（IndexedDB，语义同 legacy db.js）
const MATERIALS_DB_NAME = 'qbao_materials_db'
const MATERIALS_DB_VERSION = 1
const MATERIALS_STORE = 'materials'

// T12: 复用同一个 IndexedDB 连接（原实现每次操作都重开连接，开销大且版本升级期易竞态）
let _dbPromise = null

function _openMaterialsDb() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise(function (resolve, reject) {
    var req = indexedDB.open(MATERIALS_DB_NAME, MATERIALS_DB_VERSION)
    req.onupgradeneeded = function () {
      var db = req.result
      if (!db.objectStoreNames.contains(MATERIALS_STORE)) db.createObjectStore(MATERIALS_STORE, { keyPath: 'id' })
    }
    req.onsuccess = function () { resolve(req.result) }
    req.onerror = function () { _dbPromise = null; reject(req.error) }
    req.onblocked = function () { reject(new Error('IndexedDB 升级被其他页面阻塞')) }
  })
  _dbPromise.catch(function () { _dbPromise = null }) // 打开失败后可重试
  return _dbPromise
}

export async function idbStoreMaterial(materialId, dataUrl) {
  try {
    var db = await _openMaterialsDb()
    var tx = db.transaction(MATERIALS_STORE, 'readwrite')
    var store = tx.objectStore(MATERIALS_STORE)
    store.put({ id: materialId, data: dataUrl })
    return new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onerror = function () { reject(tx.error) } })
  } catch (e) { console.warn('IndexedDB store err', e) }
}

export async function idbGetMaterial(materialId) {
  try {
    var db = await _openMaterialsDb()
    var tx = db.transaction(MATERIALS_STORE, 'readonly')
    var store = tx.objectStore(MATERIALS_STORE)
    var req = store.get(materialId)
    return new Promise(function (resolve) {
      req.onsuccess = function () { resolve(req.result ? req.result.data : null) }
      req.onerror = function () { resolve(null) }
    })
  } catch (e) { console.warn('IndexedDB get err', e); return null }
}

export async function idbDeleteMaterial(materialId) {
  try {
    var db = await _openMaterialsDb()
    var tx = db.transaction(MATERIALS_STORE, 'readwrite')
    tx.objectStore(MATERIALS_STORE).delete(materialId)
  } catch (e) { console.warn('IndexedDB delete err', e) }
}

export async function idbDeleteChapterMaterials(materials) {
  for (var i = 0; i < materials.length; i++) await idbDeleteMaterial(materials[i].id)
}