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
import { onBeforeUnmount, onMounted } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  wide: { type: Boolean, default: false },
  full: { type: Boolean, default: false },
  closable: { type: Boolean, default: true },
  closeOnOverlay: { type: Boolean, default: true }
})
const emit = defineEmits(['close'])

function onClose() { emit('close') }
function onOverlay() { if (props.closeOnOverlay) onClose() }
function onKey(e) { if (e.key === 'Escape' && props.open) onClose() }

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(23, 24, 28, 0.45);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
}
.dialog-box {
  position: relative;
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
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
  color: var(--text-muted);
}
.dlg-close:hover { background: var(--surface-hover); color: var(--text-primary); }
.dialog-enter-active, .dialog-leave-active { transition: opacity 0.2s ease; }
.dialog-enter-active .dialog-box, .dialog-leave-active .dialog-box { transition: transform 0.2s ease; }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .dialog-box, .dialog-leave-to .dialog-box { transform: translateY(12px) scale(0.98); }
@media (max-width: 768px) {
  .dialog-box { max-width: 100%; max-height: 100%; padding: var(--space-lg); }
  .dialog-box.fullscreen {
    position: fixed;
    inset: 0;
    border-radius: 0;
    max-height: 100vh;
    height: 100dvh;
    overflow-y: auto;
  }
}
</style>
