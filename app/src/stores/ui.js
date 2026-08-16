// UI 状态：侧栏/视图/弹窗/toast
import { defineStore } from 'pinia'

let toastSeq = 0

export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarOpen: false,
    activeScreen: 'start',
    authOpen: false,
    settingsOpen: false,
    settingsTab: 'personalize',
    userCenterOpen: false,
    toasts: []
  }),
  actions: {
    toggleSidebar() { this.sidebarOpen = !this.sidebarOpen },
    closeSidebar() { this.sidebarOpen = false },
    showScreen(name) { this.activeScreen = name; this.closeSidebar() },
    openAuth() { this.authOpen = true },
    closeAuth() { this.authOpen = false },
    openSettings(tab) { this.settingsOpen = true; if (tab) this.settingsTab = tab },
    closeSettings() { this.settingsOpen = false },
    setSettingsTab(tab) { this.settingsTab = tab },
    openUserCenter() { this.userCenterOpen = true },
    closeUserCenter() { this.userCenterOpen = false },
    toast(message, type = 'info', duration = 4000) {
      const id = ++toastSeq
      this.toasts.push({ id, message, type })
      setTimeout(() => { this.dismissToast(id) }, duration)
    },
    dismissToast(id) {
      const idx = this.toasts.findIndex((t) => t.id === id)
      if (idx >= 0) this.toasts.splice(idx, 1)
    }
  }
})
