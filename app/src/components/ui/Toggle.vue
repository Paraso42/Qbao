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
  /* 开关尺寸与圆点位移全部通过变量 + calc 计算，不写死位移数值 */
  --track-width: 36px;      /* 轨道总宽（含边框），常见开关比例约 宽1.8倍于高 */
  --track-height: 20px;
  --track-border: 1px;      /* 轨道边框 */
  --thumb-size: 16px;       /* 圆点直径 */
  --thumb-gap: 2px;         /* 圆点离轨道内边缘的单侧间距 */
  width: var(--track-width);
  min-width: var(--track-width);
  max-width: var(--track-width);
  height: var(--track-height);
  border: var(--track-border) solid var(--border-light);
  border-radius: var(--radius-full);
  cursor: pointer;
  flex-shrink: 0;
  vertical-align: middle;
  box-sizing: border-box;
  background: var(--surface-hover);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.toggle-switch.disabled { opacity: 0.5; cursor: not-allowed; }
.toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle-slider {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}
.toggle-switch:hover:not(.disabled) { border-color: var(--border-default); }
.toggle-slider::before {
  content: '';
  position: absolute;
  width: var(--thumb-size);
  height: var(--thumb-size);
  left: var(--thumb-gap);
  top: calc((var(--track-height) - var(--track-border) * 2 - var(--thumb-size)) / 2);
  background: #fff;
  border-radius: 50%;
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition-fast);
}
.toggle-switch:has(input:checked) { background: var(--color-primary); border-color: var(--color-primary); }
/* 开启位移 = 轨道内容宽度 − 圆点直径 − 两侧单边间距×2（轨道内容宽度 = 总宽 − 左右边框） */
.toggle-switch:has(input:checked) .toggle-slider::before {
  transform: translateX(calc(var(--track-width) - var(--track-border) * 2 - var(--thumb-size) - var(--thumb-gap) * 2));
}
.toggle-switch input:focus-visible + .toggle-slider { box-shadow: var(--shadow-glow); }
</style>