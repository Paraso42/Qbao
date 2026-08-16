<!-- 侧栏：科目/章节树 + AI 开关 + 同步状态（自 legacy renderSubjectList 迁移，DeepSeek 风格） -->
<template>
  <aside id="sidebar" :class="{ 'mobile-open': ui.sidebarOpen }">
    <div id="sidebar-header">
      <h2>科目</h2>
      <button class="btn btn-primary btn-small" @click="addSubject">＋ 科目</button>
    </div>

    <div id="sidebar-body">
      <EmptyState v-if="subjects.list.length === 0" icon="book" title="暂无科目" hint="点击上方「＋ 科目」开始" />
      <div v-else class="subject-list">
        <div v-for="(s, sidx) in subjects.list" :key="s.id" class="subject-group" :class="{ collapsed: s.collapsed }">
          <div class="subject-header" :class="{ active: s.id === data.state.currentSubjectId }" @click="selectSubject(s.id)">
            <span class="subj-arrow" @click.stop="subjects.toggleCollapse(s.id)">
              <Icon name="chevron-down" :size="12" :class="{ rotated: s.collapsed }" />
            </span>
            <span class="subj-name">{{ s.name }}</span>
            <span class="subj-count tabular-nums">{{ s.chapterIds.length }}</span>
            <span class="subj-actions" @click.stop>
              <button class="subj-btn" :disabled="sidx === 0" title="置顶" @click="subjects.moveToTop(s.id)"><Icon name="arrow-up" :size="12" /></button>
              <button class="subj-btn" title="重命名" @click="renameSubject(s)"><Icon name="edit" :size="12" /></button>
              <button class="subj-btn del" title="删除" @click="deleteSubject(s)"><Icon name="trash" :size="12" /></button>
            </span>
          </div>

          <div v-if="!s.collapsed" class="chapter-list">
            <div v-for="(cid, cidx) in s.chapterIds" :key="cid">
              <div v-if="data.state.chapters[cid]" class="chapter-item" :class="{ active: cid === data.state.currentChapterId }" @click="selectChapter(cid)" @dblclick="renameChapter(cid)">
                <div class="chapter-info">
                  <span class="chapter-name">{{ data.state.chapters[cid].name }}</span>
                  <span class="chapter-count tabular-nums">{{ chapterAnswered(cid) }} 题已答</span>
                </div>
                <span class="ch-actions" @click.stop>
                  <button class="ch-btn" :disabled="cidx === 0" title="置顶" @click="subjects.moveChapterToTop(s.id, cid)"><Icon name="arrow-up" :size="11" /></button>
                  <button class="ch-btn" title="重命名" @click="renameChapter(cid)"><Icon name="edit" :size="11" /></button>
                  <button class="ch-btn del" title="删除" @click="deleteChapter(cid)"><Icon name="trash" :size="11" /></button>
                </span>
              </div>
            </div>
            <button class="btn-add-chapter" @click="addChapter(s.id)">＋ 新建章节</button>
          </div>
        </div>
      </div>
    </div>

    <div id="sidebar-footer">
      <div class="ai-row">
        <span class="ai-label"><Icon name="sparkle" :size="14" /> AI 出题</span>
        <Toggle :model-value="data.state.aiEnabled" @change="toggleAi" />
      </div>
      <div class="sync-status" :class="{ online: sync.online, syncing: sync.syncing }">
        <span class="sync-dot"></span>{{ sync.label }}
      </div>
      <div v-if="user.isOnline" class="user-row" @click="ui.openUserCenter">
        <span class="user-avatar">{{ user.shortName }}</span>
        <span class="user-name">{{ user.user.displayName || user.user.username }}</span>
      </div>
      <div v-else class="user-row" @click="ui.openAuth">
        <span class="user-avatar ghost"><Icon name="user" :size="14" /></span>
        <span class="user-name">未登录</span>
      </div>
    </div>
  </aside>
  <div class="sidebar-overlay" :class="{ active: ui.sidebarOpen }" @click="ui.toggleSidebar"></div>
</template>

<script setup>
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useDataStore } from '../../stores/data'
import { useSubjectStore } from '../../stores/subjects'
import { useUserStore } from '../../stores/user'
import { useSyncStore } from '../../stores/sync'
import { useQuizStore } from '../../stores/quiz'
import Icon from '../ui/Icon.vue'
import EmptyState from '../ui/EmptyState.vue'
import Toggle from '../ui/Toggle.vue'

const ui = useUiStore()
const data = useDataStore()
const subjects = useSubjectStore()
const user = useUserStore()
const sync = useSyncStore()
const quiz = useQuizStore()

function chapterAnswered(cid) {
  const ch = data.state.chapters[cid]
  if (!ch) return 0
  let answered = 0
  ;(ch.quizSets || []).forEach((set) => {
    if (set.userAnswers) answered += set.userAnswers.filter((a) => a !== undefined && a !== -1).length
  })
  return answered
}

async function addSubject() {
  const name = await ui.openPrompt('新建科目', '科目 ' + (Object.keys(data.state.subjects).length + 1))
  if (name) subjects.create(name)
}
async function renameSubject(s) {
  const name = await ui.openPrompt('重命名科目', s.name)
  if (name) subjects.rename(s.id, name)
}
async function deleteSubject(s) {
  const ok = await ui.openConfirm('删除科目', '删除科目「' + s.name + '」及其所有章节？', '删除')
  if (ok) subjects.remove(s.id)
}
async function addChapter(subjId) {
  const s = data.state.subjects[subjId]
  if (!s) return
  const name = await ui.openPrompt('新建章节', '章节 ' + (s.chapterIds.length + 1))
  if (name) subjects.createChapter(subjId, name)
}
async function renameChapter(cid) {
  const ch = data.state.chapters[cid]
  if (!ch) return
  const name = await ui.openPrompt('重命名章节', ch.name)
  if (name) subjects.renameChapter(cid, name)
}
async function deleteChapter(cid) {
  const ch = data.state.chapters[cid]
  if (!ch) return
  const ok = await ui.openConfirm('删除章节', '删除该章节？', '删除')
  if (ok) subjects.deleteChapter(cid)
}

function selectSubject(id) {
  subjects.select(id)
  ui.showScreen('subject-dash')
}
function selectChapter(cid) {
  subjects.switchChapter(cid)
  ui.showScreen('start')
  quiz.restoreQuizFromServer(false)
}

function toggleAi(v) {
  data.state.aiEnabled = v
  data.saveState()
  ui.toast(v ? 'AI 出题已开启' : 'AI 出题已关闭', 'info')
}
</script>

<style scoped>
#sidebar {
  width: var(--sidebar-width);
  background: var(--surface-card);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  font-size: var(--sidebar-font-size, 13px);
}
#sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-lg);
  border-bottom: 1px solid var(--border-light);
}
#sidebar-header h2 { font-size: var(--fs-md); }
#sidebar-body { flex: 1; overflow-y: auto; padding: var(--space-sm); }
.subject-list { display: flex; flex-direction: column; gap: 2px; }
.subject-group { border-radius: var(--radius-md); }
.subject-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.subject-header:hover { background: var(--surface-hover); color: var(--text-primary); }
.subject-header.active { background: var(--color-primary-light); color: var(--color-primary); }
.subj-arrow { display: flex; color: var(--text-muted); transition: transform var(--transition-fast); }
.subj-arrow .icon.rotated { transform: rotate(-90deg); }
.subj-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.subj-count { font-size: var(--fs-xs); color: var(--text-muted); background: var(--surface-hover); border-radius: var(--radius-full); padding: 0 7px; line-height: 17px; }
.subj-actions { display: none; gap: 2px; }
.subject-header:hover .subj-actions { display: inline-flex; }
.subj-btn, .ch-btn {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}
.subj-btn:hover, .ch-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.subj-btn.del:hover, .ch-btn.del:hover { color: var(--color-danger); background: var(--color-danger-light); }
.subj-btn:disabled { opacity: 0.3; cursor: default; }
.chapter-list { padding-left: var(--space-lg); display: flex; flex-direction: column; gap: 2px; }
.chapter-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 7px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.chapter-item:hover { background: var(--surface-hover); color: var(--text-primary); }
.chapter-item.active { background: var(--color-primary-light); color: var(--color-primary); font-weight: 500; }
.chapter-info { display: flex; flex-direction: column; min-width: 0; }
.chapter-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chapter-count { font-size: 11px; color: var(--text-muted); }
.ch-actions { display: none; gap: 2px; flex-shrink: 0; }
.chapter-item:hover .ch-actions { display: inline-flex; }
.btn-add-chapter {
  width: 100%;
  padding: 7px;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: var(--fs-xs);
  text-align: left;
  padding-left: 22px;
}
.btn-add-chapter:hover { background: var(--surface-hover); color: var(--color-primary); }
#sidebar-footer { border-top: 1px solid var(--border-light); padding: var(--space-md) var(--space-lg); }
.ai-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-sm); }
.ai-label { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-secondary); }
.sync-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin-bottom: var(--space-sm);
}
.sync-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--status-muted); }
.sync-status.online .sync-dot { background: var(--status-ok); }
.sync-status.syncing .sync-dot { background: var(--status-run); animation: pulse 1.2s infinite; }
@keyframes pulse { 50% { opacity: 0.4; } }
.user-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.user-row:hover { background: var(--surface-hover); }
.user-avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: var(--gradient-primary);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-sm); font-weight: 600;
  flex-shrink: 0;
}
.user-avatar.ghost { background: var(--surface-hover); color: var(--text-muted); }
.user-name { font-size: var(--fs-sm); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sidebar-overlay { display: none; }
@media (max-width: 900px) {
  #sidebar {
    position: fixed;
    left: 0;
    top: var(--topbar-height);
    height: calc(100vh - var(--topbar-height));
    z-index: 9500;
    transform: translateX(-100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  #sidebar.mobile-open { transform: translateX(0); box-shadow: var(--shadow-lg); }
  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: var(--topbar-height) 0 0 0;
    background: rgba(23, 24, 28, 0.45);
    z-index: 9400;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  .sidebar-overlay.active { opacity: 1; pointer-events: auto; }
  .subj-actions, .ch-actions { display: inline-flex; }
}
</style>
