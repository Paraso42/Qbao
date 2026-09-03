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

    <!-- ===== 用户管理 ===== -->
    <!-- ===== 公告管理（P2.2 拆分：AdminNoticesSection） ===== -->
    <AdminNoticesSection v-else-if="users.adminSection === 'notices'" />
    <!-- ===== 用户管理（P2.2 拆分：AdminUsersSection） ===== -->
    <AdminUsersSection v-else-if="users.adminSection === 'users'" />

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
import AdminNoticesSection from './AdminNoticesSection.vue'
import AdminUsersSection from './AdminUsersSection.vue'
import { useUiStore } from '../../../stores/ui'
import { usePointsStore } from '../../../stores/points'
import { resolveMediaUrl } from '../../../services/utils'
import * as pointsApi from '../../../services/pointsApi'
import { getUser as usersApi_getUser, getUsers as usersApi_getUsers } from '../../../services/usersApi'

const users = useUsersStore()
const ui = useUiStore()
const points = usePointsStore()

// 子区块导航（notices 子区块由 AdminNoticesSection 渲染，仍由这里负责加载）
function openSection(section) {
  users.adminSection = section
  if (section === 'users') users.loadUsers()
  else if (section === 'notices') users.loadNotices()
}

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