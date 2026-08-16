<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="toastClass(t.type)">
        <span class="toast-icon"><Icon :name="toastIcon(t.type)" :size="11" /></span>
        <span class="toast-msg">{{ t.message }}</span>
        <button class="toast-close" aria-label="关闭" @click="ui.dismissToast(t.id)"><Icon name="x" :size="12" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useUiStore } from '../../stores/ui'
import Icon from './Icon.vue'
const ui = useUiStore()
function toastClass(type) {
  if (type === 'ok' || type === 'success') return 'toast-ok'
  if (type === 'err' || type === 'error') return 'toast-err'
  if (type === 'warn') return 'toast-warn'
  return 'toast-info'
}
function toastIcon(type) {
  if (type === 'ok' || type === 'success') return 'check'
  if (type === 'err' || type === 'error') return 'x'
  if (type === 'warn') return 'warning'
  return 'info'
}
</script>
