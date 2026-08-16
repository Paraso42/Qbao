<template>
  <Modal :open="ui.prompt.open" :closable="true" @close="resolve(null)">
    <h3 class="pd-title">{{ ui.prompt.title }}</h3>
    <input
      ref="inputRef"
      v-model="value"
      class="input"
      type="text"
      @keydown.enter="resolve(value)"
    >
    <div class="dialog-actions">
      <button class="btn btn-secondary btn-small" @click="resolve(null)">取消</button>
      <button class="btn btn-primary btn-small" @click="resolve(value)">确定</button>
    </div>
  </Modal>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useUiStore } from '../../stores/ui'
import Modal from './Modal.vue'
const ui = useUiStore()
const inputRef = ref(null)
const value = ref('')

watch(() => ui.prompt.open, (open) => {
  if (open) {
    value.value = ui.prompt.value || ''
    nextTick(() => { if (inputRef.value) { inputRef.value.focus(); inputRef.value.select() } })
  }
})

function resolve(v) {
  const trimmed = v === null ? null : String(v).trim()
  if (ui.prompt.resolve) ui.prompt.resolve(trimmed)
  ui.closePrompt()
}
</script>

<style scoped>
.pd-title { margin-bottom: var(--space-md); }
</style>
