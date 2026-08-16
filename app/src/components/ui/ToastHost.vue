<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="'toast-' + t.type">
        <span class="toast-dot"></span>
        <span class="toast-msg">{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useUiStore } from '../../stores/ui'
const ui = useUiStore()
</script>
