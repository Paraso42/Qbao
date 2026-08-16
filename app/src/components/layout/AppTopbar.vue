<template>
  <header id="topbar">
    <button class="tb-icon-btn" id="sidebar-toggle" @click="ui.toggleSidebar" aria-label="菜单">☰</button>
    <span class="tb-brand">Qbao</span>
    <div class="tb-spacer"></div>
    <span class="tb-tagline" v-if="user.isOnline">在线</span>
    <button class="tb-item" v-if="!user.isOnline" @click="ui.openAuth">登录/注册</button>
    <button class="tb-item" v-else @click="ui.openUserCenter">{{ user.shortName }}</button>
    <button class="tb-item" @click="ui.openSettings">设置</button>
  </header>
</template>

<script setup>
import { useUiStore } from '../../stores/ui'
import { useUserStore } from '../../stores/user'
const ui = useUiStore()
const user = useUserStore()
</script>

<style scoped>
#topbar {
  height: var(--topbar-height);
  background: var(--surface-card);
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-lg);
  flex-shrink: 0;
}
.tb-icon-btn {
  display: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  font-size: var(--fs-lg);
  color: var(--text-secondary);
}
.tb-icon-btn:hover { background: var(--surface-hover); }
.tb-brand {
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: -0.3px;
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.tb-spacer { flex: 1; }
.tb-tagline { font-size: var(--fs-sm); color: var(--text-muted); }
.tb-item {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: var(--fs-base);
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.tb-item:hover { background: var(--surface-hover); color: var(--text-primary); }
@media (max-width: 768px) {
  .tb-icon-btn { display: inline-flex; align-items: center; justify-content: center; }
}
</style>
