// 科目视图辅助（数据本体在 data store 的 state.subjects）
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useDataStore } from './data'
import { generateId } from '../services/utils'

export const useSubjectStore = defineStore('subjects', () => {
  const data = useDataStore()

  const list = computed(() => {
    const order = data.state.subjectOrder || []
    return order
      .map((id) => data.state.subjects[id])
      .filter(Boolean)
  })

  function create(name) {
    const id = generateId('subj')
    data.state.subjects[id] = { id, name: String(name || '').trim() || '未命名科目', chapterIds: [], collapsed: false }
    data.state.subjectOrder = (data.state.subjectOrder || []).concat(id)
    data.state.currentSubjectId = id
    data.saveState()
    return id
  }

  function rename(id, name) {
    const s = data.state.subjects[id]
    if (!s) return
    s.name = String(name || '').trim() || s.name
    data.saveState()
  }

  function remove(id) {
    const s = data.state.subjects[id]
    if (!s) return
    ;(s.chapterIds || []).forEach((cid) => { delete data.state.chapters[cid] })
    delete data.state.subjects[id]
    data.state.subjectOrder = (data.state.subjectOrder || []).filter((x) => x !== id)
    if (data.state.currentSubjectId === id) data.state.currentSubjectId = null
    if (data.state.currentChapterId && !data.state.chapters[data.state.currentChapterId]) data.state.currentChapterId = null
    data.saveState()
  }

  function select(id) {
    const s = data.state.subjects[id]
    if (!s) return
    data.state.currentSubjectId = id
    if (s.chapterIds && s.chapterIds.length > 0) {
      const cur = data.state.chapters[data.state.currentChapterId]
      if (!cur || !s.chapterIds.includes(data.state.currentChapterId)) data.state.currentChapterId = s.chapterIds[0]
    }
    data.saveState()
  }

  return { list, create, rename, remove, select }
})
