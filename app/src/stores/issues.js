// ============================================================
// issues.js — Issue/反馈 store（自 legacy feedback.js 迁移）
// 语义保留：状态机、轮询、分组排序、图片上传、状态流转、admin 删除。
// ============================================================
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useUserStore } from './user'
import {
  createIssue, getIssues, getIssueUpdates, getIssue, renameIssue,
  sendIssueMessage, updateIssueStatus, deleteIssue, getAdminIssues, uploadIssueImage
} from '../services/issuesApi'

const POLL_INTERVAL = 30000

export const useIssuesStore = defineStore('issues', () => {
  const user = useUserStore()

  const issues = ref([])        // 我的工单列表
  const adminIssues = ref([])   // 管理员工单列表
  const unreadCount = ref(0)    // 未读徽章计数
  const openIssueId = ref(null)
  const openIssue = ref(null)
  const detailLoading = ref(false)
  const detailError = ref('')
  const detailInputFocused = ref(false) // 详情输入框聚焦时跳过轮询刷新
  const pendingImages = ref([]) // 待发送图片 { url, name, size }
  const panelOpen = ref(false)

  let pollTimer = null

  const isAdmin = computed(() => user.isAdmin())

  // 用户端分组：active 按 updated_at 降序
  const userGroups = computed(() => {
    const active = issues.value.filter(i => i.status === 'unread' || i.status === 'read')
    const resolved = issues.value.filter(i => i.status === 'resolved')
    const closed = issues.value.filter(i => i.status === 'closed')
    active.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    return { active, resolved, closed }
  })

  // 管理员分组：active 按 updated_at 升序（最新消息在最下方，离气泡最近）
  const adminGroups = computed(() => {
    const active = adminIssues.value.filter(i => i.status === 'unread' || i.status === 'read')
    const resolved = adminIssues.value.filter(i => i.status === 'resolved')
    const closed = adminIssues.value.filter(i => i.status === 'closed')
    active.sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))
    return { active, resolved, closed }
  })

  function hasNew(issue) {
    return isAdmin.value ? issue.has_new_for_admin : issue.has_new_for_user
  }

  async function loadUserIssues() {
    try { issues.value = await getIssues() } catch (e) { /* 静默，同 legacy */ }
  }

  async function loadAdminIssues() {
    try { adminIssues.value = await getAdminIssues() } catch (e) { /* 静默 */ }
  }

  async function refreshList() {
    if (isAdmin.value) await loadAdminIssues()
    else await loadUserIssues()
  }

  // —— 新建工单 ——
  async function submitIssue(raw) {
    const content = (raw || '').trim()
    if (!content) return
    const lines = content.split('\n')
    let title = lines[0].substring(0, 80)
    if (lines.length > 1 || content.length > 80) title += '...'
    await createIssue(title, content)
    await loadUserIssues()
    return true
  }

  // —— 打开详情 ——
  async function openDetail(id) {
    openIssueId.value = id
    detailLoading.value = true
    detailError.value = ''
    openIssue.value = null
    pendingImages.value = []
    try {
      let issue = await getIssue(id)
      // admin 打开未读工单时自动流转为已读（backend GET 仅清 has_new_for_admin）
      if (isAdmin.value && issue.status === 'unread') {
        try { await updateIssueStatus(id, 'read') } catch (e) { /* 忽略，按钮仍可手动流转 */ }
        issue = await getIssue(id)
      }
      openIssue.value = issue
      refreshList()
    } catch (e) {
      detailError.value = e.message || '加载失败'
    } finally {
      detailLoading.value = false
    }
  }

  function closeDetail() {
    openIssueId.value = null
    openIssue.value = null
    detailError.value = ''
    pendingImages.value = []
    detailInputFocused.value = false
  }

  async function refreshDetail(id) {
    if (detailInputFocused.value) return
    try {
      openIssue.value = await getIssue(id)
    } catch (e) { /* 静默 */ }
  }

  // —— 消息 ——
  async function sendMessage(content) {
    const id = openIssueId.value
    if (!id) return
    if (!content && pendingImages.value.length === 0) return
    const images = pendingImages.value.map(img => img.url)
    pendingImages.value = []
    await sendIssueMessage(id, content, images)
    await refreshDetail(id)
    refreshList()
  }

  async function uploadImage(file, filename) {
    const data = await uploadIssueImage(file, filename)
    pendingImages.value.push(data)
    return data
  }

  function removePendingImage(url) {
    pendingImages.value = pendingImages.value.filter(img => img.url !== url)
  }

  // —— 标题重命名 ——
  async function rename(id, title) {
    await renameIssue(id, title)
    refreshList()
  }

  // —— 删除（admin） ——
  async function remove(id) {
    await deleteIssue(id)
    if (openIssueId.value === id) closeDetail()
    refreshList()
  }

  // —— 状态流转 ——
  async function changeStatus(id, status, reason) {
    await updateIssueStatus(id, status, reason)
    if (openIssueId.value === id && status !== 'closed') {
      await refreshDetail(id)
    }
    refreshList()
  }

  async function markFixed(id) {
    await changeStatus(id, 'closed')
    closeDetail()
  }

  async function markNotFixed(id, reason) {
    await changeStatus(id, 'unread', reason)
  }

  // —— 轮询 ——
  function startPolling() {
    stopPolling()
    poll()
    pollTimer = setInterval(poll, POLL_INTERVAL)
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }

  async function poll() {
    if (!user.isOnline) return
    try {
      const data = await getIssueUpdates()
      handlePollResult(data)
    } catch (e) { /* 静默 */ }
  }

  function handlePollResult(data) {
    if (isAdmin.value && data.admin) {
      unreadCount.value = data.admin.unreadCount || 0
      if (openIssueId.value && data.admin.updatedIssues && data.admin.updatedIssues.indexOf(openIssueId.value) !== -1) {
        refreshDetail(openIssueId.value)
      }
    }
    if (!isAdmin.value && data.user) {
      unreadCount.value = data.user.unreadCount || 0
      if (openIssueId.value && data.user.updatedIssues && data.user.updatedIssues.indexOf(openIssueId.value) !== -1) {
        refreshDetail(openIssueId.value)
      }
    }
  }

  // —— 面板开关（启停轮询 + 打开刷新） ——
  function openPanel() {
    panelOpen.value = true
    refreshList()
    startPolling()
  }

  function closePanel() {
    panelOpen.value = false
    stopPolling()
  }

  // 一次性刷新未读计数（气泡挂载/登录后播种徽章）
  async function refreshUnread() {
    await poll()
  }

  return {
    issues, adminIssues, unreadCount, openIssueId, openIssue, detailLoading, detailError,
    detailInputFocused, pendingImages, panelOpen,
    isAdmin, userGroups, adminGroups, hasNew,
    loadUserIssues, loadAdminIssues, refreshList, submitIssue,
    openDetail, closeDetail, refreshDetail, sendMessage, uploadImage, removePendingImage,
    rename, remove, changeStatus, markFixed, markNotFixed,
    startPolling, stopPolling, poll, refreshUnread, openPanel, closePanel
  }
})
