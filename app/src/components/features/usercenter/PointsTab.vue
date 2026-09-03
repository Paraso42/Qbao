<!--
  PointsTab.vue — 积分页（v3.29）
  顺序：当前积分余额 → 积分明细 → 获取介绍 → 消耗介绍。
  学期清零警示 + 明细分页。
-->
<template>
  <div class="points-tab">
    <!-- ① 当前积分余额 -->
    <div class="section balance-card">
      <div class="balance-main">
        <div class="balance-num-wrap">
          <Icon name="coins" :size="24" />
          <span class="balance-num">{{ points.balance }}</span>
        </div>
        <span class="balance-label">当前积分</span>
      </div>
      <div v-if="points.expiryWarnVisible" class="expiry-warn">
        <Icon name="warning" :size="14" />
        <span>距{{ nextExpiryLabel }}还有 {{ points.daysToExpiry }} 天，届时积分将清零，请及时使用</span>
      </div>
    </div>

    <!-- ② 积分明细 -->
    <div class="section">
      <h4><Icon name="file" :size="16" />积分明细 <span v-if="points.ledgerTotal" class="ledger-total">共 {{ points.ledgerTotal }} 条</span></h4>
      <div v-if="points.ledgerLoading" class="loading">加载中...</div>
      <template v-else>
        <div v-if="points.ledger.length > 0" class="ledger-list">
          <div v-for="item in points.ledger" :key="item.id" class="ledger-row">
            <div class="ledger-info">
              <div class="ledger-reason">
                {{ reasonLabel(item.reason) }}
                <span v-if="item.note" class="ledger-note">{{ item.note }}</span>
              </div>
              <div class="ledger-time">{{ fmtTime(item.createdAt) }}</div>
            </div>
            <span class="ledger-delta" :class="item.delta >= 0 ? 'earn' : 'spend'">
              {{ item.delta >= 0 ? '+' : '' }}{{ item.delta }}
            </span>
          </div>
        </div>
        <p v-else class="empty">暂无积分记录</p>
        <div v-if="points.ledgerTotal > points.ledgerLimit" class="pager">
          <button class="btn btn-text btn-small" :disabled="points.ledgerPage <= 1" @click="prevPage">上一页</button>
          <span class="pager-info">{{ points.ledgerPage }} / {{ totalPages }}</span>
          <button class="btn btn-text btn-small" :disabled="points.ledgerPage >= totalPages" @click="nextPage">下一页</button>
        </div>
      </template>
    </div>

    <!-- ③ 获取介绍 -->
    <div class="section">
      <h4><Icon name="sparkle" :size="16" />怎么获得积分</h4>
      <div v-if="points.rules" class="rule-list">
        <div v-for="r in points.rules.earn" :key="r.reason" class="rule-row">
          <div class="rule-info">
            <div class="rule-name">{{ r.label }}</div>
            <div class="rule-desc">{{ r.desc }}</div>
          </div>
          <span class="rule-points earn">+{{ r.points }}</span>
        </div>
      </div>
      <p v-else class="loading">加载中...</p>
    </div>

    <!-- ④ 消耗介绍 -->
    <div class="section">
      <h4><Icon name="coffee" :size="16" />积分怎么用</h4>
      <div v-if="points.rules" class="rule-list">
        <div v-for="r in points.rules.spend" :key="r.reason" class="rule-row">
          <div class="rule-info">
            <div class="rule-name">{{ r.label }}</div>
            <div class="rule-desc">{{ r.desc }}</div>
          </div>
          <span class="rule-points spend">-{{ r.points }}</span>
        </div>
      </div>
      <p v-else class="loading">加载中...</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import Icon from '../../ui/Icon.vue'
import { usePointsStore } from '../../../stores/points'

const points = usePointsStore()

const totalPages = computed(() => Math.max(1, Math.ceil(points.ledgerTotal / points.ledgerLimit)))
const nextExpiryLabel = computed(() => (points.rules && points.rules.nextExpiry && points.rules.nextExpiry.label) || '清零日')

function reasonLabel(reason) {
  const labels = (points.rules && points.rules.reasonLabels) || {}
  return labels[reason] || reason
}
function fmtTime(ts) {
  try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }) } catch (e) { return '' }
}
function prevPage() {
  if (points.ledgerPage > 1) points.loadLedger(points.ledgerPage - 1)
}
function nextPage() {
  if (points.ledgerPage < totalPages.value) points.loadLedger(points.ledgerPage + 1)
}

onMounted(async () => {
  await points.loadRules()
  points.loadLedger(1)
  // 打开积分页时向服务端取一次权威余额（答题结算在其他页面发生，本地可能在旧值）
  points.refreshBalance()
})
</script>

<style scoped>
.points-tab { display: flex; flex-direction: column; gap: var(--space-md); }
.section {
  background: var(--surface-bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
}
.section h4 {
  margin: 0 0 var(--space-sm);
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.section h4 .icon { color: var(--color-primary); }

/* 余额居中（flex 全居中，数字绝对居中） */
.balance-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.balance-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.balance-num-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  color: var(--color-primary);
  line-height: 1;
}
.balance-num {
  font-size: var(--fs-2xl);
  font-weight: 700;
  line-height: 1;
}
.balance-label { font-size: var(--fs-sm); color: var(--text-secondary); }
.expiry-warn {
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: rgba(233, 69, 96, 0.08);
  border: 1px solid rgba(233, 69, 96, 0.35);
  color: var(--color-danger);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.rule-list { display: flex; flex-direction: column; gap: var(--space-xs); }
.rule-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  border-bottom: 1px dashed var(--border-light);
}
.rule-row:last-child { border-bottom: none; }
.rule-name { font-size: var(--fs-sm); font-weight: 500; color: var(--text-primary); }
.rule-desc { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.rule-points { font-size: var(--fs-base); font-weight: 600; flex-shrink: 0; }
.rule-points.earn, .ledger-delta.earn { color: var(--color-success, #2ed573); }
.rule-points.spend, .ledger-delta.spend { color: var(--color-danger); }

.ledger-total { font-size: var(--fs-xs); color: var(--text-muted); font-weight: 400; }
.ledger-list { display: flex; flex-direction: column; gap: var(--space-xs); max-height: 300px; overflow-y: auto; padding-right: 4px; }
.ledger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}
.ledger-reason { font-size: var(--fs-sm); color: var(--text-primary); }
.ledger-note { font-size: var(--fs-xs); color: var(--text-muted); margin-left: var(--space-xs); }
.ledger-time { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.ledger-delta { font-size: var(--fs-base); font-weight: 600; flex-shrink: 0; }
.pager { display: flex; align-items: center; justify-content: center; gap: var(--space-md); margin-top: var(--space-sm); }
.pager-info { font-size: var(--fs-xs); color: var(--text-muted); }
.loading { text-align: center; color: var(--text-muted); padding: var(--space-lg); font-size: var(--fs-sm); }
.empty { font-size: var(--fs-sm); color: var(--text-muted); text-align: center; padding: var(--space-lg); }
</style>
