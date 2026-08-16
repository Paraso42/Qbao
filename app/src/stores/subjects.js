// 科目/章节 CRUD 与排序（数据本体在 data store 的 state.subjects/chapters）
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useDataStore } from './data'
import { generateId } from '../services/utils'

export const useSubjectStore = defineStore('subjects', () => {
  const data = useDataStore()

  const list = computed(() => {
    const order = data.state.subjectOrder || []
    return order.map((id) => data.state.subjects[id]).filter(Boolean)
  })

  const current = computed(() => data.state.subjects[data.state.currentSubjectId] || null)

  // —— 科目 ——
  function create(name, autoName = true) {
    const s = data.state.subjects
    const finalName = (name && String(name).trim()) || (autoName ? '科目 ' + (Object.keys(s).length + 1) : '未命名科目')
    const id = generateId('subj')
    s[id] = { id, name: finalName, chapterIds: [], collapsed: false }
    if (!data.state.currentSubjectId) data.state.currentSubjectId = id
    if (!data.state.subjectOrder) data.state.subjectOrder = Object.keys(s)
    data.state.subjectOrder.push(id)
    data.saveState()
    return id
  }

  function rename(id, name) {
    const s = data.state.subjects[id]
    if (!s || !name || !String(name).trim()) return
    s.name = String(name).trim()
    data.saveState()
  }

  function remove(id) {
    const s = data.state.subjects[id]
    if (!s) return
    ;(s.chapterIds || []).forEach((cid) => { delete data.state.chapters[cid] })
    delete data.state.subjects[id]
    const orderIdx = (data.state.subjectOrder || []).indexOf(id)
    if (orderIdx !== -1) data.state.subjectOrder.splice(orderIdx, 1)
    const keys = Object.keys(data.state.subjects)
    if (keys.length === 0) {
      create('默认科目', false)
    } else if (data.state.currentSubjectId === id) {
      data.state.currentSubjectId = keys[0]
      data.state.currentChapterId = data.state.subjects[keys[0]].chapterIds[0] || null
    }
    data.saveState()
  }

  function select(id) {
    const s = data.state.subjects[id]
    if (!s) return
    data.state.currentSubjectId = id
    data.saveState()
  }

  function toggleCollapse(id) {
    const s = data.state.subjects[id]
    if (!s) return
    s.collapsed = !s.collapsed
    data.saveState()
  }

  function moveToTop(id) {
    const arr = data.state.subjectOrder || Object.keys(data.state.subjects)
    const idx = arr.indexOf(id)
    if (idx <= 0) return
    arr.splice(idx, 1)
    arr.unshift(id)
    data.state.subjectOrder = arr
    data.saveState()
  }

  // —— 章节 ——
  function createChapter(subjId, name) {
    const s = data.state.subjects[subjId]
    if (!s) return null
    const finalName = (name && String(name).trim()) || '章节 ' + (s.chapterIds.length + 1)
    const id = generateId('ch')
    data.state.chapters[id] = {
      id, name: finalName, questions: [], userAnswers: [], currentIdx: 0, createdAt: Date.now(),
      strategy: { errPct: 20, reviewPct: 50, newPct: 30, typeCounts: { single: 5, judge: 5, term: 3, short: 2 }, weakTags: [] }
    }
    s.chapterIds.push(id)
    data.state.currentChapterId = id
    data.saveState()
    return id
  }

  function switchChapter(chId) {
    if (!data.state.chapters[chId]) return
    data.state.currentChapterId = chId
    for (const sid in data.state.subjects) {
      const s = data.state.subjects[sid]
      if (s.chapterIds.indexOf(chId) !== -1) {
        data.state.currentSubjectId = sid
        if (s.collapsed) s.collapsed = false
        break
      }
    }
    data.saveState()
  }

  function renameChapter(chId, newName) {
    const ch = data.state.chapters[chId]
    if (!ch || !newName || !String(newName).trim()) return
    ch.name = String(newName).trim()
    data.saveState()
  }

  function deleteChapter(chId) {
    delete data.state.chapters[chId]
    for (const sid in data.state.subjects) {
      const s = data.state.subjects[sid]
      const idx = s.chapterIds.indexOf(chId)
      if (idx !== -1) { s.chapterIds.splice(idx, 1); break }
    }
    if (data.state.currentChapterId === chId) {
      const s = data.getSubj()
      data.state.currentChapterId = (s && s.chapterIds.length > 0) ? s.chapterIds[0] : null
    }
    data.saveState()
  }

  function moveChapterToTop(subjId, cid) {
    const s = data.state.subjects[subjId]
    if (!s) return
    const idx = s.chapterIds.indexOf(cid)
    if (idx <= 0) return
    s.chapterIds.splice(idx, 1)
    s.chapterIds.unshift(cid)
    data.saveState()
  }

  return {
    list, current,
    create, rename, remove, select, toggleCollapse, moveToTop,
    createChapter, switchChapter, renameChapter, deleteChapter, moveChapterToTop
  }
})
