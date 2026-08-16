<!-- 标签管理（三列：错题/复习/新考点，拖拽移动与合并；自 legacy strategy.js tag 部分迁移） -->
<template>
  <div class="tags-manager-v2">
    <div v-for="cat in cats" :key="cat.key" class="tag-column" :data-cat="cat.key">
      <div class="tag-col-header"><i class="cat-dot"></i>{{ cat.label }}<span v-if="tagsOf(cat.key).length" class="tag-col-count">{{ tagsOf(cat.key).length }}</span></div>
      <div class="tag-col-list" :class="{ 'drag-over': dragOverCol === cat.key, 'col-collapsed': !openCols.has(cat.key) && tagsOf(cat.key).length > 5 }"
        @dragover.prevent="onDragOver(cat.key)"
        @dragleave="dragOverCol = null"
        @drop="onDrop(cat.key, $event)">
        <span v-if="tagsOf(cat.key).length === 0" class="col-empty">{{ cat.empty }}</span>
        <span v-for="t in tagsOf(cat.key)" :key="t"
          class="tag-chip-v2" :class="'cat-' + cat.key"
          draggable="true"
          @dragstart="onDragStart(t, cat.key)"
          @dragend="onDragEnd"
          @dragover.prevent.stop
          @drop.stop="onDrop(cat.key, $event)"
          @dblclick="renameTag(cat.key, t)"
          title="双击重命名">
          <span class="tag-name">{{ t }}</span>
          <span v-if="tagMetaText(t)" class="tag-stat">{{ tagMetaText(t) }}</span>
          <span class="tag-del" @click.stop="removeTag(cat.key, t)">×</span>
        </span>
      </div>
      <button v-if="tagsOf(cat.key).length > 5" class="tag-col-toggle" @click="toggleCol(cat.key)">
        {{ openCols.has(cat.key) ? '收起' : '展开全部 ' + tagsOf(cat.key) + ' 个' }}
      </button>
      <input class="tag-col-input" :placeholder="'＋ 添加' + cat.label.replace(/标签$/, '')" :data-cat="cat.key"
        @keydown.enter="addTag(cat.key, $event.target)">
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useDataStore } from '../../../stores/data'
import { useUiStore } from '../../../stores/ui'
import {
  tagArr, addTagToCategory, removeTagFromCategory,
  moveTagBetweenColumns, mergeTagInCategory, renameTag as renameTagService
} from '../../../services/strategy'

const props = defineProps({ chapterId: { type: String, required: true } })
const data = useDataStore()
const ui = useUiStore()

const cats = [
  { key: 'error', label: '错题标签', empty: '暂无错题标签' },
  { key: 'review', label: '复习标签', empty: '暂无复习标签' },
  { key: 'new', label: '新题标签', empty: '暂无新题标签' }
]

const strategy = computed(() => data.getChStrategy(props.chapterId))
const dragTag = ref(null)
const dragCat = ref(null)
const dragOverCol = ref(null)
// 长列表折叠：每列超过 5 个标签默认折叠为滚动区，可展开
const openCols = reactive(new Set())
function toggleCol(cat) {
  if (openCols.has(cat)) openCols.delete(cat)
  else openCols.add(cat)
}

function tagsOf(cat) { return strategy.value ? tagArr(strategy.value, cat) : [] }
function tagMetaText(t) {
  const meta = strategy.value && strategy.value.tagMeta && strategy.value.tagMeta[t]
  if (!meta || !meta.totalQ) return ''
  const rate = meta.totalQ > 0 ? Math.round(meta.correct / meta.totalQ * 100) : 0
  return meta.totalQ + '题 ' + rate + '%'
}

function addTag(cat, input) {
  addTagToCategory(data.state, props.chapterId, cat, input.value)
  input.value = ''
  data.saveState()
}
function removeTag(cat, name) {
  removeTagFromCategory(data.state, props.chapterId, cat, name)
  data.saveState()
}
function onDragStart(t, cat) {
  dragTag.value = t
  dragCat.value = cat
}
function onDragEnd() {
  dragTag.value = null
  dragCat.value = null
  dragOverCol.value = null
}
function onDragOver(cat) { dragOverCol.value = cat }
async function onDrop(cat, e) {
  dragOverCol.value = null
  if (!dragTag.value || !dragCat.value) return
  const from = dragCat.value
  const dragged = dragTag.value
  // 同列合并：落在另一个标签上
  const targetChip = e.target && e.target.closest ? e.target.closest('.tag-chip-v2') : null
  if (targetChip && targetChip.dataset && targetChip.dataset.tag && targetChip.dataset.tag !== dragged && from === cat) {
    const target = targetChip.dataset.tag
    const ok = await ui.openConfirm('合并标签', '合并标签「' + dragged + '」到「' + target + '」？被合并的标签将被移除，其关联的题目归入目标标签。', '合并', { danger: true })
    if (ok) {
      mergeTagInCategory(data.state, props.chapterId, dragged, target, cat)
      data.saveState()
    }
    return
  }
  if (from !== cat) {
    moveTagBetweenColumns(data.state, props.chapterId, dragged, from, cat)
    data.saveState()
  }
}
async function renameTag(cat, name) {
  const newName = await ui.openPrompt('重命名标签', name)
  if (!newName) return
  const ok = renameTagService(data.state, props.chapterId, name, newName)
  if (ok) data.saveState()
}
</script>

<style scoped>
.tags-manager-v2 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-sm);
}
.tag-column {
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
}
.tag-col-header { font-size: var(--fs-sm); font-weight: 600; color: var(--text-secondary); padding: 4px 6px; display: flex; align-items: center; gap: 6px; }
.tag-col-count { margin-left: auto; }
.cat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.tag-column[data-cat="error"] .cat-dot { background: #EF4444; }
.tag-column[data-cat="review"] .cat-dot { background: #F59E0B; }
.tag-column[data-cat="new"] .cat-dot { background: #10B981; }
.tag-col-count { font-size: 11px; font-weight: 500; color: var(--text-muted); background: var(--surface-card); border-radius: var(--radius-full); padding: 0 7px; line-height: 17px; }
.tag-col-list { min-height: 48px; display: flex; flex-direction: column; gap: 4px; }
.tag-col-list.col-collapsed { max-height: 148px; overflow-y: auto; padding-right: 2px; }
.tag-col-list.drag-over { outline: 2px dashed var(--color-primary); outline-offset: -2px; border-radius: var(--radius-sm); }
.tag-col-toggle {
  width: 100%;
  margin-top: 6px;
  padding: 4px 8px;
  font-size: var(--fs-xs);
  color: var(--color-primary);
  border-radius: var(--radius-sm);
  text-align: center;
}
.tag-col-toggle:hover { background: var(--color-primary-light); }
.col-empty { color: var(--text-muted); font-size: var(--fs-xs); padding: 6px; }
.tag-chip-v2 {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-full);
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  font-size: var(--fs-xs);
  cursor: grab;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  user-select: none;
}
.tag-chip-v2:hover { border-color: var(--color-primary); box-shadow: var(--shadow-sm); }
.tag-chip-v2:active { cursor: grabbing; }
.tag-chip-v2.cat-error .tag-name { color: #EF4444; }
.tag-chip-v2.cat-review .tag-name { color: #F59E0B; }
.tag-chip-v2.cat-new .tag-name { color: #10B981; }
.tag-stat { color: var(--text-muted); font-size: 10px; }
.tag-del { color: var(--text-muted); cursor: pointer; font-weight: 700; padding: 0 2px; }
.tag-del:hover { color: var(--color-danger); }
.tag-col-input {
  width: 100%;
  margin-top: 6px;
  padding: 6px 10px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: var(--fs-xs);
  color: var(--text-primary);
}
.tag-col-input:focus { border-color: var(--color-primary); outline: none; background: var(--surface-card); }
@media (max-width: 768px) {
  .tags-manager-v2 { grid-template-columns: 1fr; }
}
</style>
