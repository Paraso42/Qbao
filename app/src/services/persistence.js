// ============================================================
// persistence.js — 本地状态持久化（自 legacy state.js 迁移，语义不变）
// localStorage 键与数据结构保持兼容：老用户数据无缝升级。
// ============================================================
import { migrateLegacyAiKeysFromState, stripAiSecretsFromState, hasAnyAiApiKey } from './aiKeys'

export const DEFAULT_STATE = {
  subjects: {},
  currentSubjectId: null,
  chapters: {},
  currentChapterId: null,
  history: [],
  lastScreen: 'start'
}

export const STORAGE_KEY = 'quizEngineState_v7'
export const CLOUD_STORAGE_PREFIX = 'quizEngineState_cloud_'

function getUserStored() {
  try {
    const raw = localStorage.getItem('qbao_user')
    if (raw) {
      const u = JSON.parse(raw)
      if (u && u.id) return u
    }
  } catch (e) {}
  return null
}

export function loadState() {
  let state
  try {
    // 已登录时优先加载该账号的云端数据
    const user = getUserStored()
    const cloudKey = user ? CLOUD_STORAGE_PREFIX + user.id : null
    const saved = (cloudKey && localStorage.getItem(cloudKey)) || localStorage.getItem(STORAGE_KEY)
    if (saved) {
      state = JSON.parse(saved)
      state = migrateState(state)
      return state
    }
  } catch (e) { console.warn('[persist] load err', e) }
  return JSON.parse(JSON.stringify(DEFAULT_STATE))
}

export function sanitizeState(state) {
  if (state.srsData) {
    const validIds = {}
    Object.keys(state.chapters || {}).forEach(function (cid) { validIds[cid] = true })
    Object.keys(state.srsData).forEach(function (qId) {
      const cid = qId.split(':')[0]
      if (!validIds[cid]) delete state.srsData[qId]
    })
  }
}

export function getChStrategy(state, cid) {
  const ch = state.chapters[cid]
  if (!ch) return null
  if (!ch.strategy) ch.strategy = {}
  const s = ch.strategy
  if (!s.typeCounts || typeof s.typeCounts !== 'object') s.typeCounts = { single: 5, judge: 5, term: 3, short: 2 }
  ;['single', 'judge', 'term', 'short'].forEach(function (k) {
    if (typeof s.typeCounts[k] !== 'number') s.typeCounts[k] = 5
  })
  if (typeof s.errPct !== 'number') s.errPct = 20
  if (typeof s.reviewPct !== 'number') s.reviewPct = 50
  if (typeof s.newPct !== 'number') s.newPct = 30
  if (!s.errorTags) s.errorTags = []
  if (!s.reviewTags) s.reviewTags = []
  if (!s.newTopicTags) s.newTopicTags = []
  if (!s.tagMeta) s.tagMeta = {}
  return s
}

// 持久化序列化：剥离瞬态引用与密钥字段后写入 localStorage（双键）。
// 同步调度由调用方（data store / sync service）负责。
export function saveState(state) {
  try {
    stripAiSecretsFromState(state)

    const qs = state.quizSession
    state.quizSession = null

    if (state.aiTaskQueue) state.aiTaskQueue.forEach(function (t) { t._ssr = t.streamSetRef; delete t.streamSetRef })

    const origCm = state.chapterMaterials
    if (origCm) {
      const cleanCm = {}
      Object.keys(origCm).forEach(function (cid) {
        cleanCm[cid] = origCm[cid].map(function (m) {
          const copy = {}
          for (const k in m) { if (k !== 'data') copy[k] = m[k] }
          return copy
        })
      })
      state.chapterMaterials = cleanCm
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const user = getUserStored()
    if (user && user.id) localStorage.setItem(CLOUD_STORAGE_PREFIX + user.id, JSON.stringify(state))

    if (state.aiTaskQueue) state.aiTaskQueue.forEach(function (t) { t.streamSetRef = t._ssr; delete t._ssr })
    state.quizSession = qs
    state.chapterMaterials = origCm
  } catch (e) {
    console.error('[persist] saveState error:', e)
  }
}

export function migrateState(s) {
  if (!s.history) s.history = []
  // 阻止页面加载后自动打开聊天/答题弹窗
  if (s.lastScreen === 'chat') s.lastScreen = 'start'
  if (s.lastScreen === 'quiz') s.lastScreen = 'start'
  if (!s.subjects) s.subjects = {}
  if (!s.chapters) s.chapters = {}

  for (const cid in s.chapters) {
    const ch = s.chapters[cid]
    if (!ch.strategy) ch.strategy = {
      errPct: 20, reviewPct: 50, newPct: 30,
      typeCounts: { single: 5, judge: 5, term: 3, short: 2 },
      errorTags: [], reviewTags: [], newTopicTags: [], tagMeta: {}
    }
    if (!ch.quizSets && ch.questions && ch.questions.length > 0) {
      ch.quizSets = [{ questions: ch.questions.slice(), userAnswers: (ch.userAnswers || []).slice(), currentIdx: 0, createdAt: Date.now() }]
    }
    if (!ch.strategy.errorTags) ch.strategy.errorTags = []
    if (!ch.strategy.reviewTags) ch.strategy.reviewTags = []
    if (!ch.strategy.newTopicTags) ch.strategy.newTopicTags = []
    if (!ch.strategy.tagMeta) ch.strategy.tagMeta = {}
    // 旧 weakTags → errorTags
    if (ch.strategy.weakTags && Array.isArray(ch.strategy.weakTags) && ch.strategy.errorTags.length === 0) {
      ch.strategy.weakTags.forEach(function (t) {
        const tName = typeof t === 'string' ? t : t.name
        if (tName && ch.strategy.errorTags.indexOf(tName) < 0) ch.strategy.errorTags.push(tName)
      })
      delete ch.strategy.weakTags
    }
    if (ch.weakTags && Array.isArray(ch.weakTags)) {
      if (typeof ch.weakTags[0] === 'string') ch.strategy.weakTags = ch.weakTags.map((t) => ({ name: t, active: true }))
      else ch.strategy.weakTags = ch.weakTags
      delete ch.weakTags
    }
  }
  if (s.weakTags) delete s.weakTags

  // 只有章节没有科目时兜底创建默认科目
  if (Object.keys(s.subjects).length === 0 && Object.keys(s.chapters).length > 0) {
    const sid = 'subj_' + Date.now().toString(36)
    s.subjects[sid] = { id: sid, name: '默认科目', chapterIds: Object.keys(s.chapters) }
    s.currentSubjectId = sid
  }

  for (const sid in s.subjects) {
    if (typeof s.subjects[sid].collapsed !== 'boolean') s.subjects[sid].collapsed = false
  }

  if (!s.achievements) s.achievements = { unlocked: [], history: [] }
  if (!s.ignoredQuestions) s.ignoredQuestions = []

  if (!s.subjectOrder || !Array.isArray(s.subjectOrder)) s.subjectOrder = Object.keys(s.subjects)
  Object.keys(s.subjects).forEach(function (sid) { if (!s.subjectOrder.includes(sid)) s.subjectOrder.push(sid) })
  s.subjectOrder = s.subjectOrder.filter(function (sid) { return !!s.subjects[sid] })

  if (!s.srsData) s.srsData = {}
  if (!s.settings) s.settings = { quizFontSize: 17, sidebarFontSize: 13, topbarFontSize: 14, mainFontSize: 17, darkMode: false, showNoticeBar: true }
  if (!s.settings.sidebarFontSize) s.settings.sidebarFontSize = 13
  if (!s.settings.topbarFontSize) s.settings.topbarFontSize = 14
  if (!s.settings.mainFontSize) s.settings.mainFontSize = 17
  if (typeof s.settings.darkMode !== 'boolean') s.settings.darkMode = false
  if (typeof s.settings.showNoticeBar !== 'boolean') s.settings.showNoticeBar = true

  if (!s.generatedExams) s.generatedExams = {}
  if (!s.aiConfig) s.aiConfig = {}
  if (typeof s.aiConfig.systemPrompt !== 'string') s.aiConfig.systemPrompt = ''
  if (!s.aiConfig.provider) s.aiConfig.provider = 'ecnu'
  if (!s.aiConfig.model) s.aiConfig.model = 'ecnu-plus'
  if (!s.aiConfig.providerKeys) {
    s.aiConfig.providerKeys = {}
    if (s.aiConfig.apiKey) s.aiConfig.providerKeys.ecnu = s.aiConfig.apiKey
  }
  if (s.aiConfig.providerKeys && Object.keys(s.aiConfig.providerKeys).length > 0) {
    s.aiConfig.apiKeySet = true
  }

  // v3.27: AI Key 与同步状态分离
  migrateLegacyAiKeysFromState(s)
  stripAiSecretsFromState(s)
  s.aiConfig.apiKeySet = hasAnyAiApiKey()

  if (!s.chapterMaterials) s.chapterMaterials = {}
  if (typeof s.aiEnabled !== 'boolean') s.aiEnabled = false
  if (!s.aiTaskQueue) s.aiTaskQueue = []
  // 页面刷新后重置 running 任务为 pending，清掉不可序列化的流引用
  s.aiTaskQueue.forEach((t) => { if (t.status === 'running') t.status = 'pending'; delete t.streamSetRef })
  // quizSession 为瞬态，不持久化
  s.quizSession = null
  return s
}
