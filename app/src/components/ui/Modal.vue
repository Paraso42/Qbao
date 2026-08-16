<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-overlay" @mousedown.self="onOverlay">
        <div class="dialog-box" :class="{ wide, fullscreen: full }" role="dialog" aria-modal="true">
          <button v-if="closable" class="dlg-close" @click="onClose" aria-label="关闭">
            <Icon name="x" :size="18" />
          </button>
          <slot></slot>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useUiStore } from '../../stores/ui'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  wide: { type: Boolean, default: false },
  full: { type: Boolean, default: false },
  closable: { type: Boolean, default: true },
  closeOnOverlay: { type: Boolean, default: true }
})
const emit = defineEmits(['close'])
const ui = useUiStore()

function onClose() { emit('close') }
function onOverlay() { if (props.closeOnOverlay) onClose() }
function onKey(e) { if (e.key === 'Escape' && props.open) onClose() }

// 浮层治理：弹窗打开时关闭侧栏抽屉，并隐藏 toast
watch(() => props.open, (v) => {
  if (v) {
    ui.closeSidebar()
    document.body.classList.add('has-dialog')
  } else {
    document.body.classList.remove('has-dialog')
  }
})

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.classList.remove('has-dialog')
})
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
}
.dialog-box {
  position: relative;
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 480px;
  max-height: 86vh;
  overflow-y: auto;
  padding: var(--space-2xl);
}
.dialog-box.wide { max-width: 760px; }
.dlg-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
}
.dlg-close:hover { background: var(--surface-hover); color: var(--text-primary); }
.dialog-enter-active, .dialog-leave-active { transition: opacity 0.2s ease; }
.dialog-enter-active .dialog-box, .dialog-leave-active .dialog-box { transition: transform 0.2s ease; }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .dialog-box, .dialog-leave-to .dialog-box { transform: translateY(12px) scale(0.98); }
@media (max-width: 768px) {
  .dialog-box { max-width: min(92vw, 420px); max-height: 88vh; padding: var(--space-xl); }
  .dialog-box.fullscreen {
    max-width: 100%;
    position: fixed;
    inset: 0;
    border-radius: 0;
    max-height: 100vh;
    height: 100dvh;
    overflow-y: auto;
  }
}
</style>
