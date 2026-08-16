<!--
  FilesTab.vue — 文件管理/文件池（自 legacy users.js renderFilesPage/uploadToFilePool/assignFileToChapter 等）
  上传/删除/分配到章节/取消分配/续期 + 7 天到期倒计时显示。
-->
<template>
  <div class="files-tab">
    <div class="storage-bar">
      <span class="storage-label">📦 存储积分：<b>{{ users.storagePoints }}</b></span>
      <span class="storage-tip">续期消耗 10 积分/7天（功能预留）</span>
    </div>

    <!-- 文件池 -->
    <div class="section">
      <h4>📁 文件池</h4>
      <p class="desc">上传资料到文件池，可分配给不同章节使用。默认保存 7 天。</p>
      <div
        class="drop-zone"
        :class="{ 'drop-zone-active': dragOver }"
        @click="pickFiles"
        @dragover.prevent="dragOver = true"
        @dragenter.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <div class="drop-zone-icon">📤</div>
        <div class="drop-zone-text">拖拽文件到此处上传</div>
        <div class="drop-zone-hint">支持批量上传，单文件 ≤20MB</div>
      </div>
      <div class="upload-actions">
        <button class="btn btn-primary btn-small" @click="pickFiles">📤 上传文件</button>
        <input ref="fileInputRef" type="file" multiple hidden accept=".pdf,.doc,.docx,.pptx,.txt,.md,.jpg,.jpeg,.png,.webp" @change="onUpload">
      </div>

      <div v-if="users.filesLoading" class="loading">加载中...</div>
      <template v-else>
        <div v-if="users.poolFiles.length > 0" class="files-list">
          <div v-for="f in users.poolFiles" :key="f.id" class="file-item" :class="{ expired: isExpired(f) }">
            <span class="file-icon">{{ iconOf(f) }}</span>
            <div class="file-info">
              <div class="file-name" :title="f.originalName">{{ f.originalName }}</div>
              <div class="file-meta">
                {{ sizeOf(f.fileSize) }} ·
                <span class="file-expiry" :class="{ 'expired-text': isExpired(f) }">{{ expiryText(f) }}</span>
              </div>
            </div>
            <div class="file-actions">
              <button class="btn btn-text btn-small" @click="users.assignFile(f.id)">分配</button>
              <button class="btn btn-warning btn-small" :class="{ dim: f.pointsExtended }" :title="'续期 7 天（需 10 积分，功能预留）'" @click="users.extendFile(f.id)">续期</button>
              <button class="btn btn-danger btn-small" @click="onDelete(f)">删除</button>
            </div>
          </div>
        </div>
        <p v-else class="empty">文件池为空，上传文件开始使用</p>
      </template>
    </div>

    <!-- 当前章节资料 -->
    <div class="section">
      <h4>📚 当前章节资料</h4>
      <p v-if="users.currentChapter" class="desc">章节：{{ users.currentChapter.name }}</p>
      <div v-if="users.filesLoading" class="loading">加载中...</div>
      <template v-else>
        <div v-if="users.chapterFiles.length > 0" class="files-list">
          <div v-for="f in users.chapterFiles" :key="f.id" class="file-item">
            <span class="file-icon">{{ iconOf(f) }}</span>
            <div class="file-info">
              <div class="file-name" :title="f.originalName">{{ f.originalName }}</div>
              <div class="file-meta">{{ sizeOf(f.fileSize) }} · {{ dateOf(f.createdAt) }}</div>
            </div>
            <div class="file-actions">
              <button class="btn btn-danger btn-small" @click="onUnassign(f)">移除</button>
            </div>
          </div>
        </div>
        <p v-else class="empty">暂无章节资料，从文件池分配或上传</p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useUsersStore } from '../../../stores/users'
import { useUiStore } from '../../../stores/ui'
import { formatFileSize } from '../../../services/utils'
import { formatDuration, fileIconFor } from '../../../services/filesApi'

const users = useUsersStore()
const ui = useUiStore()

const fileInputRef = ref(null)
const dragOver = ref(false)
const now = ref(Date.now())
let timer = null

function pickFiles() { if (fileInputRef.value) fileInputRef.value.click() }

function onUpload(e) {
  const files = e.target.files
  e.target.value = ''
  if (!files || files.length === 0) return
  users.uploadFiles(Array.from(files))
}

function onDrop(e) {
  dragOver.value = false
  const files = e.dataTransfer.files
  if (!files || files.length === 0) return
  users.uploadFiles(Array.from(files))
}

function iconOf(f) { return fileIconFor(f.mimeType) }
function sizeOf(bytes) { return formatFileSize(bytes) }
function dateOf(ts) { try { return new Date(ts).toLocaleDateString('zh-CN') } catch (e) { return '' } }

function remainingOf(f) {
  if (!f.poolExpiresAt) return null
  return new Date(f.poolExpiresAt).getTime() - now.value
}
function isExpired(f) {
  const r = remainingOf(f)
  return r !== null && r <= 0
}
function expiryText(f) {
  const r = remainingOf(f)
  if (r === null) return ''
  return isExpired(f) ? '已过期' : formatDuration(r) + ' 后过期'
}

async function onDelete(f) {
  const ok = await ui.openConfirm('删除文件', '确定要删除此文件吗？此操作不可恢复。', '删除', { danger: true })
  if (!ok) return
  users.deleteFile(f.id)
}

async function onUnassign(f) {
  const ok = await ui.openConfirm('移除文件', '确定要从此章节移除该文件吗？文件仍会保留在文件池中。', '移除')
  if (!ok) return
  users.unassignFile(f.id)
}

onMounted(() => {
  users.loadFiles()
  timer = setInterval(() => { now.value = Date.now() }, 60000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.files-tab { display: flex; flex-direction: column; gap: var(--space-md); }
.storage-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); }
.storage-label { font-size: var(--fs-sm); color: var(--text-secondary); }
.storage-label b { color: var(--color-primary); }
.storage-tip { font-size: var(--fs-xs); color: var(--text-muted); }
.section {
  background: var(--surface-bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
}
.section h4 {
  margin: 0 0 var(--space-sm);
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.desc { font-size: var(--fs-xs); color: var(--text-secondary); margin: 0 0 var(--space-sm); }
.drop-zone {
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-xl);
  text-align: center;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}
.drop-zone:hover, .drop-zone-active { border-color: var(--color-primary); background: var(--color-primary-light); }
.drop-zone-icon { font-size: 28px; margin-bottom: var(--space-xs); }
.drop-zone-text { font-size: var(--fs-sm); color: var(--text-primary); }
.drop-zone-hint { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.upload-actions { margin: var(--space-sm) 0 var(--space-md); }
.loading { text-align: center; color: var(--text-muted); padding: var(--space-lg); font-size: var(--fs-sm); }
.empty { font-size: var(--fs-sm); color: var(--text-muted); text-align: center; padding: var(--space-lg); }

.files-list { display: flex; flex-direction: column; gap: var(--space-sm); max-height: 340px; overflow-y: auto; padding-right: 4px; }
.file-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast);
}
.file-item:hover { border-color: var(--color-primary); }
.file-item.expired { opacity: 0.55; }
.file-icon { font-size: var(--fs-lg); flex-shrink: 0; }
.file-info { flex: 1; min-width: 0; }
.file-name { font-size: var(--fs-base); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-meta { font-size: var(--fs-xs); color: var(--text-muted); }
.file-expiry.expired-text { color: var(--color-danger); }
.file-actions { display: flex; gap: var(--space-xs); flex-shrink: 0; }
.dim { opacity: 0.5; }
</style>
