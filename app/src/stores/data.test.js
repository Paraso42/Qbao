// round5: K1 轮次守卫与可操作轮次（hasUnfinishedQuizSet / getActionableQuizSet / activateQuizSet）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useDataStore } from './data'
import { STORAGE_KEY } from '../services/persistence'

function makeLocalStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

function q(question, type = 'single', answer = 0) {
  return { id: question, question, type, options: ['A', 'B', 'C', 'D'], answer, tag: 'x', explanation: '' }
}

// 章节带 n 轮 3 题 quizSets；answers 形如 { 0: ['x', undefined, undefined], ... } 覆盖 userAnswers
function seedState(sets) {
  const quizSets = sets.map((answers, i) => ({
    questions: [q('题目' + i + '-1'), q('题目' + i + '-2'), q('题目' + i + '-3')],
    userAnswers: answers.slice(),
    currentIdx: 0,
    createdAt: i + 1,
  }))
  return {
    subjects: { s1: { id: 's1', name: '科目', chapterIds: ['c1'], collapsed: false } },
    subjectOrder: ['s1'],
    currentSubjectId: 's1',
    currentChapterId: 'c1',
    chapters: {
      c1: {
        id: 'c1', name: '章一', questions: [], userAnswers: [],
        quizSets, currentQuizSetIdx: quizSets.length - 1,
        strategy: { errPct: 20, reviewPct: 50, newPct: 30, typeCounts: { single: 3, judge: 0, term: 0, short: 0 }, errorTags: [], reviewTags: [], newTopicTags: [], tagMeta: {} },
      },
    },
    history: [], lastScreen: 'start', generatedExams: {},
    achievements: { unlocked: [], history: [] }, settings: { darkMode: false },
    aiConfig: {}, aiTaskQueue: [], importedServerTaskIds: [], chapterMaterials: {},
  }
}

describe('data store：K1 轮次守卫与可操作轮次 (round5)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({})
    globalThis.localStorage = storage
    setActivePinia(createPinia())
  })
  afterEach(() => { delete globalThis.localStorage })

  function setup(state) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
    return useDataStore()
  }

  it('hasUnfinishedQuizSet：无轮次 → false', () => {
    const st = seedState([])
    delete st.chapters.c1.quizSets
    const data = setup(st)
    expect(data.hasUnfinishedQuizSet(data.state.chapters.c1)).toBe(false)
  })

  it('hasUnfinishedQuizSet：最后一轮未完成 → true（含 null 位视为未作答，JSON 往返产物）', () => {
    const data = setup(seedState([[0, 1, 2], ['x', 'y', null]]))
    expect(data.hasUnfinishedQuizSet(data.state.chapters.c1)).toBe(true)
  })

  it('hasUnfinishedQuizSet：较早轮次未完成而最后一轮已答完 → true（与服务端 in_progress 口径一致）', () => {
    const data = setup(seedState([[0, null, 2], [0, 1, 2]]))
    expect(data.hasUnfinishedQuizSet(data.state.chapters.c1)).toBe(true)
  })

  it('hasUnfinishedQuizSet：含 -1（跳题）仍视为未完成 → true（与既有 K1 口径一致）', () => {
    const data = setup(seedState([[0, 1, -1], [0, 1, 2]]))
    expect(data.hasUnfinishedQuizSet(data.state.chapters.c1)).toBe(true)
    // 全部真实作答 → false
    const ch = data.state.chapters.c1
    ch.quizSets[0].userAnswers = [0, 1, 2]
    expect(data.hasUnfinishedQuizSet(ch)).toBe(false)
  })

  it('getActionableQuizSet：最后一轮未完成 → 指向最后一轮', () => {
    const data = setup(seedState([[0, 1, 2], [0, undefined, undefined]]))
    const ch = data.state.chapters.c1
    expect(data.getActionableQuizSet(ch)).toBe(ch.quizSets[1])
  })

  it('getActionableQuizSet：最后一轮已答完但旧轮未完成 → 指向最新那轮未完成的（答题入口不丢）', () => {
    const data = setup(seedState([[0, null, 2], [0, 1, 2], [0, 1, undefined]]))
    const ch = data.state.chapters.c1
    expect(data.getActionableQuizSet(ch)).toBe(ch.quizSets[2])
  })

  it('getActionableQuizSet：全部完成 → 回退最后一轮（查看报告）', () => {
    const data = setup(seedState([[0, 1, 2], [0, 1, 2]]))
    const ch = data.state.chapters.c1
    expect(data.getActionableQuizSet(ch)).toBe(ch.quizSets[1])
  })

  it('activateQuizSet：更新当前轮次指针并持久化', () => {
    const data = setup(seedState([[0, undefined, undefined], [0, 1, 2]]))
    const ch = data.state.chapters.c1
    expect(ch.currentQuizSetIdx).toBe(1)
    expect(data.activateQuizSet(ch, ch.quizSets[0])).toBe(true)
    expect(ch.currentQuizSetIdx).toBe(0)
    expect(data.activateQuizSet(ch, {})).toBe(false)
    expect(ch.currentQuizSetIdx).toBe(0)
  })
})
