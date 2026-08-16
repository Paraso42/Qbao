<!-- 导入题目 JSON（自 legacy strategy.js confirmImport 迁移） -->
<template>
  <Modal :open="ui.importOpen" @close="close">
    <h3 class="im-title">导入题目 JSON</h3>
    <p class="im-hint">粘贴 AI 返回的 JSON：</p>
    <textarea v-model="text" class="textarea" rows="8" placeholder='[{"type":"single","question":"...","options":["A","B","C","D"],"answer":0,"tag":"知识点","explanation":"解析..."}]'></textarea>
    <div v-if="error" class="im-error">
      <p>{{ error }}</p>
      <button class="btn btn-secondary btn-small" @click="copyError">复制错误</button>
    </div>
    <div class="dialog-actions">
      <button class="btn btn-secondary btn-small" @click="close">取消</button>
      <button class="btn btn-success btn-small" @click="confirm">确认导入</button>
    </div>
  </Modal>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useUiStore } from '../../../stores/ui'
import { useDataStore } from '../../../stores/data'
import Modal from '../../ui/Modal.vue'

const ui = useUiStore()
const data = useDataStore()
const text = ref('')
const error = ref('')

watch(() => ui.importOpen, (open) => {
  if (open) { text.value = ''; error.value = '' }
})

function close() { ui.closeImport() }

function confirm() {
  error.value = ''
  try {
    const raw = text.value.trim()
    if (!raw) throw new Error('请输入 JSON')
    const cleanText = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```*$/, '').trim()
    let data2 = JSON.parse(cleanText)
    if (!Array.isArray(data2)) throw new Error('JSON 必须是数组')
    data2.forEach((item, i) => {
      if (!item.type || !item.question) throw new Error('第' + (i + 1) + '题缺 type 或 question')
      if (!['single', 'judge', 'term', 'short'].includes(item.type)) throw new Error('第' + (i + 1) + '题 type 无效')
      if ((item.type === 'single' || item.type === 'judge') && (!Array.isArray(item.options) || !item.options.length)) throw new Error('第' + (i + 1) + '题缺 options')
    })
    data2 = data2.filter((q) => q.question && q.question.trim().length > 2)
    data2.forEach((q, i) => { if (!q.id) q.id = i + 1 })
    if (data2.length === 0) throw new Error('没有有效的题目')
    const ch = data.getCh()
    if (!ch) throw new Error('请先选择章节')
    data.createQuizSetForChapter(data2, ch.id)
    data.saveState()
    close()
    ui.toast('✅ 已导入 ' + data2.length + ' 道题目', 'ok')
  } catch (e) {
    error.value = '❌ ' + e.message
  }
}

function copyError() {
  if (navigator.clipboard) navigator.clipboard.writeText(error.value)
  ui.toast('已复制', 'info')
}
</script>

<style scoped>
.im-title { margin-bottom: var(--space-sm); }
.im-hint { color: var(--text-secondary); font-size: var(--fs-sm); margin-bottom: var(--space-sm); }
.im-error {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-danger-light);
  border-radius: var(--radius-md);
  color: var(--color-danger);
  font-size: var(--fs-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
</style>
