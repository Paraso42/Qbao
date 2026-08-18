<!--
  UserCenterModal.vue — 用户中心弹窗（自 legacy users.js openUserCenterModal/switchUcModalTab）
  左侧栏：头像 + 名称 + nav（账号/数据/文件/成就/管理员专区/退出登录），右侧内容按 tab 切换。
-->
<template>
  <Modal :open="ui.userCenterOpen" :wide="true" :closable="true" @close="ui.closeUserCenter">
    <div class="uc-layout">
      <aside class="uc-sidebar">
        <div class="uc-profile">
          <div v-if="avatarUrl && !avatarBroken" class="uc-avatar"><img :src="avatarUrl" alt="" @error="avatarBroken = true"></div>
          <div v-else class="uc-avatar uc-avatar--initial">{{ initial }}</div>
          <div class="ucm-user-info">
            <div class="ucm-name">{{ displayName }}</div>
            <div class="ucm-username">@{{ user.user && user.user.username }}</div>
          </div>
        </div>
        <nav class="uc-nav">
          <button
            v-for="item in navItems"
            :key="item.id"
            class="ucm-nav-item"
            :class="{ active: users.activeTab === item.id }"
            @click="users.setTab(item.id)"
          >
            <Icon :name="item.icon" :size="16" />
            <span>{{ item.label }}</span>
          </button>
        </nav>
        <button class="ucm-nav-item ucm-logout" @click="onLogout">
          <Icon name="logout" :size="16" />
          <span>退出登录</span>
        </button>
      </aside>

      <section class="uc-content">
        <AccountTab v-if="users.activeTab === 'account'" />
        <DataTab v-else-if="users.activeTab === 'data'" />
        <FilesTab v-else-if="users.activeTab === 'files'" />
        <AchievementsTab v-else-if="users.activeTab === 'achievements'" />
        <AdminTab v-else-if="users.activeTab === 'admin'" />
        <AccountTab v-else />
      </section>
    </div>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../../ui/Modal.vue'
import Icon from '../../ui/Icon.vue'
import { useUiStore } from '../../../stores/ui'
import { useUserStore } from '../../../stores/user'
import { useUsersStore } from '../../../stores/users'
import AccountTab from './AccountTab.vue'
import DataTab from './DataTab.vue'
import FilesTab from './FilesTab.vue'
import AchievementsTab from './AchievementsTab.vue'
import AdminTab from './AdminTab.vue'
import { resolveMediaUrl } from '../../../services/utils'

const ui = useUiStore()
const user = useUserStore()
const users = useUsersStore()

const avatarUrl = computed(() => resolveMediaUrl((user.user && (user.user.avatarUrl || user.user.avatar)) || ''))
const avatarBroken = ref(false)
watch(avatarUrl, () => { avatarBroken.value = false })
const displayName = computed(() => (user.user && (user.user.displayName || user.user.username)) || '用户')
const initial = computed(() => displayName.value.charAt(0).toUpperCase())

const navItems = computed(() => {
  const items = [
    { id: 'account', label: '账号管理', icon: 'user' },
    { id: 'data', label: '数据管理', icon: 'download' },
    { id: 'files', label: '文件管理', icon: 'folder' },
    { id: 'achievements', label: '成就', icon: 'trophy' }
  ]
  if (users.isAdmin) items.push({ id: 'admin', label: '管理员专区', icon: 'users' })
  return items
})

async function onLogout() {
  const ok = await ui.openConfirm('退出登录', '确定退出登录？数据将保留在本地。', '退出')
  if (!ok) return
  user.logout()
  ui.closeUserCenter()
  ui.toast('已退出登录', 'info')
}

// 打开时回到账号 tab（同 legacy 每次打开默认账号页）
watch(() => ui.userCenterOpen, (open) => { if (open) users.resetTabs() })
</script>

<style scoped>
.uc-layout {
  display: flex;
  height: min(72vh, 640px);
  min-height: 420px;
  margin: calc(-1 * var(--space-2xl));
}
.uc-sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-light);
  background: var(--surface-bg);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  overflow: hidden;
}
.uc-profile {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-lg);
  border-bottom: 1px solid var(--border-light);
}
.uc-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.uc-avatar img { width: 100%; height: 100%; object-fit: cover; }
.uc-avatar--initial {
  background: var(--gradient-primary);
  color: #fff;
  font-weight: 700;
  font-size: var(--fs-lg);
}
.ucm-user-info { flex: 1; min-width: 0; }
.ucm-name { font-size: var(--fs-base); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ucm-username { font-size: var(--fs-xs); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uc-nav {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm) 0;
  display: flex;
  flex-direction: column;
}
.ucm-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  cursor: pointer;
  font-size: var(--fs-base);
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
  min-height: 40px;
  text-align: left;
  border-left: 3px solid transparent;
}
.ucm-nav-item:hover { background: var(--surface-hover); color: var(--text-primary); }
.ucm-nav-item.active {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-weight: 600;
  border-left-color: var(--color-primary);
}
.ucm-logout { color: var(--color-danger); border-top: 1px solid var(--border-light); }
.ucm-logout:hover { background: var(--color-danger-light); color: var(--color-danger); }

.uc-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--space-2xl);
  background: var(--surface-card);
  border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
}

@media (max-width: 768px) {
  .uc-layout { flex-direction: column; height: auto; margin: calc(-1 * var(--space-lg)); }
  .uc-sidebar {
    width: 100%;
    flex-direction: column;
    border-right: none;
    border-bottom: 1px solid var(--border-light);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
  .uc-profile { padding: var(--space-md) var(--space-lg); }
  .uc-nav {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    padding: var(--space-xs) var(--space-sm);
  }
  .ucm-nav-item {
    white-space: nowrap;
    border-left: none;
    border-bottom: 2px solid transparent;
    padding: 9px 12px;
    flex-shrink: 0;
  }
  .ucm-nav-item.active { border-bottom-color: var(--color-primary); }
  .ucm-logout { border-top: none; border-left: 1px solid var(--border-light); margin-left: var(--space-sm); }
  .uc-content { padding: var(--space-lg); border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
}
</style>
