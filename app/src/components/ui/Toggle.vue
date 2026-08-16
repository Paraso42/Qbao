<template>
  <label class="toggle-switch" :class="{ disabled }">
    <input type="checkbox" :checked="modelValue" @change="onChange" :disabled="disabled">
    <span class="toggle-slider"></span>
  </label>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'change'])
function onChange(e) { emit('update:modelValue', e.target.checked); emit('change', e.target.checked) }
</script>

<style scoped>
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  cursor: pointer;
  flex-shrink: 0;
  vertical-align: middle;
}
.toggle-switch.disabled { opacity: 0.5; cursor: not-allowed; }
.toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.toggle-switch:hover:not(.disabled) .toggle-slider { border-color: var(--border-default); }
.toggle-slider::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  left: 2px;
  top: 2px;
  background: #fff;
  border-radius: 50%;
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition-fast);
}
.toggle-switch input:checked + .toggle-slider { background: var(--color-primary); border-color: var(--color-primary); }
.toggle-switch input:checked + .toggle-slider::before { transform: translateX(18px); }
.toggle-switch input:focus-visible + .toggle-slider { box-shadow: var(--shadow-glow); }
</style>
