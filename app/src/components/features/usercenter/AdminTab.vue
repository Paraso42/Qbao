<!--
  AdminTab.vue — 管理员专区（自 legacy users.js renderAdminPage/adminOpenSubSection/loadAdminUsers
    /adminViewUser/adminToggleBan + notices.js loadAdminNotices/renderNoticeList/saveNotice 等）
  用户管理（分页/搜索/角色筛选/封禁/重置密码/统计卡）+ 公告管理（CRUD，前五项）。
-->
<template>
  <div v-if="!users.isAdmin" class="no-perm">此功能仅限管理员使用</div>

  <template v-else>
    <!-- 子区块选择卡 -->
    <div v-if="!users.adminSection" class="admin-cards">
      <button class="admin-card" @click="openSection('notices')">
        <div class="admin-card-icon"><Icon name="bell" :size="26" /></div>
        <div class="admin-card-name">消息管理</div>
        <div class="admin-card-desc">管理顶栏滚动通知</div>
      </button>
      <button class="admin-card" @click="openSection('users')">
        <div class="admin-card-icon"><Icon name="users" :size="26" /></div>
        <div class="admin-card-name">用户管理</div>
        <div class="admin-card-desc">查看、修改、封禁用户</div>
      </button>
      <button class="admin-card" @click="openSection('points')">
        <div class="admin-card-icon"><Icon name="coins" :size="26" /></div>
        <div class="admin-card-name">积分管理</div>
        <div class="admin-card-desc">查看余额与台账、手动调整</div>
      </button>
    </div>

    <!-- ===== 公告管理 ===== -->
    <div v-else-if="users.adminSection === 'notices'" class="subsection">
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

    <!-- ===== 用户管理 ===== -->
    <div v-else-if="users.adminSection === 'users'" class="subsection">
      <div class="subsection-head">
        <h4><Icon name="users" :size="16" />用户管理</h4>
        <div class="head-actions">
          <button class="btn btn-secondary btn-small" @click="users.loadUsers()"><Icon name="refresh" :size="13" /> 刷新</button>
        </div>
      </div>

      <!-- 用户详情 -->
      <div v-if="users.viewedUser" class="user-detail">
        <button class="btn btn-text btn-small" @click="users.closeViewedUser()">← 返回列表</button>
        <div class="ud-header">
          <div class="ud-avatar-wrap">
            <div v-if="avatarUrlOf(users.viewedUser)" class="ud-avatar"><img :src="avatarUrlOf(users.viewedUser)" alt=""></div>
            <div v-else class="ud-avatar ud-avatar--initial">{{ initialOf(users.viewedUser) }}</div>
            <span class="ud-dot" :class="users.viewedUser.isOnline ? 'on' : 'off'"></span>
          </div>
          <div class="ud-name">
            <div class="ud-display">{{ users.viewedUser.displayName || users.viewedUser.username }}</div>
            <div class="ud-username">@{{ users.viewedUser.username }}</div>
          </div>
          <div class="ud-badges">
            <span class="pill" :class="users.viewedUser.role === 'admin' ? 'role-admin' : 'role-user'">{{ users.viewedUser.role === 'admin' ? '管理员' : '普通用户' }}</span>
            <span class="pill" :class="users.viewedUser.isBanned ? 'ban-badge' : 'ok-badge'">{{ users.viewedUser.isBanned ? '已封禁' : '正常' }}</span>
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat-card"><div class="stat-num">{{ udStats.subjects }}</div><div class="stat-label">科目</div></div>
          <div class="stat-card"><div class="stat-num">{{ udStats.chapters }}</div><div class="stat-label">章节</div></div>
          <div class="stat-card"><div class="stat-num">{{ udStats.totalQuestions }}</div><div class="stat-label">题目</div></div>
          <div class="stat-card"><div class="stat-num small">{{ udStats.totalBackups }}</div><div class="stat-label">备份</div></div>
          <div class="stat-card"><div class="stat-num small">{{ udStats.totalShares }}</div><div class="stat-label">分享</div></div>
          <div class="stat-card"><div class="stat-num small">{{ udStats.totalAiRequests }}</div><div class="stat-label">AI出题</div></div>
          <div class="stat-card"><div class="stat-num small">{{ users.viewedUser.storagePoints ?? 0 }}</div><div class="stat-label">积分</div></div>
        </div>

        <div class="ud-meta">
          <div>创建时间: {{ fmtTime(users.viewedUser.createdAt) }}</div>
          <div v-if="users.viewedUser.lastLoginAt">最后登录: {{ fmtTime(users.viewedUser.lastLoginAt) }}</div>
        </div>

        <div class="ud-actions">
          <div class="reset-pw">
            <input v-model="resetPw" class="input" type="text" placeholder="新密码 (至少6位)">
            <button class="btn btn-primary btn-small" @click="onResetPw">设置</button>
          </div>
          <button class="btn btn-small" :class="users.viewedUser.isBanned ? 'btn-success' : 'btn-danger'" @click="users.toggleBan(users.viewedUser)">
            {{ users.viewedUser.isBanned ? '解封' : '封禁' }}
          </button>
        </div>
      </div>

      <template v-else>
        <div class="user-toolbar">
          <input
            v-model="users.userSearch"
            class="input search-input"
            type="text"
            placeholder="搜索用户名..."
            @keydown.enter="users.setSearch(users.userSearch)"
          >
          <button class="btn btn-primary btn-small" @click="users.setSearch(users.userSearch)">搜索</button>
          <select :value="users.roleFilter" class="select role-select" @change="onRoleFilterChange">
            <option value="">全部角色</option>
            <option value="admin">管理员</option>
            <option value="user">普通用户</option>
          </select>
        </div>

        <div class="stats-grid">
          <div v-for="c in statCards" :key="c.label" class="stat-card">
            <div class="stat-num">{{ c.value }}</div>
            <div class="stat-label">{{ c.label }}</div>
          </div>
        </div>

        <div v-if="users.usersLoading" class="loading">加载中...</div>
        <div v-else-if="users.users.length === 0" class="empty">暂无用户</div>
        <div v-else class="user-list">
          <div v-for="u in users.users" :key="u.id" class="user-row" @click="users.viewUser(u.id)">
            <div class="ur-avatar-wrap">
              <div v-if="avatarUrlOf(u)" class="ur-avatar"><img :src="avatarUrlOf(u)" alt=""></div>
              <div v-else class="ur-avatar ur-avatar--initial">{{ initialOf(u) }}</div>
              <span class="ur-dot" :class="u.isOnline ? 'on' : 'off'"></span>
            </div>
            <div class="ur-info">
              <div class="ur-name">{{ u.displayName || u.username }} <span class="ur-username">@{{ u.username }}</span></div>
              <div class="ur-badges">
                <span class="pill" :class="u.role === 'admin' ? 'role-admin' : 'role-user'">{{ u.role === 'admin' ? '管理员' : '普通' }}</span>
                <span v-if="u.isBanned" class="pill ban-badge">已封禁</span>
                <span class="pill points-pill"><Icon name="coins" :size="11" /> {{ u.storagePoints ?? 0 }}</span>
                <span class="ur-last">{{ u.lastLoginAt ? '最后登录: ' + fmtTime(u.lastLoginAt) : '从未登录' }}</span>
              </div>
            </div>
            <button class="btn btn-small ban-btn" :class="u.isBanned ? 'btn-success' : 'btn-danger'" @click.stop="users.toggleBan(u)">
              {{ u.isBanned ? '解封' : '封禁' }}
            </button>
          </div>
        </div>

        <div class="pager">
          <button class="btn btn-secondary btn-small" :disabled="users.page <= 1" @click="users.setPage(users.page - 1)">上一页</button>
          <span class="pager-info">第 {{ users.page }} / {{ users.totalPages }} 页 · 共 {{ users.totalUsers }} 人</span>
          <button class="btn btn-secondary btn-small" :disabled="users.page >= users.totalPages" @click="users.setPage(users.page + 1)">下一页</button>
        </div>
      </template>
    </div>

    <!-- ===== 积分管理 ===== -->
    <div v-else-if="users.adminSection === 'points'" class="subsection">
      <div class="subsection-head">
        <h4><Icon name="coins" :size="16" />积分管理</h4>
        <div class="head-actions">
          <button class="btn btn-secondary btn-small" @click="loadPointsUser()"><Icon name="refresh" :size="13" /> 刷新</button>
        </div>
      </div>

      <div class="points-toolbar">
        <input v-model="pointsUserId" class="input search-input" type="text" placeholder="输入用户 ID 或用户名..."
               @keydown.enter="loadPointsUser">
        <button class="btn btn-primary btn-small" @click="loadPointsUser">查询</button>
        <span v-if="pointsTarget" class="points-target">@{{ pointsTarget.username }} 当前余额 <b>{{ pointsTarget.storagePoints }}</b></span>
      </div>

      <div v-if="pointsError" class="empty">{{ pointsError }}</div>

      <template v-if="pointsTarget">
        <!-- 调整表单 -->
        <div class="adjust-box">
          <div class="adjust-row">
            <input v-model.number="adjustDelta" class="input adjust-input" type="number" placeholder="±数量（如 10 或 -5）">
            <input v-model="adjustNote" class="input adjust-note" type="text" placeholder="调整原因（必填，最多500字）" maxlength="500">
            <button class="btn btn-primary btn-small" :disabled="adjusting" @click="onAdjust">调整</button>
          </div>
          <p class="adjust-tip">权益调整实时生效并写入台账（reason=admin_adjust）。余额最终不能为负。</p>
        </div>

        <!-- 台账 -->
        <h4 class="ledger-title"><Icon name="file" :size="16" />积分台账</h4>
        <div v-if="pointsLedgerLoading" class="loading">加载中...</div>
        <template v-else>
          <div v-if="pointsLedger.length > 0" class="ledger-list">
            <div v-for="item in pointsLedger" :key="item.id" class="ledger-row">
              <div class="ledger-info">
                <div class="ledger-reason">{{ reasonLabel(item.reason) }} <span v-if="item.note" class="ledger-note">{{ item.note }}</span></div>
                <div class="ledger-time">{{ fmtTime(item.createdAt) }} · 余额 {{ item.balanceAfter }}</div>
              </div>
              <span class="ledger-delta" :class="item.delta >= 0 ? 'earn' : 'spend'">{{ item.delta >= 0 ? '+' : '' }}{{ item.delta }}</span>
            </div>
          </div>
          <p v-else class="empty">该用户暂无积分记录</p>
        </template>
      </template>
      <p v-else class="empty">输入用户 ID 或用户名查询其积分余额与台账</p>
    </div>
  </template>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useUsersStore } from '../../../stores/users'
import Icon from '../../ui/Icon.vue'
import { useUiStore } from '../../../stores/ui'
import { usePointsStore } from '../../../stores/points'
import { resolveMediaUrl } from '../../../services/utils'
import * as pointsApi from '../../../services/pointsApi'
import { getUser as usersApi_getUser, getUsers as usersApi_getUsers } from '../../../services/usersApi'

const users = useUsersStore()
const ui = useUiStore()
const points = usePointsStore()

const NOTICE_TYPES = {
  tip: { icon: 'info', color: 'var(--color-info)' },
  notice: { icon: 'bell', color: 'var(--color-warning)' },
  warning: { icon: 'warning', color: 'var(--color-danger)' },
  chat: { icon: 'star', color: 'var(--color-success)' }
}

const editorOpen = ref(false)
const editingNotice = ref(null)
const editorForm = ref({ content: '', type: 'notice', link: '', expire_at: '', durationSeconds: 4 })
const resetPw = ref('')

function openSection(section) {
  users.adminSection = section
  if (section === 'users') users.loadUsers()
  else if (section === 'notices') users.loadNotices()
}

function onRoleFilterChange(e) { users.setRoleFilter(e.target.value) }

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

const statCards = computed(() => {
  const s = users.stats || {}
  const userCount = s.userCount ?? ((s.totalUsers != null && s.adminCount != null) ? s.totalUsers - s.adminCount : 0)
  return [
    { label: '总用户', value: s.totalUsers ?? 0 },
    { label: '管理员', value: s.adminCount ?? 0 },
    { label: '普通用户', value: userCount },
    { label: '封禁', value: s.bannedCount ?? 0 },
    { label: '在线', value: s.onlineNow ?? 0 },
    { label: '今日登录', value: s.todayLogins ?? 0 }
  ]
})

const udStats = computed(() => {
  const u = users.viewedUser
  const s = (u && u.stats) || {}
  return {
    subjects: s.subjects ?? 0,
    chapters: s.chapters ?? 0,
    totalQuestions: s.totalQuestions ?? 0,
    totalBackups: s.totalBackups ?? 0,
    totalShares: s.totalShares ?? 0,
    totalAiRequests: s.totalAiRequests ?? 0
  }
})

function avatarUrlOf(u) { return resolveMediaUrl((u && (u.avatarUrl || u.avatar)) || '') }
function initialOf(u) { return ((u && (u.displayName || u.username)) || '?').charAt(0).toUpperCase() }
function fmtTime(ts) { try { return new Date(ts).toLocaleString('zh-CN') } catch (e) { return '' } }

// —— 积分管理 ——
const pointsUserId = ref('')
const pointsTarget = ref(null)
const pointsError = ref('')
const pointsLedger = ref([])
const pointsLedgerLoading = ref(false)
const adjustDelta = ref(0)
const adjustNote = ref('')
const adjusting = ref(false)

function reasonLabel(reason) {
  const labels = (points.rules && points.rules.reasonLabels) || {}
  return labels[reason] || reason
}

async function loadPointsUser() {
  const input = (pointsUserId.value || '').trim()
  if (!input) { ui.toast('请输入用户 ID 或用户名', 'err'); return }
  pointsError.value = ''
  pointsTarget.value = null
  pointsLedger.value = []
  await points.loadRules()
  try {
    let u = null
    if (/^\d+$/.test(input)) {
      // ID 精确查询
      const r = await usersApi_getUser(Number(input))
      if (r && r.user) u = r.user
      else { pointsError.value = '未找到该用户'; return }
    } else {
      // 用户名搜索：取第一页匹配项
      const r = await usersApi_getUsers({ search: input, limit: 20 })
      const list = (r && r.users) || []
      const hit = list.find((x) => x.username === input || (x.displayName || '').toLowerCase() === input.toLowerCase())
      u = hit || list[0] || null
      if (!u) { pointsError.value = '未找到该用户'; return }
    }
    pointsTarget.value = u
    await loadPointsLedger(u.id)
  } catch (e) {
    pointsError.value = e.message || '查询失败'
  }
}

async function loadPointsLedger(uid) {
  pointsLedgerLoading.value = true
  try {
    const r = await pointsApi.adminGetUserLedger(uid, { page: 1, limit: 30 })
    pointsLedger.value = (r && r.items) || []
  } catch (e) {
    ui.toast('加载台账失败: ' + e.message, 'err')
  } finally {
    pointsLedgerLoading.value = false
  }
}

async function onAdjust() {
  const delta = Math.round(Number(adjustDelta.value) || 0)
  const note = (adjustNote.value || '').trim()
  if (delta === 0) { ui.toast('调整数量不能为 0', 'err'); return }
  if (!note) { ui.toast('请填写调整原因', 'err'); return }
  const ok = await ui.openConfirm('积分调整', '为用户 @' + pointsTarget.value.username + ' ' + (delta > 0 ? '增加' : '扣除') + ' ' + Math.abs(delta) + ' 积分？原因：' + note, '确认调整')
  if (!ok) return
  adjusting.value = true
  try {
    const r = await pointsApi.adminAdjustPoints(pointsTarget.value.id, delta, note)
    ui.toast('调整成功，当前余额 ' + (r && r.balance != null ? r.balance : '') , 'ok')
    pointsTarget.value = { ...pointsTarget.value, storagePoints: r ? r.balance : pointsTarget.value.storagePoints }
    adjustDelta.value = 0
    adjustNote.value = ''
    await loadPointsLedger(pointsTarget.value.id)
  } catch (e) {
    ui.toast('调整失败: ' + e.message, 'err')
  } finally {
    adjusting.value = false
  }
}

async function onResetPw() {
  const pw = resetPw.value
  if (!pw || pw.length < 6) { ui.toast('密码至少6位', 'err'); return }
  const ok = await ui.openConfirm('重置密码', '确定要为用户 #' + users.viewedUser.id + ' 重置密码吗？', '重置')
  if (!ok) return
  const done = await users.resetPassword(users.viewedUser.id, pw)
  if (done) resetPw.value = ''
}
</script>

<style scoped>
.no-perm { text-align: center; color: var(--color-danger); font-size: var(--fs-base); padding: var(--space-xl); }

.admin-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-lg); }
.admin-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xl);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  cursor: pointer;
  text-align: center;
  transition: border-color var(--transition-normal), box-shadow var(--transition-normal);
}
.admin-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-md); }
.admin-card-icon { font-size: 28px; }
.admin-card-name { font-size: var(--fs-md); font-weight: 600; }
.admin-card-desc { font-size: var(--fs-xs); color: var(--text-muted); }

.subsection { display: flex; flex-direction: column; gap: var(--space-md); }
.subsection-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
.subsection-head h4 { margin: 0; font-size: var(--fs-md); font-weight: 600; display: flex; align-items: center; gap: var(--space-sm); }
.head-actions { display: flex; gap: var(--space-sm); }

.loading { text-align: center; color: var(--text-muted); padding: var(--space-lg); font-size: var(--fs-sm); }
.empty { text-align: center; color: var(--text-muted); padding: var(--space-lg); font-size: var(--fs-sm); }
.sort-tip { font-size: var(--fs-xs); color: var(--text-muted); }

/* —— 公告 —— */
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

/* —— 用户 —— */
.user-toolbar { display: flex; gap: var(--space-sm); align-items: center; }
.search-input { flex: 1; }
.role-select { width: 120px; flex-shrink: 0; }

.stats-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--space-sm); }
.stat-card {
  background: var(--surface-bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md) var(--space-sm);
  text-align: center;
}
.stat-num { font-size: var(--fs-xl); font-weight: 700; color: var(--color-primary); }
.stat-num.small { font-size: var(--fs-md); }
.stat-label { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }

.user-list { display: flex; flex-direction: column; gap: var(--space-sm); }
.user-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}
.user-row:hover { border-color: var(--color-primary); background: var(--surface-bg); }
.ur-avatar-wrap, .ud-avatar-wrap { position: relative; flex-shrink: 0; }
.ur-avatar, .ud-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ud-avatar { width: 56px; height: 56px; }
.ur-avatar img, .ud-avatar img { width: 100%; height: 100%; object-fit: cover; }
.ur-avatar--initial, .ud-avatar--initial { background: var(--gradient-primary); color: #fff; font-weight: 600; }
.ur-dot, .ud-dot { position: absolute; bottom: -1px; right: -1px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--surface-card); }
.ur-dot.on, .ud-dot.on { background: var(--color-success); }
.ur-dot.off, .ud-dot.off { background: var(--text-muted); }
.ud-dot { width: 12px; height: 12px; }
.ur-info { flex: 1; min-width: 0; }
.ur-name { font-weight: 600; font-size: var(--fs-base); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ur-username { color: var(--text-muted); font-weight: 400; font-size: var(--fs-xs); }
.ur-badges { display: flex; gap: var(--space-xs); align-items: center; margin-top: 3px; flex-wrap: wrap; }
.ur-last { font-size: var(--fs-xs); color: var(--text-muted); }
.ban-btn { flex-shrink: 0; }

.pill.role-admin { background: var(--color-warning-light); color: var(--color-warning); }
.pill.role-user { background: var(--color-primary-light); color: var(--color-primary); }
.pill.ban-badge { background: var(--color-danger-light); color: var(--color-danger); }
.pill.ok-badge { background: var(--color-success-light); color: var(--color-success); }

.pager { display: flex; align-items: center; justify-content: center; gap: var(--space-md); }
.pager-info { font-size: var(--fs-sm); color: var(--text-secondary); }

/* —— 用户详情 —— */
.user-detail { display: flex; flex-direction: column; gap: var(--space-md); }
.ud-header { display: flex; align-items: center; gap: var(--space-md); }
.ud-name { flex: 1; min-width: 0; }
.ud-display { font-size: var(--fs-lg); font-weight: 700; }
.ud-username { font-size: var(--fs-sm); color: var(--text-muted); margin-top: 2px; }
.ud-badges { display: flex; gap: var(--space-sm); }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); }
.ud-meta { font-size: var(--fs-xs); color: var(--text-muted); border-top: 1px solid var(--border-light); padding-top: var(--space-md); display: flex; flex-direction: column; gap: 3px; }
.ud-actions { display: flex; align-items: center; gap: var(--space-md); justify-content: space-between; border-top: 1px solid var(--border-light); padding-top: var(--space-md); }
.reset-pw { display: flex; gap: var(--space-sm); flex: 1; }

@media (max-width: 768px) {
  .admin-cards { grid-template-columns: 1fr; }
  .stats-grid { grid-template-columns: repeat(3, 1fr); }
  .editor-grid { grid-template-columns: 1fr; }
  .notice-row { flex-wrap: wrap; gap: var(--space-xs); }
  .col-expire { width: auto; }
}
/* —— 积分管理 —— */
.points-toolbar { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
.points-toolbar .search-input { max-width: 260px; }
.points-target { font-size: var(--fs-sm); color: var(--text-secondary); }
.points-target b { color: var(--color-primary); }
.adjust-box { border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: var(--space-md); display: flex; flex-direction: column; gap: var(--space-xs); }
.adjust-row { display: flex; gap: var(--space-sm); flex-wrap: wrap; }
.adjust-input { width: 120px; }
.adjust-note { flex: 1; min-width: 180px; }
.adjust-tip { font-size: var(--fs-xs); color: var(--text-muted); }
.ledger-title { margin: var(--space-md) 0 var(--space-sm); font-size: var(--fs-md); }
.ledger-list { display: flex; flex-direction: column; gap: var(--space-xs); max-height: 360px; overflow-y: auto; padding-right: 4px; }
.ledger-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-sm) var(--space-md); border: 1px solid var(--border-light); border-radius: var(--radius-md); }
.ledger-reason { font-size: var(--fs-sm); color: var(--text-primary); }
.ledger-note { font-size: var(--fs-xs); color: var(--text-muted); margin-left: var(--space-xs); }
.ledger-time { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.ledger-delta { font-size: var(--fs-base); font-weight: 600; flex-shrink: 0; }
.ledger-delta.earn { color: var(--color-success, #2ed573); }
.ledger-delta.spend { color: var(--color-danger); }
.points-pill { background: rgba(245, 166, 35, 0.12); color: #b8860b; }
</style>