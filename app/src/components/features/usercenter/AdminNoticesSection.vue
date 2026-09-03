<template>
  <div class="subsection">
    <div class="subsection-head">
      <h4><Icon name="bell" :size="16" />消息管理</h4>
      <div class="head-actions">
        <button class="btn btn-primary btn-small" @click="openNoticeEditor(null)">＋ 新增消息</button>
        <button class="btn btn-secondary btn-small" @click="users.loadNotices()"><Icon name="refresh" :size="13" /> 刷新</button>
      </div>
    </div>

    <div v-if="editorOpen" class="notice-editor">
      <label class="field-label">内容（最多500字）</label>
      <textarea v-model="editorForm.content" class="textarea" maxlength="500" placeholder="输入消息内容"></textarea>
      <div class="editor-grid">
        <div>
          <label class="field-label">类型</label>
          <select v-model="editorForm.type" class="select">
            <option value="tip">提示 (tip)</option>
            <option value="notice">通知 (notice)</option>
            <option value="warning">警告 (warning)</option>
            <option value="chat">闲聊 (chat)</option>
          </select>
        </div>
        <div>
          <label class="field-label">链接（可选）</label>
          <input v-model="editorForm.link" class="input" type="text" placeholder="https://...">
        </div>
        <div>
          <label class="field-label">过期日期（可选）</label>
          <input v-model="editorForm.expire_at" class="input" type="date">
        </div>
        <div>
          <label class="field-label">展示时长(秒)</label>
          <input v-model.number="editorForm.durationSeconds" class="input" type="number" min="2" max="15" step="0.5">
        </div>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-secondary btn-small" @click="closeNoticeEditor">取消</button>
        <button class="btn btn-success btn-small" @click="submitNotice">保存</button>
      </div>
    </div>

    <div v-if="users.noticesLoading" class="loading">加载中...</div>
    <div v-else-if="users.notices.length === 0" class="empty">暂无消息，点击"新增消息"添加</div>
    <div v-else class="notice-table">
      <div class="notice-row notice-head">
        <span class="col-content">内容</span><span class="col-type">类型</span><span class="col-dur">时长</span>
        <span class="col-status">状态</span><span class="col-expire">过期时间</span><span class="col-actions">操作</span>
      </div>
      <div v-for="n in users.notices" :key="n.id" class="notice-row" :class="{ disabled: !n.enabled }">
        <span class="col-content" :title="n.content">{{ n.content }}</span>
        <span class="col-type" :style="{ color: typeOf(n).color }"><Icon :name="typeOf(n).icon" :size="12" /> {{ n.type }}</span>
        <span class="col-dur">{{ durationOf(n) }}</span>
        <span class="col-status">
          <button class="toggle-link" @click="users.toggleNoticeRow(n.id)">{{ n.enabled ? '停用' : '启用' }}</button>
        </span>
        <span class="col-expire">{{ expireOf(n) }}</span>
        <span class="col-actions">
          <button class="mini-btn" @click="openNoticeEditor(n)">编辑</button>
          <button class="mini-btn danger" @click="users.removeNotice(n.id)">删除</button>
        </span>
      </div>
    </div>
    <p class="sort-tip">拖拽排序功能将在后续版本添加</p>
  </div>
</template>

<script setup>
// P2.2：管理员公告管理区块（自 AdminTab.vue 拆出）— 状态走 users store
import { ref } from 'vue'
import { useUsersStore } from '../../../stores/users'
import { useUiStore } from '../../../stores/ui'
import Icon from '../../ui/Icon.vue'

const users = useUsersStore()
const ui = useUiStore()

const NOTICE_TYPES = {
  tip: { icon: 'info', color: 'var(--color-info)' },
  notice: { icon: 'bell', color: 'var(--color-warning)' },
  warning: { icon: 'warning', color: 'var(--color-danger)' },
  chat: { icon: 'star', color: 'var(--color-success)' }
}

const editorOpen = ref(false)
const editingNotice = ref(null)
const editorForm = ref({ content: '', type: 'notice', link: '', expire_at: '', durationSeconds: 4 })

function typeOf(n) { return NOTICE_TYPES[n.type] || NOTICE_TYPES.notice }
function durationOf(n) { return n.duration ? (n.duration / 1000) + 's' : '4s' }
function expireOf(n) { return n.expire_at ? new Date(n.expire_at).toLocaleDateString('zh-CN') : '永久' }

function openNoticeEditor(n) {
  editingNotice.value = n || null
  editorForm.value = {
    content: n ? (n.content || '') : '',
    type: n ? (n.type || 'notice') : 'notice',
    link: n ? (n.link || '') : '',
    expire_at: n && n.expire_at ? n.expire_at.substring(0, 10) : '',
    durationSeconds: n && n.duration ? Math.round(n.duration / 1000) : 4
  }
  editorOpen.value = true
}
function closeNoticeEditor() { editorOpen.value = false; editingNotice.value = null }

async function submitNotice() {
  const content = (editorForm.value.content || '').trim()
  if (!content) { ui.toast('内容不能为空', 'err'); return }
  const ok = await users.saveNotice({
    id: editingNotice.value ? editingNotice.value.id : null,
    content,
    type: editorForm.value.type,
    link: (editorForm.value.link || '').trim(),
    expire_at: editorForm.value.expire_at,
    durationSeconds: editorForm.value.durationSeconds || 4
  })
  if (ok) closeNoticeEditor()
}
</script>

<style scoped>
.subsection { display: flex; flex-direction: column; gap: var(--space-md); }
.subsection-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
.subsection-head h4 { margin: 0; font-size: var(--fs-md); font-weight: 600; display: flex; align-items: center; gap: var(--space-sm); }
.head-actions { display: flex; gap: var(--space-sm); }
.loading { text-align: center; color: var(--text-muted); padding: var(--space-lg); font-size: var(--fs-sm); }
.empty { text-align: center; color: var(--text-muted); padding: var(--space-lg); font-size: var(--fs-sm); }
.sort-tip { font-size: var(--fs-xs); color: var(--text-muted); }
.notice-editor {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  background: var(--surface-bg);
}
.field-label { display: block; font-size: var(--fs-xs); color: var(--text-secondary); margin-bottom: var(--space-xs); }
.editor-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-md); }
.notice-table { border: 1px solid var(--border-light); border-radius: var(--radius-md); overflow: hidden; }
.notice-row { display: flex; align-items: center; padding: var(--space-sm) var(--space-md); border-bottom: 1px solid var(--border-light); font-size: var(--fs-sm); }
.notice-row:last-child { border-bottom: none; }
.notice-row.disabled { opacity: 0.6; background: var(--surface-bg); }
.notice-head { background: var(--surface-bg); font-size: var(--fs-xs); color: var(--text-muted); }
.col-content { flex: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-type { width: 110px; flex-shrink: 0; display: flex; align-items: center; gap: 4px; }
.col-dur { width: 52px; text-align: center; font-size: var(--fs-xs); color: var(--text-muted); flex-shrink: 0; }
.col-status { width: 56px; text-align: center; flex-shrink: 0; }
.col-expire { width: 96px; font-size: var(--fs-xs); color: var(--text-muted); flex-shrink: 0; }
.col-actions { width: 110px; display: flex; gap: var(--space-xs); justify-content: flex-end; flex-shrink: 0; }
.toggle-link { color: var(--color-success); font-size: var(--fs-xs); cursor: pointer; }
.toggle-link:hover { text-decoration: underline; }
.mini-btn {
  font-size: var(--fs-xs);
  padding: 2px 8px;
  cursor: pointer;
  border: 1px solid var(--border-default);
  background: var(--surface-card);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.mini-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.mini-btn.danger { border-color: var(--color-danger); color: var(--color-danger); }
.mini-btn.danger:hover { background: var(--color-danger-light); }
</style>
