// ============================================================
// aiMaterials.js — 章节复习资料管理（v3.32 P2.1 自 stores/ai.js 拆分）
// chapterMaterials 元数据存 state（随同步走），二进制体存 IndexedDB。
// 工厂接收 { data, ui } store 实例；返回全部资料操作函数。
// ============================================================
import { generateMaterialId } from './utils'
import { idbStoreMaterial, idbDeleteMaterial } from './materialsDb'
import { fetchWithAuth, readApiErrorSafe } from './api'

function getExtIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase()
  if (ext === 'pdf') return 'file'
  if (ext === 'doc' || ext === 'docx') return 'edit'
  if (ext === 'ppt' || ext === 'pptx') return 'chart'
  if (ext === 'txt' || ext === 'md') return 'file'
  return 'paperclip'
}

export function createMaterialManager({ data, ui }) {
  function getChapterMaterials(cid) {
    if (!data.state.chapterMaterials) data.state.chapterMaterials = {}
    return data.state.chapterMaterials[cid] || []
  }

  function saveChapterMaterials(cid, materials) {
    if (!data.state.chapterMaterials) data.state.chapterMaterials = {}
    data.state.chapterMaterials[cid] = materials
    data.saveState()
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function addMaterialFiles(chapterId, fileList) {
    const ch = data.state.chapters[chapterId]
    if (!ch) { ui.toast('请先选择章节', 'err'); return }
    const materials = getChapterMaterials(chapterId)
    const allowedExts = ['pdf', 'doc', 'docx', 'pptx', 'txt', 'md']
    let added = 0
    for (const f of fileList) {
      const ext = f.name.split('.').pop().toLowerCase()
      if (allowedExts.indexOf(ext) === -1) { ui.toast(f.name + ' 类型不支持，已跳过', 'info'); continue }
      if (f.size > 20 * 1024 * 1024) { ui.toast(f.name + ' 超过20MB，已跳过', 'info'); continue }
      if (materials.find((m) => m.name === f.name && m.size === f.size)) { ui.toast(f.name + ' 已存在，已跳过', 'info'); continue }
      const dataUrl = await readFileAsDataUrl(f)
      const mid = generateMaterialId()
      materials.push({ name: f.name, size: f.size, addedAt: Date.now(), id: mid })
      saveChapterMaterials(chapterId, materials)
      try { await idbStoreMaterial(mid, dataUrl) } catch (e) {
        ui.toast('保存资料失败：' + f.name, 'err')
        const idx = materials.length - 1
        materials.splice(idx, 1)
        saveChapterMaterials(chapterId, materials)
        continue
      }
      added++
      // 同步上传到服务端文件池（失败不阻塞）
      try {
        const upFd = new FormData()
        const dec = atob(dataUrl.split(',')[1])
        const bin = new Uint8Array(dec.length)
        for (let k = 0; k < dec.length; k++) bin[k] = dec.charCodeAt(k)
        upFd.append('file', new Blob([bin]), f.name)
        upFd.append('chapterId', chapterId)
        fetchWithAuth('/files/upload', { method: 'POST', body: upFd }).then((r) => {
          if (r && r.status === 409) {
            r.json().then((d) => ui.toast(d.error || '文件重复', 'info')).catch(() => {})
          }
        }).catch(() => {})
      } catch (e) { /* ignore */ }
    }
    if (added > 0 && ch) ch._hasNewFilesSinceLastGen = true
    data.saveState()
  }

  function removeMaterial(chapterId, idx) {
    const materials = getChapterMaterials(chapterId)
    const removed = materials.splice(idx, 1)
    if (removed.length) idbDeleteMaterial(removed[0].id)
    saveChapterMaterials(chapterId, materials)
  }

  // 过期/删除的文件池文件不再显示在复习资料里：移除 chapterMaterials 中
  // 已不在文件池（名称+大小不匹配）的 _poolFile 条目。
  function reconcilePoolMaterials(chapterId, poolFiles) {
    const materials = getChapterMaterials(chapterId)
    const valid = new Set((poolFiles || []).map((f) => (f.originalName || '') + '|' + (f.fileSize || 0)))
    const kept = materials.filter((m) => !m._poolFile || valid.has((m.name || '') + '|' + (m.size || 0)))
    if (kept.length !== materials.length) {
      saveChapterMaterials(chapterId, kept)
      return true
    }
    return false
  }

  async function assignPoolFileToChapter(chapterId, fileId) {
    const res = await fetchWithAuth('/files/' + fileId + '/assign', {
      method: 'POST',
      body: JSON.stringify({ chapterId })
    })
    if (!res || !res.ok) {
      const err = await readApiErrorSafe(res, '分配失败')
      throw new Error(err)
    }
    const data2 = await res.json()
    const f = data2.file
    const materials = getChapterMaterials(chapterId)
    // 同一章节重复关联同一池文件 → 幂等提示，不重复添加（多章节关联后更易误点）
    if (materials.some((m) => m._poolFile && m.name === f.originalName && m.size === f.fileSize)) {
      ui.toast('该文件已关联本章节', 'info')
      return
    }
    materials.push({ name: f.originalName, size: f.fileSize, addedAt: Date.now(), id: generateMaterialId(), _poolFile: true })
    saveChapterMaterials(chapterId, materials)
    const ch = data.state.chapters[chapterId]
    if (ch) ch._hasNewFilesSinceLastGen = true
    data.saveState()
  }

  return {
    getChapterMaterials, saveChapterMaterials, getExtIcon,
    addMaterialFiles, removeMaterial, reconcilePoolMaterials, assignPoolFileToChapter,
  }
}
