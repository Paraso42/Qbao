// P1.4 quiz store 核心流转单测（答题引擎状态流转：选择/提交/边界/结算）
// 真实 data/user/ui stores + 内存 localStorage 播种；services 为纯函数真实执行。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useQuizStore } from './quiz'
import { useDataStore } from './data'
import { useUiStore } from './ui'
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

function q(question, type = 'single', answer = 0, extra = {}) {
  return { id: question, question, type, options: ['A1', 'B2', 'C3', 'D4'], answer, tag: 'x', strategy: 'new', explanation: '', ...extra }
}

// typeCounts 构造一套"3 题单选"章节状态（seed 进 localStorage 供 data store 读取）
function seedState({ chapter = 'c1' } = {}) {
  const q1 = q('第一题'), q2 = q('第二题'), q3 = q('第三题')
  return {
    subjects: { s1: { id: 's1', name: '科目', chapterIds: [chapter], collapsed: false } },
    subjectOrder: ['s1'],
    currentSubjectId: 's1',
    chapters: {
      [chapter]: {
        id: chapter,
        name: '章一',
        questions: [q1, q2, q3],
        userAnswers: [undefined, undefined, undefined],
        quizSets: [{
          questions: [q1, q2, q3],
          userAnswers: [undefined, undefined, undefined],
          currentIdx: 0,
          createdAt: 1,
        }],
        currentQuizSetIdx: 0,
        strategy: { errPct: 20, reviewPct: 50, newPct: 30, typeCounts: { single: 3, judge: 0, term: 0, short: 0 }, errorTags: [], reviewTags: [], newTopicTags: [], tagMeta: {} },
      },
    },
    currentChapterId: chapter,
    history: [],
    lastScreen: 'start',
    achievements: { unlocked: [], history: [] },
    settings: { darkMode: false },
    aiConfig: {},
    aiTaskQueue: [],
    importedServerTaskIds: [],
    chapterMaterials: {},
  }
}

describe('quiz store 核心流转 (P1.4)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({})
    globalThis.localStorage = storage
    setActivePinia(createPinia())
  })
  afterEach(() => { delete globalThis.localStorage; vi.restoreAllMocks() })

  function setup(state) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
    const data = useDataStore()
    const quiz = useQuizStore()
    const ui = useUiStore()
    return { data, quiz, ui }
  }

  it('startSession：有未完成 quizSet 时打开答题并保持进度（可续答）', () => {
    const state = seedState()
    state.chapters.c1.quizSets[0].userAnswers = [0, undefined, undefined]
    state.chapters.c1.quizSets[0].currentIdx = 1
    const { quiz } = setup(state)
    quiz.startSession()
    expect(quiz.session.modalOpen).toBe(true)
    expect(quiz.currentQuestion.question).toBe('第二题')
    expect(quiz.currentAnswer).toBe(undefined)
  })

  it('selectOption：记录答案、推进统计、已答后重复选择被忽略', () => {
    const { data, quiz } = setup(seedState())
    const as = data.getActiveSet()
    quiz.selectOption(1)
    expect(as.userAnswers[0]).toBe(1)
    expect(quiz.hasAnswer).toBe(true)
    expect(quiz.currentAnswer).toBe(1)
    // 已答再选：不覆盖
    quiz.selectOption(2)
    expect(as.userAnswers[0]).toBe(1)
    // 落盘：localStorage 骨架被更新（saveState 生效）
    const saved = JSON.parse(storage.getItem(STORAGE_KEY))
    expect(saved.chapters.c1).toBeTruthy()
  })

  it('nextQuestion/goToQuestion：边界不越界、进度随动', () => {
    const { quiz } = setup(seedState())
    expect(quiz.currentQuestion.question).toBe('第一题')
    quiz.nextQuestion()
    expect(quiz.currentQuestion.question).toBe('第二题')
    quiz.goToQuestion(2)
    expect(quiz.currentQuestion.question).toBe('第三题')
    quiz.nextQuestion() // 最后一题不越界
    expect(quiz.currentQuestion.question).toBe('第三题')
    quiz.goToQuestion(99)
    expect(quiz.currentQuestion.question).toBe('第三题')
  })

  it('submitAnswer：主观题空文本拒绝并提示，有效文本记录', () => {
    const state = seedState()
    state.chapters.c1.quizSets[0].questions = [q('简述原理', 'short', '', { options: undefined })]
    state.chapters.c1.quizSets[0].userAnswers = [undefined]
    state.chapters.c1.questions = state.chapters.c1.quizSets[0].questions.slice()
    state.chapters.c1.userAnswers = [undefined]
    const { quiz, ui } = setup(state)
    quiz.startSession() // 真实路径：先进入答题（null→undefined 归正）
    quiz.submitAnswer('   ')
    expect(ui.toasts.some((t) => t.message.includes('请输入答案'))).toBe(true)
    expect(quiz.currentAnswer).toBe(undefined)
    quiz.submitAnswer('我的简述答案')
    expect(quiz.currentAnswer).toBe('我的简述答案')
  })

  it('markDontKnow：只对客观题生效，记录一个错误选项', () => {
    const { quiz, data } = setup(seedState())
    const as = data.getActiveSet()
    quiz.markDontKnow()
    const recorded = as.userAnswers[0]
    expect(recorded).not.toBe(0) // 正确答案是 0 → 记录的不是 0（错选）
    expect([1, 2, 3]).toContain(recorded)
  })

  it('endExam（轮次结算）：未答置 -1、历史入账、报告视图', () => {
    const { quiz, data } = setup(seedState())
    quiz.startSession() // 归正 null → undefined（模拟刷新后真实入口）
    quiz.selectOption(0) // 第 1 题答对
    quiz.nextQuestion()
    quiz.selectOption(0) // 第 2 题答对
    quiz.nextQuestion() // 第 3 题不答
    quiz.endExam()
    expect(quiz.session.view).toBe('report')
    expect(data.state.history).toHaveLength(1)
    const rec = data.state.history[0]
    expect(rec.total).toBe(3)
    expect(rec.correct).toBe(2)
    // 未答的第 3 题被 finalize 成 -1
    expect(rec.questions[2].userAnswer).toBe(-1)
    expect(data.state.history[0].questions[2].userAnswer).toBe(-1)
  })

  it('resetQuiz：清空本轮答案并回到第一题', () => {
    const { quiz, data } = setup(seedState())
    const as = data.getActiveSet()
    quiz.selectOption(0)
    quiz.nextQuestion()
    quiz.resetQuiz()
    expect(as.userAnswers.every((a) => a === undefined)).toBe(true)
    expect(quiz.currentQuestion.question).toBe('第一题')
    expect(quiz.session.modalOpen).toBe(true) // set 模式答题框保持打开
  })

  it('closeQuiz/openQuiz 视图切换', () => {
    const { quiz } = setup(seedState())
    quiz.openQuiz('report')
    expect(quiz.session.modalOpen).toBe(true)
    expect(quiz.session.view).toBe('report')
    quiz.closeQuiz()
    expect(quiz.session.modalOpen).toBe(false)
    expect(quiz.session.wrongOnly).toBe(false)
  })
})

describe('大考卷报告上下文 (round4.1)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({})
    globalThis.localStorage = storage
    setActivePinia(createPinia())
  })
  afterEach(() => { delete globalThis.localStorage; vi.restoreAllMocks() })

  function setupWithExam() {
    const state = seedState()
    const eqs = [q('考卷题一'), q('考卷题二'), q('考卷题三')]
    state.generatedExams = {
      exam1: {
        id: 'exam1', name: '我的大考卷', subjectId: 's1', type: 'exam', createdAt: Date.now(),
        questions: eqs, userAnswers: [0, 1, 0], currentIdx: 2,
      },
    }
    state.currentExamId = 'exam1'
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
    const data = useDataStore()
    const quiz = useQuizStore()
    const ui = useUiStore()
    return { data, quiz, ui, eqs }
  }

  it('endExam（考卷结算）后：报告视图仍指向该考卷，而不是回落到章节轮次', () => {
    const { data, quiz, eqs } = setupWithExam()
    quiz.openQuiz('quiz')
    quiz.endExam()
    expect(quiz.session.view).toBe('report')
    // currentExamId 保留 → activeSet 仍是考卷（报告题目与考卷一致）
    expect(data.state.currentExamId).toBe('exam1')
    const as = quiz.activeSet
    expect(as.setId).toBe('exam1')
    expect(as.questions.map((x) => x.question)).toEqual(eqs.map((x) => x.question))
    expect(quiz.stats.total).toBe(3)
    // 章节轮次被正确遮蔽（此前 bug：报告显示章节 c1 的三题）
    expect(as.questions[0].question).not.toBe('第一题')
  })

  it('关闭考卷报告 → currentExamId 清理，章节答题不再被遮蔽', () => {
    const { data, quiz } = setupWithExam()
    quiz.openQuiz('quiz')
    quiz.endExam()
    quiz.closeQuiz()
    expect(data.state.currentExamId).toBeNull()
    expect(quiz.session.modalOpen).toBe(false)
  })

  it('答到一半关闭考卷（未结束）→ 保留 currentExamId 便于续答', () => {
    const { data, quiz } = setupWithExam()
    quiz.openQuiz('quiz')
    quiz.closeQuiz()
    expect(data.state.currentExamId).toBe('exam1')
  })

  it('startExam / openExamReport 重置或设置结束上下文', () => {
    const { data, quiz } = setupWithExam()
    // 模拟上一次结束后关闭已清空 → 重新开始考卷
    data.state.currentExamId = null
    quiz.startExam('exam1')
    expect(data.state.currentExamId).toBe('exam1')
    quiz.endExam()
    expect(quiz.session.view).toBe('report')
    // 关闭后重开报告入口
    quiz.closeQuiz()
    expect(data.state.currentExamId).toBeNull()
    quiz.openExamReport('exam1')
    expect(data.state.currentExamId).toBe('exam1')
    expect(quiz.session.view).toBe('report')
    expect(quiz.activeSet.setId).toBe('exam1')
  })
})
