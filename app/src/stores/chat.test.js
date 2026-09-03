// P1.4 chat store 核心流转单测（审计第五节「全部 store 手工未测」收口）
// 纯状态流转：mock chatApi，user/ui 用真实 store + 内存 localStorage。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/chatApi', () => ({
  getRooms: vi.fn(async () => []),
  getFriends: vi.fn(async () => []),
  getFriendRequests: vi.fn(async () => []),
  getMessages: vi.fn(async () => []),
  sendMessage: vi.fn(async () => ({ ok: true })),
  updateQuizMessage: vi.fn(async () => true),
  markRead: vi.fn(async () => ({})),
  getUpdates: vi.fn(async () => ({ totalUnread: 0, pendingRequests: 0 })),
  uploadFile: vi.fn(),
  searchUsers: vi.fn(async () => []),
  createDirectRoom: vi.fn(async () => ({ roomId: 'r' })),
  createGroupRoom: vi.fn(async () => ({ roomId: 'r' })),
  addMembers: vi.fn(async () => ({})),
  leaveRoom: vi.fn(async () => ({})),
  revokeMessage: vi.fn(async () => ({})),
  sendFriendRequest: vi.fn(async () => ({ accepted: false })),
  acceptFriendRequest: vi.fn(async () => ({})),
  rejectFriendRequest: vi.fn(async () => ({})),
  deleteFriend: vi.fn(async () => ({})),
}))

import { useChatStore } from './chat'
import { useUiStore } from './ui'
import * as chatApi from '../services/chatApi'

function makeLocalStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

describe('chat store 核心流转 (P1.4)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({
      qbao_token: 'tok',
      qbao_user: JSON.stringify({ id: 'u1', username: 'alice', displayName: 'Alice' }),
    })
    globalThis.localStorage = storage
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => { delete globalThis.localStorage })

  function setup() {
    return { chat: useChatStore(), ui: useUiStore() }
  }

  it('roomList：搜索过滤 + 名称/预览/未读数派生', () => {
    const { chat } = setup()
    chat.roomsCache = [
      {
        id: 'r1', type: 'direct',
        members: [{ id: 'u1' }, { id: 'u2', display_name: 'Bob' }],
        last_message: { content: 'hello world', created_at: new Date().toISOString() },
        unread_count: 2,
      },
      { id: 'r2', type: 'group', name: '考研群', members: [{ id: 'u1' }, { id: 'u2' }], last_message: null, unread_count: 0 },
    ]
    expect(chat.roomList).toHaveLength(2)
    expect(chat.roomList[0].name).toBe('Bob')
    expect(chat.roomList[0].preview).toBe('hello world')
    expect(chat.roomList[0].unread).toBe(2)
    expect(chat.roomList[0].initial).toBe('B')
    expect(chat.roomList[1].name).toBe('考研群')
    expect(chat.roomList[1].preview).toBe('')
    // 搜索命中单聊（对方名含 bob）
    chat.searchQuery = 'bob'
    expect(chat.roomList).toHaveLength(1)
    expect(chat.roomList[0].id).toBe('r1')
    chat.searchQuery = ''
    expect(chat.roomList).toHaveLength(2)
  })

  it('lastMsgPreview：图片/文件/分享题/文本摘要', () => {
    const { chat } = setup()
    expect(chat.lastMsgPreview({ last_message: { msg_type: 'image' } })).toBe('[图片]')
    expect(chat.lastMsgPreview({ last_message: { msg_type: 'file' } })).toBe('[文件]')
    expect(chat.lastMsgPreview({ last_message: { msg_type: 'quiz_share' } })).toBe('[分享题目]')
    expect(chat.lastMsgPreview({ last_message: { msg_type: 'bank_share' } })).toBe('[分享题目]')
    expect(chat.lastMsgPreview({ last_message: { msg_type: 'text', content: '一段很长的消息内容' } })).toBe('一段很长的消息内容')
    expect(chat.lastMsgPreview({ last_message: null })).toBe('')
  })

  it('formatTime：今天 HH:mm、昨天、更早 MM-DD、非法值空串', () => {
    const { chat } = setup()
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    expect(chat.formatTime(now.toISOString())).toBe(pad(now.getHours()) + ':' + pad(now.getMinutes()))
    const yesterday = new Date(now.getTime() - 86400000)
    expect(chat.formatTime(yesterday.toISOString())).toBe('昨天')
    const older = new Date(now.getTime() - 5 * 86400000)
    expect(chat.formatTime(older.toISOString())).toBe(pad(older.getMonth() + 1) + '-' + pad(older.getDate()))
    expect(chat.formatTime('')).toBe('')
    expect(chat.formatTime('bad-date')).toBe('')
  })

  it('loadMessages(refresh) 增量合并：按 id 去重、新消息追加、变化消息就地替换', async () => {
    const { chat } = setup()
    chat.messages = [
      { id: 1, content: '旧消息', is_revoked: false, quiz_data: null },
      { id: 2, content: '待更新', is_revoked: false, quiz_data: {} },
    ]
    chatApi.getMessages.mockResolvedValueOnce([
      { id: 1, content: '旧消息', is_revoked: false, quiz_data: null },
      { id: 2, content: '已更新', is_revoked: false, quiz_data: { _result: { answered: true, correct: true } } },
      { id: 3, content: '新消息', is_revoked: false },
    ])
    await chat.loadMessages('r1', true)
    expect(chat.messages.map((m) => m.id)).toEqual([1, 2, 3])
    expect(chat.messages.find((m) => m.id === 2).content).toBe('已更新')
    expect(chat.messages.find((m) => m.id === 1).content).toBe('旧消息')
    expect(chat.messages.find((m) => m.id === 3).content).toBe('新消息')
  })

  it('loadMessages 全量重建（refresh=false）：清空旧会话不串台', async () => {
    const { chat } = setup()
    chat.messages = [{ id: 1, content: '上个会话' }]
    chatApi.getMessages.mockResolvedValueOnce([{ id: 9, content: '本会话' }])
    await chat.loadMessages('r9', false)
    expect(chat.messages).toHaveLength(1)
    expect(chat.messages[0].id).toBe(9)
  })

  it('answerSharedQuiz：单选正确判定并构造 _result（作答人署名）', async () => {
    const { chat } = setup()
    chat.messages = [{
      id: 'm1',
      quiz_data: { questions: [{ question: '1+1=?', type: 'single', options: ['1', '2', '3'], answer: 1 }] },
    }]
    chat.openRoomId = 'r1'
    await chat.answerSharedQuiz('m1', 1)
    expect(chatApi.updateQuizMessage).toHaveBeenCalledTimes(1)
    const [msgId, quizData] = chatApi.updateQuizMessage.mock.calls[0]
    expect(msgId).toBe('m1')
    expect(quizData._result).toMatchObject({
      answered: true, correct: true, chosenAnswer: 'B',
      correctAnswerIdx: 1, correctAnswerText: '2',
      chosenAnswerText: '2', answeredBy: 'Alice',
    })
  })

  it('answerSharedQuiz：答错与判断题文本语义', async () => {
    const { chat } = setup()
    chat.messages = [{
      id: 'm1',
      quiz_data: { questions: [{ question: '1+1=?', type: 'single', options: ['1', '2', '3'], answer: 1 }] },
    }]
    chat.openRoomId = 'r1'
    await chat.answerSharedQuiz('m1', 0)
    const quizData = chatApi.updateQuizMessage.mock.calls[0][1]
    expect(quizData._result.correct).toBe(false)
    expect(quizData._result.chosenAnswer).toBe('A')
    // 判断题：文本为 正确/错误
    chat.messages = [{
      id: 'm2',
      quiz_data: { questions: [{ question: '地球是圆的', type: 'judge', options: ['正确', '错误'], answer: 0 }] },
    }]
    await chat.answerSharedQuiz('m2', 1)
    const qd2 = chatApi.updateQuizMessage.mock.calls[1][1]
    expect(qd2._result.correct).toBe(false)
    expect(qd2._result.chosenAnswer).toBe('错误')
  })

  it('answerSharedQuizText：主观题作答视为正确并落库', async () => {
    const { chat } = setup()
    chat.messages = [{
      id: 'm3',
      quiz_data: { questions: [{ question: '简述原理', type: 'short', answer: '略' }] },
    }]
    chat.openRoomId = 'r1'
    await chat.answerSharedQuizText('m3', '我的简述')
    const [, quizData] = chatApi.updateQuizMessage.mock.calls[0]
    expect(quizData._result.correct).toBe(true)
    expect(quizData._result.chosenAnswer).toBe('我的简述')
    expect(quizData._result.correctAnswerText).toBe('略')
    // 空作答不发送
    await chat.answerSharedQuizText('m3', '   ')
    expect(chatApi.updateQuizMessage).toHaveBeenCalledTimes(1)
  })

  it('分享车：重复题目拒绝（toast 提示），移除/清空正常', () => {
    const { chat, ui } = setup()
    const item = { question: { id: 1, question: 'Q' }, path: 'p1', flatIdx: 7, qIndex: 0 }
    chat.addToQuizCart(item)
    chat.addToQuizCart({ ...item, flatIdx: 7 })
    expect(chat.quizCart).toHaveLength(1)
    expect(ui.toasts.some((t) => t.message.includes('已在分享车'))).toBe(true)
    chat.addToQuizCart({ question: { id: 2, question: 'Q2' }, path: 'p1', flatIdx: 8, qIndex: 1 })
    expect(chat.quizCart).toHaveLength(2)
    chat.removeFromQuizCart(0)
    expect(chat.quizCart.map((c) => c.flatIdx)).toEqual([8])
    chat.clearQuizCart()
    expect(chat.quizCart).toHaveLength(0)
  })
})
