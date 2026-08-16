<template>
  <Modal :open="ui.confirm.open" :closable="true" @close="resolve(false)">
    <h3 class="cd-title">{{ ui.confirm.title }}</h3>
    <p class="cd-msg">{{ ui.confirm.message }}</p>
    <div class="dialog-actions">
      <button class="btn btn-secondary btn-small" @click="resolve(false)">取消</button>
      <button class="btn btn-primary btn-small" @click="resolve(true)">{{ ui.confirm.okText || '确定' }}</button>
    </div>
  </Modal>
</template>

<script setup>
import { useUiStore } from '../../stores/ui'
import Modal from './Modal.vue'
const ui = useUiStore()
function resolve(v) {
  if (ui.confirm.resolve) ui.confirm.resolve(v)
  ui.closeConfirm()
}
</script>

<style scoped>
.cd-title { margin-bottom: var(--space-sm); }
.cd-msg { color: var(--text-secondary); font-size: var(--fs-base); line-height: var(--lh-normal); }
</style>
