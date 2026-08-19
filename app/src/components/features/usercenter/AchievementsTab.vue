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
          <div class="ach-icon"><Icon :name="a.icon" :size="30" /></div>
          <div class="ach-name">{{ a.name }}</div>
          <div class="ach-desc">{{ a.desc }}</div>
          <div class="ach-status"><Icon name="lock-open" :size="11" /> {{ a.date }}</div>
          <div v-if="rewardPoints(a.id)" class="ach-reward"><Icon name="coins" :size="12" /> +{{ rewardPoints(a.id) }} 积分</div>
        </template>
        <template v-else>
          <div class="ach-mystery"><Icon name="lock" :size="26" /></div>
          <div class="ach-status">未解锁</div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useDataStore } from '../../../stores/data'
import { usePointsStore } from '../../../stores/points'
import Icon from '../../ui/Icon.vue'
import { ACHIEVEMENT_ACTIONS, checkAchievements } from '../../../services/achievements'

const data = useDataStore()
const points = usePointsStore()
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

// 各成就对应积分（与服务端 config/points.js ACHIEVEMENT_REWARDS 一致；领取以服务端为准）
const REWARDS = {
  first_step: 10, first_correct: 10, five_answers: 10,
  first_chapter: 20, ten_correct: 20, streak_5: 20, ten_questions: 20,
  three_chapters: 20, two_subjects: 20,
  fifty_questions: 50, hundred_correct: 50, streak_10: 50, five_subjects: 50,
  hundred_questions: 50, perfect_session: 50,
  five_hundred_q: 100, streak_20: 100, ten_subjects: 100,
  thousand_questions: 200, streak_50: 200,
}
function rewardPoints(id) { return REWARDS[id] || 0 }

// 打开成就页时刷新一次解锁状态（同 legacy init 时的 checkAchievements）
onMounted(async () => {
  const newUnlocks = checkAchievements(data.state)
  if (newUnlocks && newUnlocks.length > 0) {
    data.saveState()
    // 新解锁成就逐个领取积分奖励（服务端幂等，重复/失败静默）
    newUnlocks.forEach((a) => points.claimAchievement(a.id))
  }
  points.loadRules()
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
.ach-icon { font-size: 32px; margin-bottom: var(--space-xs); color: var(--color-primary); display: flex; justify-content: center; }
.ach-name { font-size: var(--fs-base); font-weight: 600; margin: var(--space-xs) 0; }
.ach-desc { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; line-height: var(--lh-normal); }
.ach-status { font-size: 11px; margin-top: var(--space-sm); color: var(--text-muted); }
.achievement-card.unlocked .ach-status { color: var(--color-success); font-weight: 500; }
.ach-mystery { font-size: 40px; color: var(--border-default); display: flex; justify-content: center; }
.ach-reward { font-size: 11px; margin-top: 4px; color: #f5a623; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 3px; }
</style>