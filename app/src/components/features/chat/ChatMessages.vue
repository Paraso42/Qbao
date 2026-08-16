<!-- 对应 legacy chat.js：chatRenderMessage/chatLoadMessages/chatScrollToBottom（扁平消息：头像+名称+无气泡内容，DeepSeek 风格） -->
<template>
  <div class="chat-messages" ref="container">
    <template v-for="m in prepared" :key="m.id">
      <!-- 撤回/系统消息 -->
      <div v-if="m.is_revoked" class="chat-msg-system">
        {{ m.isMine ? '你撤回了一条消息' : ((m.sender_name || '') + ' 撤回了一条消息') }}
      </div>
      <!-- 普通消息（扁平无气泡） -->
      <div v-else class="chat-msg" :class="m.isMine ? 'chat-msg-mine' : 'chat-msg-other'">
        <div class="chat-msg-avatar" :class="m.isMine ? 'mine' : 'other'">
          <img v-if="m.avatarUrl && !failedImgs[m.avatarUrl]" :src="m.avatarUrl" @error="imgError(m.avatarUrl)" />
          <span v-else>{{ m.initial }}</span>
        </div>
        <div class="chat-msg-body">
          <div class="chat-msg-meta">
            <span v-if="!m.isMine && m.sender_name" class="chat-msg-sender">{{ m.sender_name }}</span>
            <span class="chat-msg-time">{{ m.time }}</span>
          </div>

          <!-- 回复引用 -->
          <div v-if="m.reply_to && m.reply_to.userName" class="chat-msg-reply">
            回复 {{ m.reply_to.userName }}：{{ (m.reply_to.content || '').substring(0, 30) }}
          </div>

          <!-- 图片消息 -->
          <div v-if="m.msg_type === 'image'" class="chat-msg-content">
            <div class="chat-msg-image-wrap">
              <img
                v-for="(url, i) in (m.images || [])"
                :key="i"
                :src="url"
                class="chat-msg-image"
                loading="lazy"
                @click="previewImage(url)"
              />
            </div>
            <div v-if="m.content && m.content.trim()" class="chat-msg-text">{{ m.content }}</div>
          </div>
          <!-- 文件消息 -->
          <div v-else-if="m.msg_type === 'file'" class="chat-msg-content">
            <div class="chat-msg-file" @click="openFile((m.file_info || {}).url)">
              <span class="chat-msg-file-icon">📄</span>
              <div class="chat-msg-file-info">
                <div class="chat-msg-file-name">{{ (m.file_info || {}).name || '文件' }}</div>
                <div v-if="(m.file_info || {}).size" class="chat-msg-file-size">{{ formatFileSize((m.file_info || {}).size) }}</div>
              </div>
            </div>
            <div v-if="m.content && m.content.trim()" class="chat-msg-text">{{ m.content }}</div>
          </div>
          <!-- 题目分享 -->
          <div v-else-if="m.msg_type === 'quiz_share' || m.msg_type === 'bank_share'" class="chat-msg-content">
            <div class="chat-msg-quiz-share">
              <div class="chat-quiz-share-header">
                <span class="chat-quiz-share-icon">📝</span>
                <span class="chat-quiz-share-title">{{ m.typeName }}</span>
              </div>
              <div class="chat-quiz-share-from">来自：{{ (m.quiz_data || {}).fromUserName || '好友' }}</div>
              <div v-if="m.q && m.q.tag" class="chat-quiz-share-tag">🏷️ {{ m.q.tag }}</div>
              <div v-if="m.q" class="chat-quiz-share-question" v-html="renderMarkdown(m.q.question || '')"></div>

              <!-- 已作答结果（单选/判断） -->
              <div v-if="m.result && m.result.answered && m.q && (m.q.type === 'single' || m.q.type === 'judge')" class="chat-quiz-result" :class="m.result.correct ? 'correct' : 'wrong'">
                <div class="chat-quiz-result-head">{{ m.result.correct ? '✅ 回答正确！' : '❌ 回答错误' }}</div>
                <div class="chat-quiz-result-opts">
                  <div v-for="(opt, oi) in (m.q.options || [])" :key="oi" class="chat-quiz-result-opt" :class="resultOptionClass(m, oi)" v-html="resultLabels[oi] + '. ' + renderMarkdown(opt)"></div>
                </div>
                <div class="chat-quiz-result-answers">
                  <div class="answer-line">
                    <span :class="m.result.correct ? 'mark-ok' : 'mark-bad'">{{ m.result.correct ? '✓' : '✗' }}</span>
                    <b>你的答案：</b><span v-html="yourAnswerHtml(m)"></span>
                  </div>
                  <div class="answer-line">
                    <span class="mark-ok">✓</span>
                    <b>标准答案：</b><span v-html="standardAnswerHtml(m)"></span>
                  </div>
                </div>
                <div class="chat-quiz-result-meta">作答人：{{ m.result.answeredBy || '好友' }} · 来自：{{ (m.quiz_data || {}).fromUserName || '好友' }}</div>
                <div v-if="m.q.explanation" class="chat-quiz-result-explain" v-html="'📖 ' + renderMarkdown(m.q.explanation)"></div>
              </div>
              <!-- 已作答结果（主观题） -->
              <div v-else-if="m.result && m.result.answered" class="chat-quiz-result correct">
                <div class="chat-quiz-result-head">✅ 已作答（主观题）</div>
                <div class="answer-line"><b>你的答案：</b><span v-html="renderMarkdown(m.result.chosenAnswerText || m.result.chosenAnswer || '')"></span></div>
                <div v-if="m.result.correctAnswerText" class="answer-line"><b>参考答案：</b><span v-html="renderMarkdown(m.result.correctAnswerText)"></span></div>
              </div>
              <!-- 接收方：作答界面 -->
              <div v-else-if="!m.isMine" class="chat-quiz-answer">
                <div v-if="m.q && m.q.type === 'single' && (m.q.options || []).length > 0" class="chat-quiz-answer-opts">
                  <button v-for="(opt, oi) in m.q.options" :key="oi" class="chat-quiz-option-btn" :disabled="submitting[m.id]" @click="answerOption(m, oi)" v-html="resultLabels[oi] + '. ' + renderMarkdown(opt)"></button>
                </div>
                <div v-else-if="m.q && m.q.type === 'judge'" class="chat-quiz-answer-judge">
                  <button class="chat-quiz-option-btn" :disabled="submitting[m.id]" @click="answerOption(m, 0)">✅ 正确</button>
                  <button class="chat-quiz-option-btn" :disabled="submitting[m.id]" @click="answerOption(m, 1)">❌ 错误</button>
                </div>
                <div v-else class="chat-quiz-answer-text">
                  <input v-model="textAnswers[m.id]" type="text" class="chat-quiz-text-input" placeholder="输入答案..." />
                  <button class="chat-quiz-submit-btn" :disabled="submitting[m.id]" @click="submitText(m)">提交</button>
                </div>
              </div>
              <!-- 发送方：等待作答 -->
              <div v-else class="chat-quiz-waiting">⏳ 等待好友作答...</div>
            </div>
          </div>
          <!-- 文本消息 -->
          <div v-else class="chat-msg-content">
            <div class="chat-msg-text">{{ m.content || '' }}</div>
          </div>

          <div v-if="m.revocable" class="chat-msg-revoke" @click="store.revokeMessage(m.id)">撤回</div>
        </div>
      </div>
    </template>

    <!-- 图片预览 -->
    <Teleport to="body">
      <div v-if="previewUrl" class="chat-img-lightbox" @click="previewUrl = null">
        <img :src="previewUrl" />
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue'
import { useChatStore } from '../../../stores/chat'
import { useUserStore } from '../../../stores/user'
import { renderMarkdown, formatFileSize } from '../../../services/utils'

const store = useChatStore()
const user = useUserStore()

const container = ref(null)
const previewUrl = ref(null)
const failedImgs = ref({})
const textAnswers = reactive({})
const submitting = reactive({})

const resultLabels = ['A', 'B', 'C', 'D', 'E', 'F']
const typeMap = { single: '单选题', judge: '判断题', term: '名词解释', short: '简答题' }

function quizQuestion(msg) {
  const qd = msg.quiz_data || {}
  return (qd.questions || [])[0] || null
}
function quizResult(msg) {
  return (msg.quiz_data || {})._result || null
}
function avatarUrlOf(m) {
  const room = store.currentRoom
  if (!room || !room.members) return null
  const mem = room.members.find((x) => x.id === m.user_id)
  return mem && mem.avatar_url ? mem.avatar_url : null
}
function canRevoke(m) {
  if (!m.created_at) return false
  return (Date.now() - new Date(m.created_at).getTime()) < 2 * 60 * 1000
}

const prepared = computed(() => {
  return store.messages.map((m) => {
    const isMine = m.user_id === user.userId
    const q = quizQuestion(m)
    const result = quizResult(m)
    return {
      ...m,
      isMine,
      q,
      result,
      typeName: q ? (typeMap[q.type] || q.type || '') : '',
      initial: isMine ? (user.shortName || '我') : (m.sender_name || '?').charAt(0).toUpperCase(),
      avatarUrl: avatarUrlOf(m),
      time: store.formatTime(m.created_at),
      revocable: isMine && !m.is_revoked && canRevoke(m)
    }
  })
})

function imgError(url) {
  if (url) failedImgs.value = { ...failedImgs.value, [url]: true }
}

function previewImage(url) {
  if (url) previewUrl.value = url
}

function openFile(url) {
  if (url) window.open(url, '_blank')
}

function resultOptionClass(m, oi) {
  const r = quizResult(m)
  if (!r) return 'opt-muted'
  if (r.chosenAnswerIdx === oi && r.correctAnswerIdx === oi) return 'opt-correct'
  if (r.chosenAnswerIdx === oi) return 'opt-wrong'
  if (r.correctAnswerIdx === oi) return 'opt-correct'
  return 'opt-muted'
}

function yourOptLabel(r) {
  return (r && r.chosenAnswerIdx !== undefined && r.chosenAnswerIdx !== null && r.chosenAnswerIdx >= 0) ? resultLabels[r.chosenAnswerIdx] : ''
}
function correctOptLabel(r) {
  return (r && r.correctAnswerIdx !== undefined && r.correctAnswerIdx !== null && r.correctAnswerIdx >= 0) ? resultLabels[r.correctAnswerIdx] : ''
}
function yourAnswerHtml(m) {
  const r = m.result
  const label = yourOptLabel(r)
  return (label ? label + '. ' : '') + renderMarkdown(r.chosenAnswerText || r.chosenAnswer || '')
}
function standardAnswerHtml(m) {
  const r = m.result
  const label = correctOptLabel(r)
  return (label ? label + '. ' : '') + renderMarkdown(r.correctAnswerText || '')
}

async function answerOption(m, oi) {
  if (submitting[m.id]) return
  submitting[m.id] = true
  try { await store.answerSharedQuiz(m.id, oi) }
  finally { submitting[m.id] = false }
}

async function submitText(m) {
  const v = (textAnswers[m.id] || '').trim()
  if (!v || submitting[m.id]) return
  submitting[m.id] = true
  try { await store.answerSharedQuizText(m.id, v) }
  finally { submitting[m.id] = false; textAnswers[m.id] = '' }
}

function scrollToBottom() {
  nextTick(() => {
    const el = container.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function isNearBottom() {
  const el = container.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 50
}

watch(() => store.openRoomId, (id, old) => {
  if (id && id !== old) {
    scrollToBottom()
    setTimeout(scrollToBottom, 300)
  }
})

watch(() => store.messages.length, (n, o) => {
  if (n > o && isNearBottom()) scrollToBottom()
})

onMounted(scrollToBottom)
</script>

<style scoped>
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  -webkit-overflow-scrolling: touch;
}

/* 扁平消息：头像 + 名称 + 内容块 + 时间 */
.chat-msg {
  display: flex;
  gap: 10px;
  max-width: 82%;
  animation: chatMsgFadeIn 0.2s ease;
}
@keyframes chatMsgFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.chat-msg-mine { align-self: flex-end; flex-direction: row-reverse; }
.chat-msg-other { align-self: flex-start; }

.chat-msg-avatar {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  overflow: hidden;
  flex-shrink: 0;
}
.chat-msg-avatar.mine { background: var(--gradient-primary); }
.chat-msg-avatar.other { background: linear-gradient(135deg, var(--exam-color-4), var(--exam-color-5)); }
.chat-msg-avatar img { width: 100%; height: 100%; object-fit: cover; }

.chat-msg-body { display: flex; flex-direction: column; min-width: 0; }
.chat-msg-mine .chat-msg-body { align-items: flex-end; }
.chat-msg-other .chat-msg-body { align-items: flex-start; }

.chat-msg-meta { display: flex; align-items: baseline; gap: 6px; }
.chat-msg-sender { font-size: 10px; color: var(--text-muted); }
.chat-msg-time { font-size: 10px; color: var(--text-muted); }

.chat-msg-content { max-width: 100%; }
.chat-msg-text {
  font-size: var(--fs-base);
  line-height: var(--lh-normal);
  color: var(--text-primary);
  word-break: break-word;
  white-space: pre-wrap;
}

/* 回复引用 */
.chat-msg-reply {
  font-size: 10px;
  opacity: 0.7;
  margin-bottom: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-hover);
  color: var(--text-secondary);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 撤回按钮 */
.chat-msg-revoke {
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  text-decoration: underline;
  margin-top: 2px;
}
.chat-msg-revoke:hover { color: var(--color-danger); }

/* 系统消息（撤回） */
.chat-msg-system {
  align-self: center;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  opacity: 0.7;
}

/* 图片消息 */
.chat-msg-image-wrap { display: flex; flex-wrap: wrap; gap: 4px; max-width: 300px; }
.chat-msg-image {
  max-width: 240px;
  max-height: 240px;
  object-fit: cover;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: opacity var(--transition-fast);
}
.chat-msg-image:hover { opacity: 0.85; }

/* 文件消息 */
.chat-msg-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--surface-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: background var(--transition-fast);
  min-width: 200px;
}
.chat-msg-file:hover { background: var(--surface-hover); }
.chat-msg-file-icon { font-size: 24px; flex-shrink: 0; }
.chat-msg-file-info { flex: 1; min-width: 0; }
.chat-msg-file-name {
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-msg-file-size { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

/* 题目分享卡片 */
.chat-msg-quiz-share {
  background: var(--surface-card);
  border: 1px solid var(--color-primary-light);
  border-radius: var(--radius-md);
  padding: 12px;
  min-width: 220px;
  max-width: 300px;
  cursor: pointer;
  transition: box-shadow var(--transition-fast);
}
.chat-msg-quiz-share:hover { box-shadow: var(--shadow-md); }
.chat-quiz-share-header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.chat-quiz-share-icon { font-size: 20px; }
.chat-quiz-share-title { font-size: var(--fs-sm); font-weight: 600; color: var(--color-primary); }
.chat-quiz-share-from { font-size: 10px; color: var(--text-muted); margin-bottom: 8px; }
.chat-quiz-share-tag {
  font-size: 10px;
  padding: 1px 6px;
  background: var(--surface-hover);
  border-radius: 10px;
  color: var(--text-secondary);
  display: inline-block;
  margin-bottom: 6px;
}
.chat-quiz-share-question {
  font-size: var(--fs-sm);
  color: var(--text-primary);
  margin: 6px 0;
  line-height: var(--lh-normal);
  word-break: break-word;
}

/* 作答结果 */
.chat-quiz-result {
  margin-top: 8px;
  padding: 10px;
  border-radius: var(--radius-md);
}
.chat-quiz-result.correct { background: var(--color-success-light); border: 1px solid var(--color-success); }
.chat-quiz-result.wrong { background: var(--color-danger-light); border: 1px solid var(--color-danger); }
.chat-quiz-result-head { font-size: var(--fs-sm); font-weight: 600; margin-bottom: 8px; }
.chat-quiz-result-opts { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.chat-quiz-result-opt { font-size: 11px; padding: 3px 6px; border-radius: var(--radius-sm); }
.chat-quiz-result-opt.opt-correct { background: var(--color-success-light); color: var(--color-success); }
.chat-quiz-result-opt.opt-wrong { background: var(--color-danger-light); color: var(--color-danger); }
.chat-quiz-result-opt.opt-muted { color: var(--text-secondary); }
.chat-quiz-result-answers { font-size: 11px; margin-top: 4px; }
.answer-line { margin-bottom: 3px; }
.mark-ok { color: var(--color-success); }
.mark-bad { color: var(--color-danger); }
.chat-quiz-result-meta { font-size: 10px; color: var(--text-muted); margin-top: 6px; }
.chat-quiz-result-explain {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 6px;
  padding: 6px;
  background: var(--surface-hover);
  border-radius: var(--radius-sm);
}

/* 作答界面 */
.chat-quiz-answer { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.chat-quiz-answer-opts { display: flex; flex-direction: column; gap: 4px; }
.chat-quiz-answer-judge { display: flex; gap: 8px; }
.chat-quiz-answer-judge .chat-quiz-option-btn { flex: 1; }
.chat-quiz-answer-text { display: flex; gap: 6px; }
.chat-quiz-option-btn {
  text-align: left;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-bg);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--fs-xs);
  color: var(--text-primary);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.chat-quiz-option-btn:hover:not(:disabled) { background: var(--surface-hover); border-color: var(--color-primary); }
.chat-quiz-option-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.chat-quiz-text-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--surface-bg);
}
.chat-quiz-text-input:focus { border-color: var(--color-primary); box-shadow: var(--shadow-glow); outline: none; }
.chat-quiz-submit-btn {
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--fs-xs);
}
.chat-quiz-submit-btn:hover:not(:disabled) { background: var(--color-primary-hover); }
.chat-quiz-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.chat-quiz-waiting {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
  padding: 6px 8px;
  background: var(--surface-hover);
  border-radius: var(--radius-sm);
}

/* 图片预览 */
.chat-img-lightbox {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.85);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.chat-img-lightbox img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--radius-md);
}
</style>
