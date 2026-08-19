<!-- AI 复习资料管理（上传/拖拽/列表/文件池，自 legacy ai-workflow materials 部分迁移） -->
<template>
  <div class="am-section">
    <h4>第四步：复习资料管理</h4>
    <p class="am-hint">上传本章节的 PPT、Word、PDF 等资料，AI 将根据这些资料出题。</p>

    <div v-if="materials.length > 0" class="am-list">
      <div v-for="(m, i) in materials" :key="m.id" class="am-file">
        <span class="am-icon"><Icon :name="extIcon(m.name)" :size="15" /></span>
        <span class="am-name" :title="m.name">{{ m.name }}</span>
        <span class="am-size">{{ formatSize(m.size) }}</span>
        <button class="am-del" title="删除" @click="ai.removeMaterial(chapterId, i)">×</button>
      </div>
    </div>
    <div v-else class="am-empty">暂无资料</div>

    <div class="am-drop" :class="{ dragover: dragging }" @click="pickFiles" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
      <Icon name="upload" :size="22" />
      <span>{{ dragging ? '松开以添加文件' : '点击或拖拽文件到此处上传' }}</span>
    </div>
    <input ref="fileInput" type="file" multiple accept=".pdf,.doc,.docx,.pptx,.txt,.md" style="display:none" @change="onPick">

    <div class="am-actions">
      <button class="btn btn-secondary btn-small" @click="openPool">从文件池选择</button>
    </div>

    <!-- 文件池选择器 -->
    <Modal :open="poolOpen" @close="poolOpen = false">
      <h3 class="pool-title">从文件池选择资料</h3>
      <p class="pool-hint">文件池中的文件已上传至服务器，选择后将关联到本章节。</p>
      <div class="pool-list">
        <EmptyState v-if="!poolLoading && poolFiles.length === 0" icon="folder" title="文件池为空" hint="先在用户中心的「文件管理」上传文件" />
        <div v-for="f in poolFiles" :key="f.id" class="pool-item" @click="assign(f)">
          <span class="pool-icon"><Icon name="paperclip" :size="15" /></span>
          <div class="pool-main">
            <div class="pool-name">{{ f.originalName }}</div>
            <div class="pool-meta">{{ formatSize(f.fileSize) }}</div>
          </div>
          <span class="pool-cta">选择</span>
        </div>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-secondary btn-small" @click="poolOpen = false">关闭</button>
      </div>
    </Modal>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useDataStore } from '../../../stores/data'
import { useAiStore } from '../../../stores/ai'
import { useUiStore } from '../../../stores/ui'
import { fetchWithAuth } from '../../../services/api'
import Modal from '../../ui/Modal.vue'
import Icon from '../../ui/Icon.vue'
import EmptyState from '../../ui/EmptyState.vue'

const props = defineProps({ chapterId: { type: String, required: true } })
const data = useDataStore()
const ai = useAiStore()
const ui = useUiStore()

const fileInput = ref(null)
const dragging = ref(false)
const poolOpen = ref(false)
const poolLoading = ref(false)
const poolFiles = ref([])

const materials = computed(() => ai.getChapterMaterials(props.chapterId))

function extIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase()
  if (ext === 'pdf') return 'file'
  if (ext === 'doc' || ext === 'docx') return 'edit'
  if (ext === 'ppt' || ext === 'pptx') return 'chart'
  if (ext === 'txt' || ext === 'md') return 'file'
  return 'paperclip'
}
function formatSize(bytes) { return ai.formatFileSize(bytes) }

function pickFiles() { fileInput.value && fileInput.value.click() }
function onPick(e) {
  if (e.target.files && e.target.files.length) ai.addMaterialFiles(props.chapterId, e.target.files)
  e.target.value = ''
}
function onDrop(e) {
  dragging.value = false
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) ai.addMaterialFiles(props.chapterId, e.dataTransfer.files)
}

async function loadPoolFiles() {
  poolLoading.value = true
  try {
    const res = await fetchWithAuth('/files?pool=true')
    if (!res || !res.ok) { ui.toast('获取文件池失败', 'err'); return [] }
    const d = await res.json()
    const files = d.files || []
    // 文件池中已过期/删除的文件，同步从本章节复习资料中移除
    ai.reconcilePoolMaterials(props.chapterId, files)
    return files
  } catch (e) {
    ui.toast('获取文件池失败', 'err')
    return []
  } finally {
    poolLoading.value = false
  }
}

async function openPool() {
  poolOpen.value = true
  poolFiles.value = await loadPoolFiles()
}

onMounted(async () => {
  // 仅当复习资料中存在文件池引用时才拉取文件池并清理已过期项，避免无谓请求
  if (ai.getChapterMaterials(props.chapterId).some((m) => m._poolFile)) {
    await loadPoolFiles()
  }
})

async function assign(f) {
  try {
    await ai.assignPoolFileToChapter(props.chapterId, f.id)
    poolOpen.value = false
    ui.toast('已关联「' + f.originalName + '」', 'ok')
  } catch (e) {
    ui.toast(e.message || '关联失败', 'err')
  }
}
</script>

<style scoped>
.am-hint { color: var(--text-muted); font-size: var(--fs-xs); margin-bottom: var(--space-sm); }
.am-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: var(--space-sm); max-height: 200px; overflow-y: auto; padding-right: 2px; }
.am-file {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 8px 12px;
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
}
.am-file:hover { border-color: var(--color-primary); }
.am-icon { flex-shrink: 0; }
.am-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.am-size { color: var(--text-muted); font-size: var(--fs-xs); flex-shrink: 0; }
.am-del { color: var(--text-muted); width: 26px; height: 26px; border-radius: var(--radius-sm); font-size: var(--fs-md); flex-shrink: 0; }
.am-del:hover { color: var(--color-danger); background: var(--color-danger-light); }
.am-empty { color: var(--text-muted); font-size: var(--fs-sm); padding: 6px 0; }
.am-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: var(--space-xl);
  border: 2px dashed var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}
.am-drop:hover, .am-drop.dragover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
.am-actions { margin-top: var(--space-sm); }
.pool-title { margin-bottom: var(--space-sm); }
.pool-hint { color: var(--text-secondary); font-size: var(--fs-sm); margin-bottom: var(--space-sm); }
.pool-list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.pool-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}
.pool-item:hover { border-color: var(--color-primary); background: var(--color-primary-light); }
.pool-main { flex: 1; min-width: 0; }
.pool-name { font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pool-meta { font-size: var(--fs-xs); color: var(--text-muted); }
.pool-cta { color: var(--color-primary); font-size: var(--fs-xs); }
</style>