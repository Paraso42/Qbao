<template>
  <div class="progress-bar" :style="{ height }">
    <div class="fill" :style="{ width: clamped + '%' }"></div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({
  value: { type: Number, default: 0 },
  height: { type: String, default: '6px' }
})
const clamped = computed(() => Math.max(0, Math.min(100, props.value)))
</script>
