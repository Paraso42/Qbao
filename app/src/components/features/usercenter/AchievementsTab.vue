<!--
  AchievementsTab.vue — 成就页（自 legacy achievements.js renderAchievements）
  用 services/achievements.js 的 ACHIEVEMENT_ACTIONS 与 state.achievements 渲染解锁状态。
-->
<template>
  <div class="ach-tab">
    <div class="ach-count">已解锁 <strong>{{ unlockedCount }}</strong> / {{ actions.length }}</div>
    <div class="ach-grid">
      <div
        v-for="a in cards"
        :key="a.id"
        class="achievement-card"
        :class="a.isUnlocked ? 'unlocked' : 'locked'"
      >
        <template v-if="a.isUnlocked">
          <div class="ach-icon">{{ a.icon }}</div>
          <div class="ach-name">{{ a.name }}</div>
          <div class="ach-desc">{{ a.desc }}</div>
          <div class="ach-status">🔓 {{ a.date }}</div>
        </template>
        <template v-else>
          <div class="ach-mystery">❓</div>
          <div class="ach-status">未解锁</div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useDataStore } from '../../../stores/data'
import { ACHIEVEMENT_ACTIONS, checkAchievements } from '../../../services/achievements'

const data = useDataStore()
const actions = ACHIEVEMENT_ACTIONS

const cards = computed(() => {
  const unlocked = (data.state.achievements && data.state.achievements.unlocked) || []
  const history = (data.state.achievements && data.state.achievements.history) || []
  return actions.map((a) => {
    const isUnlocked = unlocked.includes(a.id)
    const rec = history.find((h) => h.id === a.id)
    return { ...a, isUnlocked, date: rec ? rec.date : '已解锁' }
  })
})

const unlockedCount = computed(() => cards.value.filter((c) => c.isUnlocked).length)

// 打开成就页时刷新一次解锁状态（同 legacy init 时的 checkAchievements）
onMounted(() => {
  const newUnlocks = checkAchievements(data.state)
  if (newUnlocks && newUnlocks.length > 0) data.saveState()
})
</script>

<style scoped>
.ach-tab { display: flex; flex-direction: column; gap: var(--space-lg); }
.ach-count { font-size: var(--fs-base); color: var(--text-secondary); }
.ach-count strong { color: var(--color-primary); font-size: var(--fs-lg); }
.ach-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-md);
}
.achievement-card {
  border: 1px solid var(--border-light);
  border-left: 3px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-lg) var(--space-md);
  text-align: center;
  background: var(--surface-card);
  transition: box-shadow var(--transition-fast), transform var(--transition-fast);
}
.achievement-card:hover { box-shadow: var(--shadow-sm); transform: translateY(-1px); }
.achievement-card.unlocked {
  border-left-color: var(--color-success);
  background: linear-gradient(135deg, var(--color-success-light), var(--surface-card));
}
.achievement-card.locked { opacity: 0.45; filter: grayscale(0.6); }
.ach-icon { font-size: 32px; margin-bottom: var(--space-xs); }
.ach-name { font-size: var(--fs-base); font-weight: 600; margin: var(--space-xs) 0; }
.ach-desc { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; line-height: var(--lh-normal); }
.ach-status { font-size: 11px; margin-top: var(--space-sm); color: var(--text-muted); }
.achievement-card.unlocked .ach-status { color: var(--color-success); font-weight: 500; }
.ach-mystery { font-size: 40px; color: var(--border-default); }
</style>
