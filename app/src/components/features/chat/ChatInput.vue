<!-- 对应 legacy chat.js：chatSendMessage/chatHandleKeydown/chatUploadFileToServer/分享车渲染（输入区） -->
<template>
  <div class="chat-input-area">
    <div class="chat-input-toolbar">
      <button class="chat-tool-btn" title="发送图片" @click="triggerImage">
        <Icon name="image" :size="16" />
      </button>
      <button class="chat-tool-btn" title="发送文件" @click="triggerFile">
        <Icon name="upload" :size="16" />
      </button>
      <button v-if="store.canShareQuiz" class="chat-tool-btn" title="分享题目" @click="store.openSharePicker()">
        <Icon name="share" :size="16" />
      </button>
      <input ref="imageInput" type="file" accept="image/*" multiple class="chat-hidden-input" @change="onImageSelect" />
      <input ref="fileInput" type="file" class="chat-hidden-input" @change="onFileSelect" />
    </div>

    <!-- 图片/文件预览 -->
    <div v-if="pendingImages.length > 0" class="chat-img-preview">
      <div v-for="img in pendingImages" :key="img.url" class="chat-img-preview-item">
        <img :src="img.url" />
        <button class="chat-img-preview-remove" @click="removeImage(img.url)">✕</button>
      </div>
    </div>
    <div v-if="pendingFile" class="chat-file-preview">
      <div class="chat-file-preview-item">
        <span>📄 {{ pendingFile.name }}</span>
        <button class="chat-file-preview-remove" @click="removeFile()">✕</button>
      </div>
    </div>
    <div v-if="uploading" class="chat-uploading">上传中...</div>

    <!-- 分享车 -->
    <div v-if="store.quizCart.length > 0" class="chat-quiz-cart">
      <div class="chat-cart-header">
        <span>🛒 分享车 ({{ store.quizCart.length }}题)</span>
        <button class="chat-cart-clear" @click="store.clearQuizCart()">清空</button>
      </div>
      <div class="chat-cart-items">
        <div v-for="(item, i) in store.quizCart" :key="item.flatIdx" class="chat-cart-item">
          <span class="chat-cart-item-icon">{{ iconOf(item.question) }}</span>
          <span class="chat-cart-item-text">{{ (item.question.question || '').substring(0, 30) }}</span>
          <button class="chat-cart-item-remove" @click="store.removeFromQuizCart(i)">×</button>
        </div>
      </div>
      <button class="chat-cart-share-btn" @click="store.shareQuizCart()">📤 一键分享</button>
    </div>

    <div class="chat-input-row">
      <textarea
        ref="inputEl"
        v-model="draft"
        class="chat-input"
        placeholder="输入消息...（Enter 发送，Shift+Enter 换行）"
        rows="1"
        @keydown="onKeydown"
        @paste="onPaste"
      ></textarea>
      <button class="chat-send-btn" :disabled="!canSend" @click="doSend">发送</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import Icon from '../../ui/Icon.vue'
import { useChatStore } from '../../../stores/chat'
import { useUiStore } from '../../../stores/ui'

const store = useChatStore()
const ui = useUiStore()

const draft = ref('')
const pendingImages = ref([])
const pendingFile = ref(null)
const uploading = ref(false)
const imageInput = ref(null)
const fileInput = ref(null)
const inputEl = ref(null)

const typeIcon = { single: '📋', judge: '⚖️', term: '📖', short: '✍️' }

const canSend = computed(() => {
  return draft.value.trim() !== '' || pendingImages.value.length > 0 || pendingFile.value !== null
})

function iconOf(q) {
  return typeIcon[q.type] || '📝'
}

function triggerImage() { imageInput.value && imageInput.value.click() }
function triggerFile() { fileInput.value && fileInput.value.click() }

async function uploadImage(file) {
  if (!file) return
  uploading.value = true
  try {
    const data = await store.uploadFile(file)
    pendingImages.value.push(data)
  } catch (err) {
    ui.toast('上传失败: ' + (err.message || '请重试'), 'err')
  } finally {
    uploading.value = false
  }
}

async function onImageSelect(e) {
  const files = e.target.files
  if (!files || files.length === 0) return
  for (let i = 0; i < files.length; i++) {
    await uploadImage(files[i])
  }
  e.target.value = ''
}

async function onFileSelect(e) {
  const file = e.target.files[0]
  if (!file) return
  uploading.value = true
  try {
    pendingFile.value = await store.uploadFile(file)
  } catch (err) {
    ui.toast('上传失败: ' + (err.message || '请重试'), 'err')
  } finally {
    uploading.value = false
  }
  e.target.value = ''
}

function onPaste(e) {
  const items = (e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData) || {}).items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault()
      const blob = items[i].getAsFile()
      uploadImage(blob)
      return
    }
  }
}

function removeImage(url) {
  pendingImages.value = pendingImages.value.filter((img) => img.url !== url)
}

function removeFile() {
  pendingFile.value = null
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    doSend()
  }
}

async function doSend() {
  if (!store.openRoomId) return
  if (!canSend.value) return

  const content = draft.value.trim()
  let msgType = 'text'
  let images = []
  let fileInfo = null
  if (pendingFile.value) {
    msgType = 'file'
    fileInfo = pendingFile.value
  } else if (pendingImages.value.length > 0) {
    msgType = 'image'
    images = pendingImages.value.map((img) => img.url)
  }

  draft.value = ''
  pendingImages.value = []
  pendingFile.value = null

  const ok = await store.sendMessage({ roomId: store.openRoomId, content, images, fileInfo, msgType })
  if (ok) focusInput()
}

function focusInput() {
  setTimeout(() => { if (inputEl.value) inputEl.value.focus() }, 150)
}
</script>

<style scoped>
.chat-input-area {
  background: var(--surface-card);
  border-top: 1px solid var(--border-light);
  padding: 8px 12px;
  flex-shrink: 0;
}
.chat-input-toolbar { display: flex; gap: 2px; margin-bottom: 6px; }
.chat-tool-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.chat-tool-btn:hover { background: var(--surface-hover); color: var(--color-primary); }
.chat-hidden-input { display: none; }

.chat-img-preview,
.chat-file-preview {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.chat-img-preview-item {
  position: relative;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
}
.chat-img-preview-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
}
.chat-img-preview-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-danger);
  color: #fff;
  border: none;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.chat-file-preview-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--surface-hover);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-secondary);
  max-width: 200px;
}
.chat-file-preview-item span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-file-preview-remove {
  background: none;
  border: none;
  color: var(--color-danger);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}
.chat-uploading {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

/* 分享车 */
.chat-quiz-cart {
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: 8px;
  margin-bottom: 6px;
}
.chat-cart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.chat-cart-clear {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10px;
  font-family: inherit;
  padding: 1px 4px;
}
.chat-cart-clear:hover { color: var(--color-danger); }
.chat-cart-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
  max-height: 120px;
  overflow-y: auto;
}
.chat-cart-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-primary);
  max-width: 100%;
}
.chat-cart-item-icon { flex-shrink: 0; }
.chat-cart-item-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}
.chat-cart-item-remove {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
}
.chat-cart-item-remove:hover { color: var(--color-danger); }
.chat-cart-share-btn {
  width: 100%;
  padding: 5px 0;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.chat-cart-share-btn:hover { background: var(--color-primary-hover); }

/* 输入胶囊 + 聚焦环 */
.chat-input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.chat-input {
  flex: 1;
  padding: 8px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  font-size: var(--fs-sm);
  font-family: inherit;
  resize: none;
  outline: none;
  color: var(--text-primary);
  background: var(--surface-bg);
  height: 38px;
  min-height: 38px;
  max-height: 96px;
  line-height: 1.5;
  overflow-y: auto;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  box-sizing: border-box;
}
.chat-input:focus {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-glow);
}
.chat-input::placeholder { color: var(--text-muted); }
.chat-send-btn {
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: #fff;
  font-size: var(--fs-sm);
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background var(--transition-fast), opacity var(--transition-fast);
  white-space: nowrap;
  flex-shrink: 0;
  height: 38px;
}
.chat-send-btn:hover:not(:disabled) { background: var(--color-primary-hover); }
.chat-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
