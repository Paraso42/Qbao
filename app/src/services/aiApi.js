// ============================================================
// aiApi.js — AI 接口封装（/ai/*，自 legacy ai-workflow/settings 迁移）
// ============================================================
import { apiFetch, fetchWithAuth, readApiErrorSafe } from './api'

// 本地 fallback 目录（离线兜底；服务端目录为唯一事实源）
export const AI_PROVIDER_FALLBACK = [
  { id: 'ecnu', name: 'ECNU (华师大)', models: [{ id: 'ecnu-plus', name: 'ecnu-plus' }, { id: 'ecnu-turbo', name: 'ecnu-turbo' }, { id: 'ecnu-max', name: 'ecnu-max' }] },
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }] },
  { id: 'openai', name: 'OpenAI ChatGPT', models: [{ id: 'gpt-4o', name: 'gpt-4o' }, { id: 'gpt-4o-mini', name: 'gpt-4o-mini' }, { id: 'gpt-4.1', name: 'gpt-4.1' }] },
  { id: 'gemini', name: 'Google Gemini', models: [{ id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' }, { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' }] }
]

export async function fetchProvidersList() {
  try {
    const res = await apiFetch('/ai/providers', { auth: false })
    if (res && res.ok) {
      const data = await res.json()
      if (data.providers && data.providers.length > 0) return data.providers
    }
  } catch (e) {
    console.warn('Failed to fetch AI providers:', e)
  }
  return AI_PROVIDER_FALLBACK
}

// 最小化连接测试（POST /ai/test）
export async function aiTest({ apiKey, provider, model, message }) {
  const res = await apiFetch('/ai/test', {
    method: 'POST',
    headers: { 'x-ai-api-key': apiKey, 'x-ai-model': model, 'x-ai-provider': provider },
    body: { message: message || 'ping' },
  })
  if (!res || !res.ok) throw new Error(await readApiErrorSafe(res, '连接测试失败'))
  return res.json()
}

// 上传资料解析（POST /ai/upload，FormData 'files'）
export async function aiUploadFiles(files) {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f))
  const res = await apiFetch('/ai/upload', { method: 'POST', body: fd })
  if (!res || !res.ok) throw new Error(await readApiErrorSafe(res, '上传失败: ' + (res && res.status)))
  return res.json()
}

function aiHeaders({ apiKey, provider, model, stream }) {
  const h = {
    'x-ai-api-key': apiKey,
    'x-ai-model': model,
    'x-ai-provider': provider
  }
  if (stream) h['x-ai-stream'] = 'true'
  return h
}

export function buildAiGenerateBody({ textContent, typeCounts, prompt, chapterHistory, chapterId, selfCheck }) {
  return JSON.stringify({
    textContent,
    typeCounts: typeCounts || { single: 10, judge: 5, term: 2, short: 1 },
    prompt,
    selfCheck: selfCheck === true,
    chapterHistory: chapterHistory || {
      totalQuestions: 0, totalAnswered: 0, totalWrong: 0,
      tagStats: {}, topWrongTags: []
    },
    chapterId
  })
}

// 非流式生成（重试在调用方）
export async function aiGenerate(opts) {
  const res = await apiFetch('/ai/generate', {
    method: 'POST',
    headers: aiHeaders(opts),
    rawBody: buildAiGenerateBody(opts),
  })
  if (!res || !res.ok) throw new Error(await readApiErrorSafe(res, '生成失败: ' + (res && res.status)))
  return res.json()
}

// 流式生成：SSE 解析，返回 { questions, poolFilesStatus, streamDone }
export async function aiStreamGenerate(opts, { onChunk, onProgress, signal } = {}) {
  const res = await apiFetch('/ai/generate', {
    method: 'POST',
    headers: aiHeaders({ ...opts, stream: true }),
    rawBody: buildAiGenerateBody(opts),
    signal,
  })
  if (!res || !res.ok) throw new Error(await readApiErrorSafe(res, '生成失败: ' + (res && res.status)))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulatedQuestions = []
  let fullContent = ''
  let poolFilesStatus = null
  let streamDoneOk = false
  let streamError = null

  const flushLine = async (line) => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6)
    if (data === '[DONE]') return
    let evt
    try { evt = JSON.parse(data) } catch (e) { return }
    if (evt.content) fullContent += evt.content
    if (evt.newParsed && Array.isArray(evt.newParsed) && evt.newParsed.length > 0) {
      accumulatedQuestions = accumulatedQuestions.concat(evt.newParsed)
      if (onProgress) onProgress(evt.newParsed, accumulatedQuestions.length)
    }
    if (evt.done) {
      if (evt.error) { streamError = evt.error }
      streamDoneOk = true
      if (evt.questions && Array.isArray(evt.questions)) accumulatedQuestions = evt.questions.slice()
      if (evt.poolFilesStatus) poolFilesStatus = evt.poolFilesStatus
      if (onChunk) await onChunk(evt)
    }
  }

  while (true) {
    const r = await reader.read()
    if (r.done) break
    buffer += decoder.decode(r.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) await flushLine(line)
  }

  if (!streamDoneOk && accumulatedQuestions.length > 0) {
    streamDoneOk = true
    // 尝试从 fullContent 解析可能未被提取的剩余题目
    try {
      const fcClean = fullContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      const fcMatch = fcClean.match(/\[[\s\S]*\]/)
      if (fcMatch) {
        const fcAll = JSON.parse(fcMatch[0])
        if (Array.isArray(fcAll) && fcAll.length > accumulatedQuestions.length) accumulatedQuestions = fcAll.slice()
      }
    } catch (e) { /* ignore */ }
  }

  return { questions: accumulatedQuestions, poolFilesStatus, streamDoneOk, streamError, fullContent }
}

// —— 服务端任务队列（v3.27） ——
export async function createAiServerTask({ apiKey, provider, model, body }) {
  const res = await apiFetch('/ai/tasks', {
    method: 'POST',
    headers: { 'x-ai-api-key': apiKey, 'x-ai-model': model, 'x-ai-provider': provider },
    body,
  })
  if (!res || !res.ok) throw new Error(await readApiErrorSafe(res, '创建服务端任务失败: ' + (res && res.status)))
  return res.json()
}

export async function getAiServerTask(taskId) {
  const res = await fetchWithAuth('/ai/tasks/' + taskId)
  if (!res || !res.ok) throw new Error('查询服务端任务失败')
  const data = await res.json()
  return data.task
}

export async function listAiServerTasks(limit = 50) {
  const res = await fetchWithAuth('/ai/tasks?limit=' + limit)
  if (!res || !res.ok) throw new Error('获取服务端任务列表失败')
  const data = await res.json()
  return data.tasks || []
}

export async function cancelAiServerTask(taskId) {
  const res = await fetchWithAuth('/ai/tasks/' + taskId, { method: 'DELETE' })
  if (!res || !res.ok) throw new Error(await readApiErrorSafe(res, '取消失败'))
  return res.json()
}
