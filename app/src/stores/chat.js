// ============================================================
// chat store — 聊天/好友系统（自 legacy chat.js 迁移）
// 状态：roomsCache/friends/requests/activeTab/openRoomId/轮询/未读
// 轮询 /chat/updates（15s，关闭弹窗即停）；分享车 quiz cart。
// ============================================================
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useUserStore } from './user'
import { useUiStore } from './ui'
import { fetchWithAuth } from '../services/api'
import * as chatApi from '../services/chatApi'
import { resolveMediaUrl } from '../services/utils'

const POLL_INTERVAL = 15000

let pollTimer = null
let pollBackoff = 0

export const useChatStore = defineStore('chat', () => {
  const user = useUserStore()
  const ui = useUiStore()

  // —— 状态 ——
  const modalOpen = ref(false)
  const roomsCache = ref([])
  const friends = ref([])
  const requests = ref([])
  const activeTab = ref('rooms') // rooms | friends | requests
  const openRoomId = ref(null)
  const messages = ref([])
  const totalUnread = ref(0)
  const pendingRequests = ref(0)
  const polling = ref(false)
  const searchQuery = ref('')
  const isMobileShowingRoom = ref(false)
  const sending = ref(false)
  const quizCart = ref([]) // [{ question, path, flatIdx, qIndex }]
  const selectedMemberIds = ref([]) // 群聊/邀请选人
  const sharePickerOpen = ref(false)

  // —— 工具（同 legacy chatGetRoomName / chatFormatTime）——
  function getRoomName(room) {
    if (!room) return '聊天'
    if (room.type === 'group') return room.name || '群聊'
    const members = room.members || []
    const other = members.find((m) => m.id !== user.userId)
    return other ? (other.display_name || other.username) : '聊天'
  }

  // 消息时间：今天 HH:mm，昨天，否则 MM-DD
  function formatTime(isoStr) {
    if (!isoStr) return ''
    try {
      const d = new Date(isoStr)
      if (isNaN(d.getTime())) return ''
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const startOfMsgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      const diffDays = Math.round((startOfToday - startOfMsgDay) / 86400000)
      if (diffDays === 0) return hm
      if (diffDays === 1) return '昨天'
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    } catch (e) { return '' }
  }

  function lastMsgPreview(room) {
    const m = room.last_message || null
    if (!m) return ''
    if (m.msg_type === 'image') return '[图片]'
    if (m.msg_type === 'file') return '[文件]'
    if (m.msg_type === 'quiz_share' || m.msg_type === 'bank_share') return '[分享题目]'
    return (m.content || '').substring(0, 30)
  }

  // —— 渲染数据准备（computed 供组件用）——
  const roomList = computed(() => {
    const q = searchQuery.value.trim().toLowerCase()
    return roomsCache.value
      .filter((room) => !q || getRoomName(room).toLowerCase().indexOf(q) !== -1)
      .map((room) => {
        const name = getRoomName(room)
        let otherAvatar = null
        if (room.type === 'direct') {
          const other = (room.members || []).find((m) => m.id !== user.userId)
          if (other && other.avatar_url) otherAvatar = other.avatar_url
        }
        return {
          ...room,
          name,
          initial: name.charAt(0).toUpperCase(),
          otherAvatar,
          otherAvatarSrc: resolveMediaUrl(otherAvatar),
          preview: lastMsgPreview(room),
          time: formatTime(room.last_message ? room.last_message.created_at : ''),
          unread: parseInt(room.unread_count) || 0,
          active: openRoomId.value === room.id
        }
      })
  })

  const friendList = computed(() => {
    const q = searchQuery.value.trim().toLowerCase()
    return friends.value
      .filter((f) => !q || (f.display_name || f.username || '').toLowerCase().indexOf(q) !== -1)
      .map((f) => {
        const name = f.display_name || f.username
        const diff = f.last_seen_at ? (Date.now() - new Date(f.last_seen_at).getTime()) : Infinity
        return {
          ...f,
          name,
          initial: (name || '?').charAt(0).toUpperCase(),
          avatarSrc: resolveMediaUrl(f.avatar_url),
          online: diff < 5 * 60 * 1000
        }
      })
  })

  const requestList = computed(() => {
    return requests.value.map((r) => ({
      ...r,
      name: r.display_name || r.username,
      initial: (r.display_name || r.username || '?').charAt(0).toUpperCase(),
      avatarSrc: resolveMediaUrl(r.avatar_url)
    }))
  })

  const currentRoom = computed(() => {
    if (!openRoomId.value) return null
    return roomsCache.value.find((r) => r.id === openRoomId.value) || null
  })

  const headerStatus = computed(() => {
    const room = currentRoom.value
    if (!room) return ''
    if (room.type === 'group') return (room.members || []).length + ' 人'
    const other = (room.members || []).find((m) => m.id !== user.userId)
    if (other && other.last_seen_at) {
      const diff = Date.now() - new Date(other.last_seen_at).getTime()
      return diff < 5 * 60 * 1000 ? '在线' : '离线'
    }
    return ''
  })

  const canShareQuiz = computed(() => {
    const room = currentRoom.value
    return !!(room && (room.type === 'direct' || room.type === 'group'))
  })

  // —— 加载 ——
  async function loadRooms() {
    if (!user.isOnline) return
    try { roomsCache.value = await chatApi.getRooms() }
    catch (e) { console.warn('[chat] loadRooms failed:', e) }
  }

  async function loadFriends() {
    if (!user.isOnline) return
    try { friends.value = await chatApi.getFriends() }
    catch (e) { console.warn('[chat] loadFriends failed:', e) }
  }

  async function loadRequests() {
    if (!user.isOnline) return
    try {
      requests.value = await chatApi.getFriendRequests()
      pendingRequests.value = requests.value.length
    } catch (e) { console.warn('[chat] loadRequests failed:', e) }
  }

  // —— 轮询 ——
  function schedulePoll(interval) {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(poll, interval)
  }

  async function poll() {
    if (!user.isOnline || !user.token) return null
    try {
      const res = await fetchWithAuth('/chat/updates')
      if (res && res.status === 429) {
        pollBackoff = Math.min((pollBackoff || 5000) * 2, 60000)
        schedulePoll(POLL_INTERVAL + pollBackoff)
        console.warn('[chat] poll 429 rate limited, backoff ' + (POLL_INTERVAL + pollBackoff) + 'ms')
        return null
      }
      if (res && res.ok) {
        pollBackoff = Math.max(0, pollBackoff - 1000)
        const data = await res.json()
        handlePollResult(data)
        return data
      } else if (res && !res.ok) {
        console.warn('[chat] poll non-ok:', res.status, res.statusText || '')
      }
    } catch (e) {
      console.error('[chat] poll error:', e.message || e)
    }
    return null
  }

  function handlePollResult(data) {
    if (!data) return
    totalUnread.value = data.totalUnread || 0
    pendingRequests.value = data.pendingRequests || 0
    const updatedRoomIds = data.updatedRoomIds || []
    const updatedSet = {}
    updatedRoomIds.forEach((id) => { updatedSet[id] = true })
    if (openRoomId.value && updatedSet[openRoomId.value]) {
      loadMessages(openRoomId.value, true)
    }
    if (updatedRoomIds.length > 0 && modalOpen.value) {
      loadRooms()
    }
  }

  function startPolling() {
    stopPolling()
    pollBackoff = 0
    polling.value = true
    pollTimer = setInterval(poll, POLL_INTERVAL)
    poll()
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    pollBackoff = 0
    polling.value = false
  }

  // —— 弹窗 / 标签 ——
  function openChatModal() {
    if (!user.isOnline || !user.user) {
      ui.toast('请先登录', 'info')
      return
    }
    modalOpen.value = true
    openRoomId.value = null
    isMobileShowingRoom.value = false
    activeTab.value = 'rooms'
    searchQuery.value = ''
    loadRooms()
    loadFriends()
    loadRequests()
    startPolling()
  }

  function closeChatModal() {
    modalOpen.value = false
    openRoomId.value = null
    isMobileShowingRoom.value = false
    stopPolling()
  }

  function switchTab(tab) {
    activeTab.value = tab
    openRoomId.value = null
    isMobileShowingRoom.value = false
    if (tab === 'rooms') loadRooms()
    else if (tab === 'friends') loadFriends()
    else if (tab === 'requests') loadRequests()
  }

  function backToList() {
    openRoomId.value = null
    isMobileShowingRoom.value = false
    loadRooms()
  }

  // —— 打开会话 / 消息 ——
  async function openRoom(roomId) {
    openRoomId.value = roomId
    isMobileShowingRoom.value = true
    messages.value = [] // 清空旧会话消息，避免串台
    await loadMessages(roomId, false)
    poll()
    try {
      await chatApi.markRead(roomId)
      const upd = await chatApi.getUpdates()
      totalUnread.value = upd.totalUnread || 0
      pendingRequests.value = upd.pendingRequests || 0
      loadRooms()
    } catch (e) { /* ignore */ }
  }

  // loadMessages(roomId, refresh)：refresh=false 全量重建；true 增量追加/就地替换（语义同 legacy isPollingRefresh）
  async function loadMessages(roomId, refresh = false) {
    if (!roomId) return
    try {
      const list = await chatApi.getMessages(roomId)
      if (!refresh) {
        messages.value = list
        return
      }
      const existingIds = new Set(messages.value.map((m) => m.id))
      for (const m of list) {
        if (!existingIds.has(m.id)) {
          messages.value.push(m)
          existingIds.add(m.id)
        } else {
          const idx = messages.value.findIndex((x) => x.id === m.id)
          if (idx === -1) continue
          const old = messages.value[idx]
          const wasAnswered = !!(old.quiz_data && old.quiz_data._result && old.quiz_data._result.answered)
          const nowAnswered = !!(m.quiz_data && m.quiz_data._result && m.quiz_data._result.answered)
          if (m.is_revoked || (nowAnswered && !wasAnswered)) {
            messages.value.splice(idx, 1, m)
          } else {
            messages.value[idx] = m
          }
        }
      }
    } catch (e) {
      console.error('[chat] loadMessages error:', e.message || e)
    }
  }

  // —— 发送（乐观 append + 服务端回执后全量刷新）——
  async function sendMessage({ roomId, content = '', images = [], fileInfo = null, msgType = 'text', quizData = null, replyTo = null }) {
    if (!roomId) return null
    const myId = user.userId
    const tempId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
    const optimistic = {
      id: tempId,
      _local: true,
      user_id: myId,
      sender_name: (user.user && (user.user.displayName || user.user.username)) || '',
      content: content || '',
      msg_type: msgType,
      images: images || [],
      file_info: fileInfo,
      quiz_data: quizData,
      reply_to: replyTo || null,
      created_at: new Date().toISOString(),
      is_revoked: false
    }
    messages.value.push(optimistic)
    sending.value = true
    try {
      await chatApi.sendMessage(roomId, {
        content, msg_type: msgType, images, file_info: fileInfo, quiz_data: quizData, reply_to: replyTo
      })
      await loadMessages(roomId, false)
      loadRooms()
      markRead(roomId).catch(() => {})
      return true
    } catch (e) {
      const idx = messages.value.findIndex((m) => m.id === tempId)
      if (idx !== -1) messages.value.splice(idx, 1)
      ui.toast('发送失败: ' + (e.message || '请重试'), 'err')
      return false
    } finally {
      sending.value = false
    }
  }

  async function uploadFile(file) {
    return chatApi.uploadFile(file)
  }

  // —— 好友 ——
  async function sendFriendRequest(friendId, message = '') {
    try {
      const data = await chatApi.sendFriendRequest(friendId, message)
      if (data.accepted) {
        ui.toast('已添加为好友（对方已向你发送过申请）', 'ok')
        loadFriends(); loadRooms()
      } else {
        ui.toast('好友申请已发送', 'ok')
      }
      return data
    } catch (e) {
      ui.toast('发送失败: ' + (e.message || '请重试'), 'err')
      return null
    }
  }

  async function acceptRequest(requestId) {
    try {
      await chatApi.acceptFriendRequest(requestId)
      ui.toast('已添加为好友', 'ok')
      loadRequests(); loadFriends(); loadRooms()
    } catch (e) { ui.toast('操作失败: ' + (e.message || '请重试'), 'err') }
  }

  async function rejectRequest(requestId) {
    try {
      await chatApi.rejectFriendRequest(requestId)
      loadRequests()
    } catch (e) { ui.toast('操作失败: ' + (e.message || '请重试'), 'err') }
  }

  async function deleteFriend(friendId, friendName) {
    const ok = await ui.openConfirm('删除好友', '确定删除好友「' + (friendName || friendId) + '」？聊天记录将被移除，且无法恢复。', '删除', { danger: true })
    if (!ok) return
    try {
      await chatApi.deleteFriend(friendId)
      ui.toast('已删除好友', 'ok')
      loadFriends(); loadRooms()
    } catch (e) { ui.toast('删除失败: ' + (e.message || '请重试'), 'err') }
  }

  async function searchUsers(q) {
    const query = (q || '').trim()
    if (!query) return []
    try { return await chatApi.searchUsers(query) }
    catch (e) { console.warn('[chat] searchUsers failed:', e); return [] }
  }

  // —— 会话管理 ——
  async function createDirectRoom(friendId) {
    try {
      const data = await chatApi.createDirectRoom(friendId)
      activeTab.value = 'rooms'
      await loadRooms()
      await openRoom(data.roomId)
      return data
    } catch (e) { ui.toast('创建会话失败: ' + (e.message || '请重试'), 'err'); return null }
  }

  async function createGroupRoom(name, memberIds) {
    if (!memberIds || memberIds.length === 0) {
      ui.toast('请至少选择一位好友', 'err')
      return null
    }
    try {
      const data = await chatApi.createGroupRoom(name || '群聊', memberIds)
      ui.toast('群聊已创建', 'ok')
      activeTab.value = 'rooms'
      await loadRooms()
      await openRoom(data.roomId)
      return data
    } catch (e) { ui.toast('创建失败: ' + (e.message || '请重试'), 'err'); return null }
  }

  async function addMembers(roomId, userIds) {
    if (!userIds || userIds.length === 0) {
      ui.toast('请至少选择一位好友', 'err')
      return
    }
    try {
      await chatApi.addMembers(roomId, userIds)
      ui.toast('已邀请', 'ok')
      if (openRoomId.value) loadMessages(openRoomId.value, false)
    } catch (e) { ui.toast('邀请失败: ' + (e.message || '请重试'), 'err') }
  }

  async function leaveRoom(roomId) {
    const ok = await ui.openConfirm('退出群聊', '确定退出群聊？', '退出')
    if (!ok) return
    try {
      await chatApi.leaveRoom(roomId)
      backToList()
      loadRooms()
    } catch (e) { ui.toast('退出失败: ' + (e.message || '请重试'), 'err') }
  }

  // —— 撤回 / 作答 ——
  async function revokeMessage(msgId) {
    const ok = await ui.openConfirm('撤回消息', '确定撤回此消息？', '撤回')
    if (!ok) return
    try {
      await chatApi.revokeMessage(msgId)
      if (openRoomId.value) await loadMessages(openRoomId.value, true)
    } catch (e) { ui.toast('撤回失败: ' + (e.message || '请重试'), 'err') }
  }

  async function updateQuizMessage(msgId, quizData) {
    try {
      await chatApi.updateQuizMessage(msgId, quizData)
      if (openRoomId.value) await loadMessages(openRoomId.value, true)
      return true
    } catch (e) {
      ui.toast('提交失败: ' + (e.message || '请重试'), 'err')
      return false
    }
  }

  function findMessage(msgId) {
    return messages.value.find((m) => m.id === msgId) || null
  }

  async function answerSharedQuiz(msgId, optionIndex) {
    const msg = findMessage(msgId)
    if (!msg) return
    const quizData = msg.quiz_data || {}
    const question = (quizData.questions || [])[0]
    if (!question) return

    const labels = ['A', 'B', 'C', 'D', 'E', 'F']
    const rawAnswer = (question.answer !== undefined && question.answer !== null && question.answer !== '') ? question.answer : ''
    let correctIdx = -1
    if (rawAnswer !== '') {
      correctIdx = labels.indexOf(String(rawAnswer).toUpperCase())
      if (correctIdx === -1) {
        const n = Number(rawAnswer)
        if (!isNaN(n) && n >= 0 && n < labels.length) correctIdx = n
      }
    }

    let chosenAnswer = ''
    let correct = false
    if (question.type === 'single') {
      chosenAnswer = labels[optionIndex] || String(optionIndex)
      correct = (optionIndex === correctIdx)
    } else if (question.type === 'judge') {
      chosenAnswer = optionIndex === 0 ? '正确' : '错误'
      correct = (optionIndex === correctIdx)
    }

    const correctAnswerIdx = correctIdx
    const correctAnswerText = question.options && correctAnswerIdx >= 0
      ? question.options[correctAnswerIdx]
      : (question.type === 'judge' ? (correctAnswerIdx === 0 ? '正确' : '错误') : String(question.answer || ''))
    const chosenAnswerIdx = optionIndex
    const chosenAnswerText = question.options ? question.options[optionIndex] : chosenAnswer

    const newQuizData = {
      ...quizData,
      _result: {
        answered: true,
        correct,
        chosenAnswer,
        chosenAnswerIdx,
        chosenAnswerText,
        correctAnswerIdx,
        correctAnswerText,
        answeredBy: (user.user && (user.user.displayName || user.user.username)) || ''
      }
    }

    const ok = await updateQuizMessage(msgId, newQuizData)
    if (!ok) {
      // 兜底：端点不存在时发系统消息（语义同 legacy）
      const labels2 = ['A', 'B', 'C', 'D', 'E', 'F']
      const fbCorrect = correctAnswerIdx >= 0 ? labels2[correctAnswerIdx] : ''
      const fbYour = chosenAnswerIdx >= 0 ? labels2[chosenAnswerIdx] : ''
      const resultText = (correct ? '✅ 回答正确！' : '❌ 回答错误') +
        '\n作答人：' + ((user.user && (user.user.displayName || user.user.username)) || '') +
        '\n你的答案：' + fbYour + '. ' + (chosenAnswerText || '') +
        '\n标准答案：' + fbCorrect + '. ' + (correctAnswerText || '')
      try { await chatApi.sendMessage(openRoomId.value, { content: resultText, msg_type: 'text' }) } catch (e2) { /* ignore */ }
    }
  }

  async function answerSharedQuizText(msgId, text) {
    const userAnswer = (text || '').trim()
    if (!userAnswer) return
    const msg = findMessage(msgId)
    if (!msg) return
    const quizData = msg.quiz_data || {}
    const question = (quizData.questions || [])[0]
    if (!question) return

    const newQuizData = {
      ...quizData,
      _result: {
        answered: true,
        correct: true,
        chosenAnswer: userAnswer,
        chosenAnswerIdx: -1,
        chosenAnswerText: userAnswer,
        correctAnswerIdx: -1,
        correctAnswerText: question.answer || '',
        answeredBy: (user.user && (user.user.displayName || user.user.username)) || ''
      }
    }
    await updateQuizMessage(msgId, newQuizData)
  }

  // —— 分享车（quiz cart）——
  function addToQuizCart(item) {
    if (!item) return
    const exists = quizCart.value.some((c) => c.flatIdx === item.flatIdx)
    if (exists) {
      ui.toast('该题已在分享车中', 'info')
      return
    }
    quizCart.value.push({ question: item.question, path: item.path, flatIdx: item.flatIdx, qIndex: item.qIndex })
    ui.toast('已加入分享车 (' + quizCart.value.length + '题)', 'ok')
  }

  function removeFromQuizCart(index) {
    quizCart.value.splice(index, 1)
  }

  function clearQuizCart() {
    quizCart.value = []
  }

  // 一键分享：每道题走 sendMessage(msgType='quiz_share')
  async function shareQuizCart() {
    if (quizCart.value.length === 0) return
    if (!openRoomId.value) {
      ui.toast('请先打开一个对话', 'info')
      return
    }
    const items = quizCart.value.slice()
    let allOk = true
    for (const item of items) {
      const quizData = {
        questions: [item.question],
        setName: (item.question.question || '').substring(0, 30),
        chapterName: '',
        fromUserName: (user.user && (user.user.displayName || user.user.username)) || '',
        fromUserId: user.userId
      }
      const ok = await sendMessage({ roomId: openRoomId.value, content: '', msgType: 'quiz_share', quizData })
      if (!ok) allOk = false
    }
    if (allOk) quizCart.value = []
  }

  async function markRead(roomId) {
    try { await chatApi.markRead(roomId) } catch (e) { /* ignore */ }
  }

  // —— 分享题选择器 ——
  function openSharePicker() {
    if (!canShareQuiz.value) return
    sharePickerOpen.value = true
  }

  function closeSharePicker() {
    sharePickerOpen.value = false
  }

  function toggleSelectedMember(id) {
    const idx = selectedMemberIds.value.indexOf(id)
    if (idx === -1) selectedMemberIds.value.push(id)
    else selectedMemberIds.value.splice(idx, 1)
  }

  function clearSelectedMembers() {
    selectedMemberIds.value = []
  }

  return {
    // state
    modalOpen, roomsCache, friends, requests, activeTab, openRoomId, messages,
    totalUnread, pendingRequests, polling, searchQuery, isMobileShowingRoom,
    sending, quizCart, selectedMemberIds, sharePickerOpen,
    // computed
    roomList, friendList, requestList, currentRoom, headerStatus, canShareQuiz,
    // utils
    getRoomName, formatTime, lastMsgPreview,
    // actions
    openChatModal, closeChatModal, switchTab, backToList,
    loadRooms, loadFriends, loadRequests,
    openRoom, loadMessages, sendMessage, uploadFile,
    sendFriendRequest, acceptRequest, rejectRequest, deleteFriend, searchUsers,
    createDirectRoom, createGroupRoom, addMembers, leaveRoom,
    revokeMessage, updateQuizMessage, answerSharedQuiz, answerSharedQuizText,
    addToQuizCart, removeFromQuizCart, clearQuizCart, shareQuizCart,
    poll, startPolling, stopPolling, markRead,
    openSharePicker, closeSharePicker, toggleSelectedMember, clearSelectedMembers
  }
})
