<!-- 章节出题策略卡：题型数量 + 三比例（自 legacy strategy.js UI 迁移，直接绑定 strategy 对象） -->
<template>
  <div class="card">
    <h3>出题策略 — <span class="ch-name">{{ ch.name }}</span></h3>

    <h4>第一步：各题型数量</h4>
    <div class="type-counts">
      <div v-for="t in types" :key="t.key" class="type-count-item">
        <label>{{ t.label }}</label>
        <div class="num-picker">
          <button class="num-btn" @click="step(t.key, -1)">−</button>
          <input v-model.number="strategy.typeCounts[t.key]" class="num-input" type="number" min="0" max="50" @change="changed">
          <button class="num-btn" @click="step(t.key, 1)">+</button>
        </div>
      </div>
    </div>

    <h4>第二步：出题策略</h4>
    <p class="hint">三比例之和 = 100%（可直接输入百分比，向右自动补偿，末位向左）：</p>
    <div class="strategy-labels">
      <span class="l-err"><i class="pct-dot"></i>针对错题 <input v-model.number="errPct" class="pct-input" type="number" min="0" max="100" @change="onPctInput(0)">%</span>
      <span class="l-review"><i class="pct-dot"></i>滚动复习 <input v-model.number="reviewPct" class="pct-input" type="number" min="0" max="100" @change="onPctInput(1)">%</span>
      <span class="l-new"><i class="pct-dot"></i>新考点 <input v-model.number="newPct" class="pct-input" type="number" min="0" max="100" @change="onPctInput(2)">%</span>
    </div>
    <div class="dual-range-wrap">
      <div class="dual-track-bg"></div>
      <div class="dual-track-fill err" :style="errStyle"></div>
      <div class="dual-track-fill review" :style="reviewStyle"></div>
      <div class="dual-track-fill new" :style="newStyle"></div>
      <input type="range" min="0" max="100" step="1" :value="strategy.errPct" @input="onErrSlider" @change="persist">
      <input type="range" min="0" max="100" step="1" :value="strategy.errPct + strategy.reviewPct" @input="onCumSlider" @change="persist">
    </div>
    <div class="strategy-values">
      <div class="sv-item err"><div class="sv-num">{{ strategy.errPct }}</div><div class="sv-label"><i class="sv-dot"></i>针对错题</div></div>
      <div class="sv-item review"><div class="sv-num">{{ strategy.reviewPct }}</div><div class="sv-label"><i class="sv-dot"></i>滚动复习</div></div>
      <div class="sv-item new"><div class="sv-num">{{ strategy.newPct }}</div><div class="sv-label"><i class="sv-dot"></i>新考点</div></div>
    </div>

    <h4>第三步：知识点标签管理</h4>
    <p class="hint">拖拽标签可调整分类，同列内拖标签到另一个标签上可合并</p>
    <TagsManager :chapter-id="ch.id" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '../../../stores/data'
import { adjustStrategyPct, applyDualSlider } from '../../../services/strategy'
import TagsManager from './TagsManager.vue'

const props = defineProps({ chapterId: { type: String, required: true } })
const data = useDataStore()

const ch = computed(() => data.state.chapters[props.chapterId])
const strategy = computed(() => (ch.value ? data.getChStrategy(props.chapterId) : { typeCounts: {}, errPct: 0, reviewPct: 0, newPct: 0 }))

const types = [
  { key: 'single', label: '单选' },
  { key: 'judge', label: '判断' },
  { key: 'term', label: '名词解释' },
  { key: 'short', label: '简答' }
]

const errPct = computed({ get: () => strategy.value.errPct || 0, set: (v) => { strategy.value.errPct = v } })
const reviewPct = computed({ get: () => strategy.value.reviewPct || 0, set: (v) => { strategy.value.reviewPct = v } })
const newPct = computed({ get: () => strategy.value.newPct || 0, set: (v) => { strategy.value.newPct = v } })

const errStyle = computed(() => ({ width: errPct.value + '%' }))
const reviewStyle = computed(() => ({ width: reviewPct.value + '%', left: errPct.value + '%' }))
const newStyle = computed(() => ({ width: newPct.value + '%', left: (errPct.value + reviewPct.value) + '%' }))

function changed() {
  const tc = strategy.value.typeCounts
  for (const t of types) {
    let v = parseInt(tc[t.key]) || 0
    v = Math.max(0, Math.min(50, v))
    tc[t.key] = v
  }
  data.saveState()
}

function step(key, delta) {
  const tc = strategy.value.typeCounts
  tc[key] = Math.max(0, Math.min(50, (tc[key] || 0) + delta))
  data.saveState()
}

function onErrSlider(e) {
  const v1 = Math.max(0, Math.min(100, parseInt(e.target.value) || 0))
  const v2 = Math.max(v1, strategy.value.errPct + strategy.value.reviewPct)
  applyDualSlider(strategy.value, v1, v2)
}

function onCumSlider(e) {
  const v2 = Math.max(0, Math.min(100, parseInt(e.target.value) || 0))
  const v1 = Math.min(strategy.value.errPct, v2)
  applyDualSlider(strategy.value, v1, v2)
}

// 拖动过程中只更新内存，松手（change）才持久化，避免整库序列化卡顿
function persist() {
  data.saveState()
}

function onPctInput(idx) {
  const vals = [errPct.value, reviewPct.value, newPct.value]
  const newVal = Math.max(0, Math.min(100, parseInt(vals[idx]) || 0))
  const pcts = adjustStrategyPct(strategy.value, idx, newVal)
  errPct.value = pcts[0]
  reviewPct.value = pcts[1]
  newPct.value = pcts[2]
  data.saveState()
}
</script>

<style scoped>
.ch-name { color: var(--text-secondary); font-weight: 500; }
.hint { color: var(--text-muted); font-size: var(--fs-xs); margin-bottom: 6px; }
.type-counts { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
.type-count-item { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; background: var(--surface-hover); border-radius: var(--radius-md); }
.type-count-item label { font-size: var(--fs-sm); color: var(--text-secondary); }
.num-picker { display: flex; align-items: center; gap: 2px; }
.num-btn {
  width: 30px; height: 32px;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  font-size: var(--fs-md);
  display: flex; align-items: center; justify-content: center;
}
.num-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.num-input { width: 52px; height: 32px; text-align: center; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--surface-card); font-size: var(--fs-base); }
.num-input:focus { border-color: var(--color-primary); box-shadow: var(--shadow-glow); outline: none; }
.strategy-labels { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; font-size: var(--fs-sm); color: var(--text-secondary); }
.strategy-labels span { display: inline-flex; align-items: center; gap: 4px; }
.pct-dot, .sv-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.l-err .pct-dot, .sv-item.err .sv-dot { background: #EF4444; }
.l-review .pct-dot, .sv-item.review .sv-dot { background: #F59E0B; }
.l-new .pct-dot, .sv-item.new .sv-dot { background: #10B981; }
.pct-input { width: 48px; padding: 3px 6px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); text-align: center; font-size: var(--fs-sm); background: var(--surface-card); }
.pct-input:focus { border-color: var(--color-primary); outline: none; }
.dual-range-wrap { position: relative; height: 44px; margin: 4px 0 8px; touch-action: none; }
.dual-track-bg { position: absolute; left: 0; right: 0; top: 19px; height: 6px; border-radius: 3px; background: var(--border-light); }
.dual-track-fill { position: absolute; top: 19px; height: 6px; }
.dual-track-fill.err { background: #EF4444; border-radius: 3px 0 0 3px; }
.dual-track-fill.review { background: #F59E0B; }
.dual-track-fill.new { background: #10B981; border-radius: 0 3px 3px 0; }
.dual-range-wrap input[type="range"] {
  position: absolute; left: 0; top: 0; width: 100%; height: 44px;
  -webkit-appearance: none; appearance: none; background: transparent; pointer-events: none; margin: 0;
}
.dual-range-wrap input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; border: 2px solid var(--color-primary); cursor: pointer; pointer-events: auto;
  box-shadow: var(--shadow-sm);
}
.dual-range-wrap input[type="range"]::-moz-range-thumb {
  width: 18px; height: 18px; border-radius: 50%;
  background: #fff; border: 2px solid var(--color-primary); cursor: pointer; pointer-events: auto;
}
.strategy-values { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); padding: var(--space-sm); background: var(--surface-hover); border-radius: var(--radius-md); }
.sv-item { text-align: center; }
.sv-num { font-size: var(--fs-lg); font-weight: 700; }
.sv-item.err .sv-num { color: #EF4444; }
.sv-item.review .sv-num { color: #F59E0B; }
.sv-item.new .sv-num { color: #10B981; }
.sv-label { font-size: var(--fs-xs); color: var(--text-secondary); display: inline-flex; align-items: center; gap: 5px; }
@media (max-width: 768px) {
  .dual-range-wrap input[type="range"]::-webkit-slider-thumb { width: 28px; height: 28px; }
}
</style>
