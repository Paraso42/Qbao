<template>
  <Modal :open="ui.importOpen" @close="close">
    <h3 class="im-title">导入题目</h3>
    <p class="im-hint">从 <b>.json</b> 或 <b>.csv</b> 文件导入，或直接粘贴内容；系统实时校验格式（JSON 数组 / CSV 表头 type,question,options,answer,tag,explanation）</p>
    <div class="im-file-row">
      <label class="btn btn-secondary btn-small im-file-btn">
        <Icon name="upload" :size="13" /> 选择文件（.json / .csv）
        <input type="file" accept=".json,.csv,application/json,text/csv" class="im-file-input" @change="onFilePicked" />
      </label>
      <span class="im-file-name">{{ fileName || '未选择文件' }}</span>
      <button class="btn btn-ghost btn-small" @click="exportChapter">导出当前章节（JSON）</button>
    </div>
    <textarea v-model="text" class="textarea mono" rows="8" placeholder='[{"type":"single","question":"...","options":["A","B","C","D"],"answer":0,"tag":"知识点","explanation":"解析..."}]'></textarea>

    <div v-if="validateState.kind === 'ok'" class="im-status ok"><Icon name="check" :size="13" /> {{ validateState.source === 'csv' ? 'CSV' : 'JSON' }} 格式正确，共 {{ validateState.count }} 道题目</div>
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
import { parseJsonQuestions, parseCsvQuestions, dedupeQuestions, exportQuestionsJson, downloadTextFile } from '../../../services/importExport'

const ui = useUiStore()
const data = useDataStore()
const text = ref('')
const error = ref('')
const mode = ref('append')
const fileName = ref('')
const typeMap = { single: '单选', judge: '判断', term: '名词解释', short: '简答' }

watch(() => ui.importOpen, (open) => {
  if (open) { text.value = ''; error.value = ''; mode.value = 'append'; fileName.value = '' }
})

function close() { ui.closeImport() }

function parseQuestions() {
  const raw = text.value.trim()
  if (!raw) return null
  // 自动识别：以 [ 或 { 开头按 JSON；否则按 CSV（P3.2）
  const looksJson = raw[0] === '[' || raw[0] === '{'
  const qs = looksJson ? parseJsonQuestions(raw) : parseCsvQuestions(raw)
  if (!qs || qs.length === 0) throw new Error('没有有效的题目')
  return qs
}

// 实时校验状态：防抖解析，避免大段粘贴时每键都整段 JSON.parse 卡顿
const validateState = ref({ kind: 'idle' })
let validateTimer = null
function computeValidate() {
  if (!text.value.trim()) return { kind: 'idle' }
  try {
    const qs = parseQuestions()
    const raw = text.value.trim()
    return { kind: 'ok', count: qs.length, preview: qs.slice(0, 3), source: (raw[0] === '[' || raw[0] === '{') ? 'json' : 'csv' }
  } catch (e) {
    return { kind: 'err', error: e.message }
  }
}
watch(text, () => {
  if (validateTimer) clearTimeout(validateTimer)
  validateTimer = setTimeout(() => { validateState.value = computeValidate() }, 250)
})

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

function onFilePicked(e) {
  const fp = e.target && e.target.files && e.target.files[0]
  if (!fp) return
  fileName.value = fp.name
  const reader = new FileReader()
  reader.onload = () => { text.value = String(reader.result || '') }
  reader.onerror = () => { error.value = '文件读取失败' }
  reader.readAsText(fp)
  e.target.value = '' // 允许重复选择同一文件
}

function exportChapter() {
  const ch = data.getCh()
  if (!ch || !ch.questions || ch.questions.length === 0) { ui.toast('当前章节没有可导出的题目', 'err'); return }
  const json = exportQuestionsJson(ch.questions, { chapterName: ch.name, chapterId: ch.id, exportedAt: new Date().toISOString() })
  const stamp = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  downloadTextFile('Qbao_' + (ch.name || '章节') + '_' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '.json', json)
  ui.toast('已导出 ' + ch.questions.length + ' 道题目（JSON，可再导入）', 'ok')
}

function confirm() {
  error.value = ''
  try {
    let qs = parseQuestions()
    qs.forEach((q, i) => { if (!q.id) q.id = i + 1 })
    const ch = data.getCh()
    if (!ch) throw new Error('请先选择章节')
    // P3.2 幂等去重：与 ch.questions 签名相同的题目直接跳过（不产生重复题目）
    const dedup = dedupeQuestions(ch.questions || [], qs)
    const added = dedup.list
    if (added.length === 0) {
      close()
      ui.toast('全部题目已存在，未导入任何新题（去重跳过 ' + dedup.skipped + ' 道）', 'info')
      return
    }
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
    data.createQuizSetForChapter(added, ch.id)
    data.saveState()
    close()
    const skipNote = dedup.skipped > 0 ? '（重复跳过 ' + dedup.skipped + ' 道）' : ''
    ui.toast('已导入 ' + added.length + ' 道题目' + skipNote + (mode.value === 'replace' ? '（原题目已备份）' : ''), 'ok')
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
.im-file-btn input.im-file-input { display: none; }
.im-file-btn { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.im-file-name { font-size: var(--fs-xs); color: var(--text-muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>