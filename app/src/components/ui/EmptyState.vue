<template>
  <div class="empty-state">
    <div class="es-icon"><slot name="icon"><Icon :name="icon" :size="28" /></slot></div>
    <div class="es-title">{{ title }}</div>
    <div v-if="hint" class="es-hint">{{ hint }}</div>
    <slot name="action"></slot>
  </div>
</template>

<script setup>
import Icon from './Icon.vue'
defineProps({
  icon: { type: String, default: 'book' },
  title: { type: String, default: '暂无内容' },
  hint: { type: String, default: '' }
})
</script>
