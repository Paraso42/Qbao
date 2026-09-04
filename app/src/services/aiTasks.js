// ============================================================
// aiTasks.js — AI 生成任务核心（v3.32 P2.1 自 stores/ai.js 拆分）
// 纯函数/无 store 依赖的生成逻辑：题目归一化、策略符合度核算、
// 非流式生成（含 JSON 纠错重试）、池文件诊断。store 只保留编排。
// ============================================================
import { API_BASE } from '../core/env'
import { getToken } from './api'
import { sleep, fetchWithRetry } from './utils'
import { idbGetMaterial } from './materialsDb'
import { aiUploadFiles, aiStreamGenerate } from './aiApi'
import { computeStrategyTargets } from './strategy'

export const AI_MAX_ATTEMPTS = 3

// 题目归一化：补 id、过滤空题干（生成侧与导入侧共用）
export function normalizeQuestions(questions) {
  return questions
    .map((q, i) => { if (!q.id) q.id = i + 1; return q })
    .filter((q) => q.question && q.question.trim().length > 2)
}

// 策略符合度核算：期望分布（strategySnapshot）vs 实际（按 strategy 字段统计）
export function applyStrategyCompliance(task, questions) {
  if (!questions || questions.length === 0) return
  const sc = { error: 0, review: 0, new: 0, unlabeled: 0 }
  questions.forEach((q) => {
    if (q.strategy && ['error', 'review', 'new'].indexOf(q.strategy) >= 0) sc[q.strategy]++
    else sc.unlabeled++
  })
  const st = task.strategySnapshot
  const totalQ2 = (st ? st.typeCounts.single + st.typeCounts.judge + st.typeCounts.term + st.typeCounts.short : questions.length) || questions.length
  // 与 generatePromptText 同一配额换算（取整 clamp、无标签并入 new）——期望值与提示词一致
  const target = computeStrategyTargets(
    totalQ2,
    st ? st.errPct : 60,
    st ? st.reviewPct : 20,
    st ? st.errorTags : [],
    st ? st.reviewTags : []
  )
  task.strategyCompliance = {
    expected: { error: target.error, review: target.review, new: target.new },
    actual: sc,
    ok: Math.abs(sc.error - target.error) <= 2 && Math.abs(sc.review - target.review) <= 2 && Math.abs(sc.new - target.new) <= 2
  }
}

// 非流式生成（重试在模块内，最多 AI_MAX_ATTEMPTS 次；JSON 解析失败自动纠错重试）
// deps: { aiSelfCheck: boolean }（生成时刻的 selfCheck 配置）
export async function nonStreamGenerate(task, opts, retryPromptBase, deps = {}) {
  let questions = null
  let lastJson = ''
  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS && !questions; attempt++) {
    if (attempt > 1) await sleep(2000 * (attempt - 1))
    const retryPrompt = attempt > 1
      ? retryPromptBase + '\n\n重要：你上次返回了无效JSON，错误是：' + lastJson + '。请修正后重新输出纯JSON数组。'
      : retryPromptBase
    const genRes = await fetchWithRetry(API_BASE + '/ai/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken(),
        'x-ai-api-key': opts.apiKey,
        'x-ai-model': opts.model,
        'x-ai-provider': opts.provider
      },
      body: JSON.stringify({
        textContent: opts.uploadData.text,
        imageUrls: opts.uploadData.images,
        typeCounts: opts.typeCounts,
        prompt: opts.finalPrompt + (attempt > 1 ? retryPrompt.slice(retryPromptBase.length) : ''),
        selfCheck: deps.aiSelfCheck === true,
        chapterHistory: opts.chapterHistory,
        chapterId: opts.chapterId
      })
    }, 3, 5000)
    const genData = await genRes.json()
    if (genData.poolFilesStatus) task._poolFilesStatus = genData.poolFilesStatus
    let raw = genData.questions
    if (!raw && genData.output) raw = genData.output
    if (!raw && typeof genData === 'object') raw = Object.values(genData).find((v) => Array.isArray(v) || typeof v === 'string')
    if (typeof raw === 'string') {
      raw = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      try { questions = JSON.parse(raw) } catch (e) {
        lastJson = e.message
        if (attempt < AI_MAX_ATTEMPTS) continue
        else throw new Error('JSON格式错误: ' + e.message)
      }
    }
    if (Array.isArray(raw)) questions = raw
    if (!Array.isArray(questions) || questions.length === 0) {
      lastJson = '不是数组或为空'
      if (attempt < AI_MAX_ATTEMPTS) continue
      else throw new Error('AI未返回有效题目')
    }
    questions = normalizeQuestions(questions)
    if (questions.length === 0) {
      lastJson = '题目内容为空'
      if (attempt < AI_MAX_ATTEMPTS) continue
      else throw new Error('AI返回的题目全部为空')
    }
  }
  return questions
}


// —— 本地资料上传解析（P2.1 拆分；materials 由调用方传入） ——
export async function prepareUploadData(materials, task) {
  const localMaterials = (materials || []).filter((m) => !m._poolFile)
  const files = []
  for (const m of localMaterials) {
    const dataUrl = await idbGetMaterial(m.id)
    if (!dataUrl) {
      if (task.log) task.log.push('资料 ' + m.name + ' 本地无缓存，将在服务端读取')
      continue
    }
    const dec = atob(dataUrl.split(',')[1])
    const bin = new Uint8Array(dec.length)
    for (let j = 0; j < dec.length; j++) bin[j] = dec.charCodeAt(j)
    files.push(new Blob([bin], { type: m.type || 'application/octet-stream' }))
    files[files.length - 1]._name = m.name
  }
  let uploadData = { text: '', images: [] }
  if (files.length > 0) {
    const named = files.map((blob, i) => new File([blob], blob._name || ('file' + i), { type: blob.type }))
    uploadData = await aiUploadFiles(named)
  }
  await sleep(1000)
  return uploadData
}

// —— 流式生成（v3.30.1 起停用，保留代码便于恢复；P2.1 拆分） ——
// deps: { data, abortSignal, aiSelfCheck }
export async function streamGenerate(task, opts, deps = {}) {
  const data = deps.data
  const ch = data.state.chapters[task.chapterId]
  // 空 set 预创建（原 store 内 createEmptyQuizSet 语义）
  let emptySet = null
  if (ch) {
    if (!ch.quizSets) ch.quizSets = []
    emptySet = { questions: [], userAnswers: [], currentIdx: 0, createdAt: Date.now() }
    ch.quizSets.push(emptySet)
    ch.currentQuizSetIdx = ch.quizSets.length - 1
  }
  task.streamSetRef = emptySet
  let lastSaveAt = 0

  const result = await aiStreamGenerate(
    {
      apiKey: opts.apiKey, provider: opts.provider, model: opts.model,
      textContent: opts.uploadData.text,
      typeCounts: opts.typeCounts,
      prompt: opts.finalPrompt,
      chapterHistory: opts.chapterHistory,
      chapterId: opts.chapterId,
      selfCheck: deps.aiSelfCheck === true
    },
    {
      signal: deps.abortSignal ? deps.abortSignal : undefined,
      onProgress: (newParsed, totalCount) => {
        task.streamQuestionCount = totalCount
        if (task.streamSetRef) {
          task.streamSetRef.questions.push.apply(task.streamSetRef.questions, newParsed)
          const undefs = newParsed.map(() => undefined)
          task.streamSetRef.userAnswers.push.apply(task.streamSetRef.userAnswers, undefs)
        }
        const now = Date.now()
        if (now - lastSaveAt > 1000) {
          lastSaveAt = now
          data.saveState()
        }
      },
      onChunk: async (evt) => {
        if (evt.done && evt.questions && Array.isArray(evt.questions)) {
          const oldAnswers = task.streamSetRef ? task.streamSetRef.userAnswers.slice() : []
          if (task.streamSetRef) {
            task.streamSetRef.questions = evt.questions.slice()
            task.streamSetRef.userAnswers = []
            for (let k = 0; k < evt.questions.length; k++) {
              task.streamSetRef.userAnswers.push(k < oldAnswers.length && oldAnswers[k] !== undefined ? oldAnswers[k] : undefined)
            }
          }
        }
        if (evt.poolFilesStatus) task._poolFilesStatus = evt.poolFilesStatus
      }
    }
  )

  if (result.poolFilesStatus) task._poolFilesStatus = result.poolFilesStatus
  if (task.streamSetRef && ch) {
    if (!ch.questions) ch.questions = []
    result.questions.forEach((q) => ch.questions.push(q))
    if (!ch.userAnswers) ch.userAnswers = []
    ch.userAnswers = ch.userAnswers.concat(result.questions.map(() => undefined))
  }
  return normalizeQuestions(result.questions)
}

// 池文件诊断：生成结果中的池文件状态 → 失败告警/成功计数（只跑一次）
export function processPoolDiagnostics(task) {
  if (task.poolFilesTotal !== undefined || !task._poolFilesStatus || !Array.isArray(task._poolFilesStatus)) return
  const pfs = task._poolFilesStatus
  const failed = pfs.filter((s) => !s.extracted || s.empty || s.error)
  if (failed.length > 0) {
    task.poolFileWarnings = failed.map((s) => s.name + ': ' + (s.error || (s.empty ? '内容为空' : '提取失败')))
  }
  const ok = pfs.filter((s) => s.extracted && !s.empty && !s.error)
  task.poolFilesUsed = ok.length
  task.poolFilesTotal = pfs.length
  delete task._poolFilesStatus
}