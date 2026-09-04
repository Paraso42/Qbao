// ============================================================
// aiServerTasks.js — 服务端 AI 任务协调器（v3.32 P2.1 自 stores/ai.js 拆分）
// 组合式 controller：管理服务端任务列表、轮询续跑、结果导入/取消与队列弹窗状态。
// store 侧仅保留编排（executeTask 引用 startServerTaskPolling / isServerTaskImported 等）。
// ============================================================
import { ref } from 'vue'
import { listAiServerTasks, cancelAiServerTask } from './aiApi'
import { normalizeQuestions } from './aiTasks'

const SERVER_POLL_MS = 8000

export function createServerTaskController({ data, user, ui }) {
  const serverTasks = ref([])
  const serverTasksLoading = ref(false)
  const serverPollTimer = ref(null)
  const queueDialogOpen = ref(false)

  async function refreshServerTasks() {
    if (!user.isOnline || !user.token) return
    serverTasksLoading.value = true
    try {
      serverTasks.value = await listAiServerTasks(50)
      reconcileServerTasks()
    } catch (e) {
      console.warn('[ai] refreshServerTasks failed:', e.message)
    } finally {
      serverTasksLoading.value = false
    }
  }

  // 将服务端任务与本地队列关联（按 serverTaskId），本地运行中任务若已由服务端完成则同步状态
  // 修复：自动导入后记录 importedServerTaskIds（持久化），列表不再显示可重复导入的任务
  function markServerTaskImported(id) {
    if (!id) return
    if (!data.state.importedServerTaskIds) data.state.importedServerTaskIds = []
    if (!data.state.importedServerTaskIds.includes(id)) {
      data.state.importedServerTaskIds.push(id)
      // 仅保留最近 100 条，防止无限增长
      if (data.state.importedServerTaskIds.length > 100) {
        data.state.importedServerTaskIds = data.state.importedServerTaskIds.slice(-100)
      }
    }
  }

  function reconcileServerTasks() {
    const queue = data.state.aiTaskQueue || []
    serverTasks.value.forEach((st) => {
      const local = queue.find((t) => t.serverTaskId === st.id)
      if (!local) return
      if (st.status === 'completed' && local.status !== 'completed') {
        const questions = normalizeQuestions((st.result && Array.isArray(st.result.questions)) ? st.result.questions : [])
        // 幂等：并发/重复轮询只导入一次
        if (questions.length > 0 && !isServerTaskImported(st.id)) {
          data.createQuizSetForChapter(questions, local.chapterId)
          markServerTaskImported(st.id)
        }
        local.status = 'completed'
        local.questionCount = questions.length
        local.completedAt = Date.now()
        // 保留 serverTaskId：本地任务区过滤 serverTaskId，服务端任务才不落本地列表
        data.saveState()
        ui.toast(local.chapterName + ' 服务端任务完成，已导入 ' + questions.length + ' 题', 'ok')
      } else if (st.status === 'failed' || st.status === 'canceled') {
        if (local.status === 'running' || local.status === 'pending') {
          local.status = 'failed'
          local.error = st.error || '服务端任务未完成'
          data.saveState()
        }
      }
    })
    // 历史保留：已完成（含已导入）任务继续留在列表供查看出题历史；
    // 重复导入由 importServerTaskResult / isServerTaskImported 幂等守卫拦截
  }

  function isServerTaskImported(id) {
    return !!(data.state.importedServerTaskIds && data.state.importedServerTaskIds.includes(id))
  }

  function hasActiveServerTasks() {
    return (serverTasks.value || []).some((st) => st.status === 'queued' || st.status === 'running')
  }

  // —— T11: 服务端任务自动轮询续跑（修复 P1-5：刷新后自动续跑，全部结束且弹窗关闭后自停） ——
  async function pollServerTasksOnce() {
    try {
      await refreshServerTasks()
    } catch (e) {
      console.warn('[ai] server poll tick failed:', e && e.message)
    }
    if (!hasActiveServerTasks() && !queueDialogOpen.value) stopServerTaskPolling()
  }

  function startServerTaskPolling() {
    if (serverPollTimer.value) return
    serverPollTimer.value = setInterval(pollServerTasksOnce, SERVER_POLL_MS)
    if (serverPollTimer.value && typeof serverPollTimer.value.unref === 'function') {
      serverPollTimer.value.unref()
    }
  }

  function stopServerTaskPolling() {
    if (serverPollTimer.value) clearInterval(serverPollTimer.value)
    serverPollTimer.value = null
  }

  async function importServerTaskResult(serverTask) {
    if (isServerTaskImported(serverTask.id)) {
      ui.toast('该任务已导入过，请勿重复导入', 'info')
      serverTasks.value = serverTasks.value.filter((st) => st.id !== serverTask.id)
      return null
    }
    const questions = normalizeQuestions((serverTask.result && Array.isArray(serverTask.result.questions)) ? serverTask.result.questions : [])
    if (questions.length === 0) { ui.toast('该任务没有可导入的题目', 'err'); return }
    if (!data.state.chapters[serverTask.chapterId]) { ui.toast('章节已删除，无法导入', 'err'); return }
    const set = data.createQuizSetForChapter(questions, serverTask.chapterId)
    markServerTaskImported(serverTask.id)
    data.saveState()
    // 保留在列表中并显示"已导入"（出题历史可查）
    ui.toast('已导入 ' + questions.length + ' 题', 'ok')
    return set
  }

  async function cancelServerTask(taskId) {
    try {
      await cancelAiServerTask(taskId)
      await refreshServerTasks()
      ui.toast('已取消服务端任务', 'info')
    } catch (e) {
      ui.toast(e.message, 'err')
    }
  }

  function openQueueDialog() {
    queueDialogOpen.value = true
    refreshServerTasks()
    startServerTaskPolling()
  }

  function closeQueueDialog() {
    queueDialogOpen.value = false
    if (!hasActiveServerTasks()) stopServerTaskPolling()
  }

  return {
    serverTasks, serverTasksLoading, serverPollTimer, queueDialogOpen,
    refreshServerTasks, markServerTaskImported, reconcileServerTasks, isServerTaskImported,
    hasActiveServerTasks, pollServerTasksOnce, startServerTaskPolling, stopServerTaskPolling,
    importServerTaskResult, cancelServerTask, openQueueDialog, closeQueueDialog,
  }
}
