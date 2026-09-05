<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-overlay" @mousedown.self="onOverlay">
        <div class="dialog-box" :class="{ wide, fullscreen: full || fullscreen }" role="dialog" aria-modal="true">
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
  // v3.36 修复：QuizView 传 fullscreen 而此前 prop 名为 full，答题全屏 sheet 从未生效（手机端弹窗一直被顶栏/底部背景夹持）
  fullscreen: { type: Boolean, default: false },
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
  /* 键盘弹起时弹层顶部对齐，避免表单被软键盘遮挡 */
  .dialog-overlay:has(.dialog-box:focus-within) { align-items: flex-start; padding-top: 24px; }
}
/* 窄屏（≤480）：更紧凑的弹窗内边距；操作按钮全宽均分 */
@media (max-width: 480px) {
  .dialog-box { padding: var(--space-md); }
  .dialog-box.fullscreen { padding: var(--space-md); }
  .dialog-box .dialog-actions .btn { flex: 1; }
}
</style>
