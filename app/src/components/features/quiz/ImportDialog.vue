<!-- 导入题目 JSON：实时校验 + 预览 + 追加/替换模式 -->
<template>
  <Modal :open="ui.importOpen" @close="close">
    <h3 class="im-title">导入题目 JSON</h3>
    <p class="im-hint">粘贴 AI 返回的题目 JSON，系统会实时校验格式：</p>
    <textarea v-model="text" class="textarea mono" rows="8" placeholder='[{"type":"single","question":"...","options":["A","B","C","D"],"answer":0,"tag":"知识点","explanation":"解析..."}]'></textarea>

    <div v-if="validateState.kind === 'ok'" class="im-status ok"><Icon name="check" :size="13" /> JSON 格式正确，共 {{ validateState.count }} 道题目</div>
    <div v-else-if="validateState.kind === 'err'" class="im-status err"><Icon name="x" :size="13" /> {{ validateState.error }}</div>

    <!-- 导入前预览（前 3 题） -->
    <div v-if="validateState.kind === 'ok'" class="im-preview">
      <div class="im-preview-title">预览</div>
      <div v-for="(q, i) in validateState.preview" :key="i" class="im-preview-item">
        <span class="im-preview-type">{{ typeMap[q.type] || q.type }}</span>
        <span class="im-preview-q">{{ truncate(q.question, 48) }}</span>
      </div>
    </div>

    <div class="im-mode">
      <span class="im-mode-label">导入方式</span>
      <label class="im-radio"><input type="radio" value="append" v-model="mode"> 追加到当前章节</label>
      <label class="im-radio"><input type="radio" value="replace" v-model="mode"> 替换全部题目<em>（替换前自动备份到文件池）</em></label>
    </div>

    <div v-if="error" class="im-error">
      <p>{{ error }}</p>
      <button class="btn btn-secondary btn-small" @click="copyError">复制错误</button>
    </div>
    <div class="dialog-actions">
      <button class="btn btn-secondary btn-small" @click="close">取消</button>
      <button class="btn btn-primary btn-small" :disabled="validateState.kind !== 'ok'" @click="confirm">确认导入</button>
    </div>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useUiStore } from '../../../stores/ui'
import { useDataStore } from '../../../stores/data'
import Modal from '../../ui/Modal.vue'
import Icon from '../../ui/Icon.vue'

const ui = useUiStore()
const data = useDataStore()
const text = ref('')
const error = ref('')
const mode = ref('append')
const typeMap = { single: '单选', judge: '判断', term: '名词解释', short: '简答' }

watch(() => ui.importOpen, (open) => {
  if (open) { text.value = ''; error.value = ''; mode.value = 'append' }
})

function close() { ui.closeImport() }

function parseQuestions() {
  const raw = text.value.trim()
  if (!raw) return null
  const cleanText = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```*$/, '').trim()
  try {
    let data2 = JSON.parse(cleanText)
    if (!Array.isArray(data2)) throw new Error('JSON 必须是数组')
    data2.forEach((item, i) => {
      if (!item.type || !item.question) throw new Error('第' + (i + 1) + '题缺 type 或 question')
      if (!['single', 'judge', 'term', 'short'].includes(item.type)) throw new Error('第' + (i + 1) + '题 type 无效')
      if ((item.type === 'single' || item.type === 'judge') && (!Array.isArray(item.options) || !item.options.length)) throw new Error('第' + (i + 1) + '题缺 options')
    })
    data2 = data2.filter((q) => q.question && q.question.trim().length > 2)
    if (data2.length === 0) throw new Error('没有有效的题目')
    return data2
  } catch (e) {
    throw e
  }
}

// 实时校验状态
const validateState = computed(() => {
  if (!text.value.trim()) return { kind: 'idle' }
  try {
    const qs = parseQuestions()
    return { kind: 'ok', count: qs.length, preview: qs.slice(0, 3) }
  } catch (e) {
    return { kind: 'err', error: e.message }
  }
})

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

function confirm() {
  error.value = ''
  try {
    const qs = parseQuestions()
    qs.forEach((q, i) => { if (!q.id) q.id = i + 1 })
    const ch = data.getCh()
    if (!ch) throw new Error('请先选择章节')
    if (mode.value === 'replace') {
      // 替换：备份现有题目到章节内隐藏副本，再清空重建
      const backup = { questions: ch.questions || [], quizSets: ch.quizSets || [], userAnswers: ch.userAnswers || [], createdAt: Date.now() }
      if (!ch.importBackups) ch.importBackups = []
      ch.importBackups.push(backup)
      ch.questions = []
      ch.quizSets = []
      ch.userAnswers = []
      ch.currentQuizSetIdx = 0
    }
    data.createQuizSetForChapter(qs, ch.id)
    data.saveState()
    close()
    ui.toast('已导入 ' + qs.length + ' 道题目' + (mode.value === 'replace' ? '（原题目已备份）' : ''), 'ok')
  } catch (e) {
    error.value = e.message
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
.im-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-sm);
  padding: 6px 12px;
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
}
.im-status.ok { background: var(--color-success-light); color: var(--color-success); }
.im-status.err { background: var(--color-danger-light); color: var(--color-danger); }
.im-preview {
  margin-top: var(--space-sm);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
}
.im-preview-title { font-size: var(--fs-xs); color: var(--text-muted); margin-bottom: 4px; }
.im-preview-item { display: flex; gap: 8px; align-items: baseline; padding: 3px 0; font-size: var(--fs-sm); }
.im-preview-type { flex-shrink: 0; font-size: 11px; color: var(--color-primary); background: var(--color-primary-light); border-radius: var(--radius-sm); padding: 0 6px; line-height: 18px; }
.im-preview-q { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.im-mode {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--surface-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
}
.im-mode-label { color: var(--text-secondary); }
.im-radio { display: inline-flex; align-items: center; gap: 6px; color: var(--text-primary); cursor: pointer; }
.im-radio input { accent-color: var(--color-primary); }
.im-radio em { color: var(--text-muted); font-style: normal; font-size: var(--fs-xs); }
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
