<!--
  IssueDetailModal.vue — 工单详情弹窗（对应 legacy feedback.js：
  fbOpenIssueModal / fbRenderIssueDetail / fbRenderMessagesHTML / fbRenderActionBar /
  fbSendMessage / fbHandlePaste / fbUploadImage / fbPreviewImage / fbScrollChatToBottom / 状态流转）
-->
<template>
  <Modal :open="!!store.openIssueId" :wide="true" :closable="true" @close="store.closeDetail()">
    <div class="issue-modal">
      <h3 class="im-title">{{ issue ? issue.title : 'Issue 详情' }}</h3>

      <div v-if="store.detailLoading" class="im-status">加载中...</div>
      <div v-else-if="store.detailError" class="im-status im-error">{{ store.detailError }}</div>

      <template v-else-if="issue">
        <!-- 状态条 -->
        <div class="issue-header-bar">
          <span class="pill" :class="statusPillClass(issue.status)">{{ statusLabel(issue.status) }}</span>
          <span class="issue-header-meta">{{ issue.user_display_name || '用户' }} · {{ formatIssueTime(issue.created_at) }}</span>
        </div>

        <!-- 消息流 -->
        <div class="issue-chat-area" ref="chatRef">
          <template v-for="msg in issue.messages" :key="msg.id">
            <div v-if="msg.is_system" class="issue-message issue-message-system">
              <div class="issue-message-bubble">
                {{ msg.content }}
                <div class="issue-message-time">{{ formatIssueTime(msg.created_at) }}</div>
              </div>
            </div>
            <div v-else-if="isMine(msg)" class="issue-message issue-message-mine">
              <div class="issue-msg-mine-wrap">
                <div v-if="imgList(msg).length" class="issue-images issue-images-mine">
                  <template v-for="(url, i) in imgList(msg)" :key="i">
                    <div v-if="!url" class="issue-img-deleted">图片已删除</div>
                    <img v-else :src="url" class="issue-img-msg" loading="lazy" @click="previewImage(url)" />
                  </template>
                </div>
                <div v-if="msg.content && msg.content.trim()" class="issue-message-bubble">{{ msg.content }}</div>
                <div class="issue-message-time">{{ formatIssueTime(msg.created_at) }}</div>
              </div>
            </div>
            <div v-else class="issue-message issue-message-other">
              <div class="issue-msg-other-wrap">
                <div class="issue-message-sender">{{ senderName(msg) }}</div>
                <div v-if="imgList(msg).length" class="issue-images">
                  <template v-for="(url, i) in imgList(msg)" :key="i">
                    <div v-if="!url" class="issue-img-deleted">图片已删除</div>
                    <img v-else :src="url" class="issue-img-msg" loading="lazy" @click="previewImage(url)" />
                  </template>
                </div>
                <div v-if="msg.content && msg.content.trim()" class="issue-message-bubble">{{ msg.content }}</div>
                <div class="issue-message-time">{{ formatIssueTime(msg.created_at) }}</div>
              </div>
            </div>
          </template>
        </div>

        <!-- 操作栏 -->
        <div class="issue-action-bar">
          <template v-if="!showNotFixed">
            <button v-if="store.isAdmin && issue.status === 'unread'" class="btn btn-primary btn-small" @click="markRead">标记为已读</button>
            <button v-else-if="store.isAdmin && issue.status === 'read'" class="btn btn-success btn-small" @click="markResolved">标记为处理完毕</button>
            <template v-if="!store.isAdmin && issue.status === 'resolved'">
              <button class="btn btn-success btn-small" @click="markFixed">已修复</button>
              <button class="btn btn-danger btn-small" @click="showNotFixed = true">未修复</button>
            </template>
            <span v-if="!hasAction" class="issue-status-hint">{{ statusHint(issue.status, store.isAdmin) }}</span>
          </template>
          <div v-else class="issue-notfixed-reason">
            <input v-model="notFixedReason" class="input" type="text" placeholder="请说明未修复的具体情况..." @keydown.enter="submitNotFixed" />
            <button class="btn btn-danger btn-small" @click="submitNotFixed">提交</button>
            <button class="btn btn-secondary btn-small" @click="showNotFixed = false">取消</button>
          </div>
        </div>

        <!-- 输入区（closed 后不可发消息） -->
        <div v-if="issue.status !== 'closed'" class="issue-chat-input-area">
          <div class="ici-main">
            <div v-if="pendingThumbs.length" class="issue-img-preview">
              <div v-for="t in pendingThumbs" :key="t.key" class="issue-img-thumb">
                <div v-if="t.uploading" class="thumb-uploading">上传中...</div>
                <div v-else class="thumb-wrap">
                  <img :src="t.url" alt="" @click="previewImage(t.url)" />
                  <span class="thumb-remove" @click.stop="removePending(t)">✕</span>
                </div>
              </div>
            </div>
            <div class="ici-row">
              <input ref="inputRef" v-model="draft" class="issue-chat-input" type="text" placeholder="输入消息...（可直接粘贴图片）"
                     @keydown.enter.prevent="send" @paste="onPaste"
                     @focus="store.detailInputFocused = true" @blur="store.detailInputFocused = false" />
              <button class="issue-chat-send" aria-label="发送" @click="send"><Icon name="send" :size="16" /></button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </Modal>

  <!-- 图片大图预览 -->
  <Teleport to="body">
    <div v-if="previewUrl" class="image-overlay" @click="previewUrl = ''">
      <img :src="previewUrl" class="image-overlay-img" alt="" />
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import Modal from '../../ui/Modal.vue'
import Icon from '../../ui/Icon.vue'
import { useIssuesStore } from '../../../stores/issues'
import { useUserStore } from '../../../stores/user'
import { useUiStore } from '../../../stores/ui'
import { statusLabel, statusHint, statusPillClass, formatIssueTime } from './helpers'

const store = useIssuesStore()
const user = useUserStore()
const ui = useUiStore()

const chatRef = ref(null)
const inputRef = ref(null)
const draft = ref('')
const showNotFixed = ref(false)
const notFixedReason = ref('')
const pendingThumbs = ref([])
const previewUrl = ref('')

const issue = computed(() => store.openIssue)

const hasAction = computed(() => {
  if (!issue.value) return false
  if (store.isAdmin) return issue.value.status === 'unread' || issue.value.status === 'read'
  return issue.value.status === 'resolved'
})

function isMine(msg) { return msg.user_id === user.userId }
function senderName(msg) {
  return msg.sender_name || (msg.user_id === issue.value.user_id ? '用户' : '管理员')
}
function imgList(msg) { return Array.isArray(msg.images) ? msg.images : [] }

// 打开/切换工单时重置本地状态
watch(() => store.openIssueId, (id) => {
  if (id != null) {
    draft.value = ''
    showNotFixed.value = false
    notFixedReason.value = ''
    pendingThumbs.value = []
    previewUrl.value = ''
  }
})

// 消息变化后滚动到底部
watch(() => store.openIssue && store.openIssue.messages, () => {
  nextTick(scrollToBottom)
}, { deep: true })

function scrollToBottom() {
  if (chatRef.value) chatRef.value.scrollTop = chatRef.value.scrollHeight
}

async function markRead() { await doStatus('read') }
async function markResolved() { await doStatus('resolved') }
async function markFixed() {
  try { await store.markFixed(issue.value.id) } catch (e) { ui.toast(e.message, 'err') }
}
async function doStatus(status) {
  try { await store.changeStatus(issue.value.id, status) } catch (e) { ui.toast(e.message, 'err') }
}

async function submitNotFixed() {
  const reason = notFixedReason.value.trim()
  if (!reason) { ui.toast('请说明未修复的具体情况', 'err'); return }
  try {
    await store.markNotFixed(issue.value.id, reason)
    showNotFixed.value = false
    notFixedReason.value = ''
  } catch (e) { ui.toast(e.message, 'err') }
}

function onPaste(e) {
  const cd = e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData)
  const items = cd && cd.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault()
      const blob = items[i].getAsFile()
      addImage(blob, 'paste_' + Date.now() + '.png')
      return
    }
  }
}

async function addImage(file, filename) {
  const entry = { key: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), uploading: true, url: '' }
  pendingThumbs.value.push(entry)
  try {
    const data = await store.uploadImage(file, filename)
    entry.uploading = false
    entry.url = data.url
  } catch (e) {
    pendingThumbs.value = pendingThumbs.value.filter(t => t !== entry)
    ui.toast(e.message, 'err')
  }
}

function removePending(t) {
  store.removePendingImage(t.url)
  pendingThumbs.value = pendingThumbs.value.filter(x => x !== t)
}

async function send() {
  const content = draft.value.trim()
  if (!content && store.pendingImages.length === 0) return
  draft.value = ''
  pendingThumbs.value = []
  try {
    await store.sendMessage(content)
    scrollToBottom()
    nextTick(() => { if (inputRef.value) inputRef.value.focus() })
  } catch (e) {
    ui.toast(e.message, 'err')
  }
}

function previewImage(url) { previewUrl.value = url }
</script>

<style scoped>
.issue-modal {
  display: flex;
  flex-direction: column;
  height: 78vh;
  max-height: calc(86vh - 48px);
}
.im-title { flex-shrink: 0; margin: 0 0 var(--space-md); padding-right: 28px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.im-status { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
.im-status.im-error { color: var(--color-danger); }

.issue-header-bar {
  flex-shrink: 0;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--fs-sm);
}
.issue-header-meta { font-size: 11px; color: var(--text-muted); }

.issue-chat-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: var(--space-lg) 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.issue-message { display: flex; margin-bottom: 10px; }
.issue-message-mine { justify-content: flex-end; }
.issue-message-other { justify-content: flex-start; }
.issue-message-system { justify-content: center; margin: 8px 0; }
.issue-msg-mine-wrap { max-width: 72%; display: flex; flex-direction: column; align-items: flex-end; }
.issue-msg-other-wrap { max-width: 72%; }
.issue-message-bubble {
  max-width: 100%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
  word-break: break-word;
}
.issue-message-mine .issue-message-bubble { background: var(--color-primary); color: #fff; border-bottom-right-radius: 4px; }
.issue-message-other .issue-message-bubble { background: var(--surface-hover); color: var(--text-primary); border-bottom-left-radius: 4px; }
.issue-message-system .issue-message-bubble {
  background: transparent;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  padding: 4px 10px;
  max-width: 85%;
  text-align: center;
}
.issue-message-sender { font-size: 11px; font-weight: 600; margin-bottom: 3px; color: var(--text-secondary); }
.issue-message-time { font-size: 10px; color: var(--text-muted); margin-top: 3px; text-align: right; }
.issue-message-other .issue-message-time { text-align: left; }
.issue-message-system .issue-message-time { text-align: center; }

/* 图片 2 列网格 */
.issue-images { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; max-width: 300px; margin-bottom: 6px; }
.issue-img-msg {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: opacity var(--transition-fast);
}
.issue-img-msg:hover { opacity: 0.85; }
.issue-img-deleted {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  padding: 10px 14px;
  background: var(--surface-hover);
  border-radius: var(--radius-md);
  font-style: italic;
}

.issue-action-bar {
  flex-shrink: 0;
  padding: 10px 0;
  border-top: 1px solid var(--border-light);
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  flex-wrap: wrap;
}
.issue-status-hint { font-size: var(--fs-xs); color: var(--text-muted); }
.issue-notfixed-reason { display: flex; gap: var(--space-sm); align-items: center; flex: 1; min-width: 260px; }

.issue-chat-input-area {
  flex-shrink: 0;
  padding: 10px 0 0;
  border-top: 1px solid var(--border-light);
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.ici-main { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.issue-img-preview { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0; }
.issue-img-thumb { display: inline-flex; flex-shrink: 0; }
.thumb-uploading {
  width: 80px;
  height: 80px;
  background: var(--surface-hover);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.thumb-wrap { position: relative; display: inline-block; }
.thumb-wrap img {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.thumb-remove {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-danger);
  color: #fff;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
  cursor: pointer;
}
.ici-row { display: flex; gap: var(--space-sm); align-items: center; }
.issue-chat-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  font-size: var(--fs-sm);
  font-family: inherit;
  outline: none;
  transition: border-color var(--transition-fast), background var(--transition-fast);
  background: var(--surface-card);
  color: var(--text-primary);
}
.issue-chat-input:focus { border-color: var(--color-primary); }
.issue-chat-send {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--gradient-primary);
  color: #fff;
  cursor: pointer;
  transition: opacity var(--transition-fast), transform var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}
.issue-chat-send:hover { opacity: 0.9; }
.issue-chat-send:active { transform: scale(0.92); }

.image-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.image-overlay-img { max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: var(--radius-md); }

@media (max-width: 768px) {
  .issue-modal { height: calc(100dvh - 32px); max-height: none; }
}
</style>
