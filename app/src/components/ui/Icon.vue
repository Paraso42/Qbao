<template>
  <svg class="icon" :style="{ width: size, height: size }" aria-hidden="true">
    <use :href="href"></use>
  </svg>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 }
})
const href = computed(() => './img/icons.svg#i-' + props.name)
</script>

<style scoped>
.icon {
  display: inline-block;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
  vertical-align: -0.15em;
}
</style>
