// ============================================================
// startActions.js — 章节工作台主操作单槽位状态机（v3.36）
// 「开始出题」与「开始答题」共用同一按钮槽位，按状态切换：
//   1. 无轮次            → 「开始出题」（canGenerate 时点亮，否则灰化+原因）
//   2. 出题中（任务在队列）→ 「出题中…」（灰化；失败/取消自动回落状态 1）
//   3. 轮次存在且未答完    → 「开始答题」（主按钮，点击进入/继续该轮）
//   4. 本轮全部答完       → 回到「开始出题」（可生成下一轮）
// 纯函数，无 store 依赖，便于单测与多端（手机/网页/桌面）行为一致。
// ============================================================

export const GENERATE_STATE = 'generate'   // 开始出题（可点/灰化+原因）
export const GENERATING_STATE = 'generating' // 出题中…（灰化占位）
export const ANSWER_STATE = 'answer'       // 开始答题（主按钮）

export function derivePrimaryAction({ setTotal = 0, setAnswered = 0, hasTask = false, canGenerate = false, blockReason = '' } = {}) {
  const total = Number(setTotal) || 0
  const answered = Number(setAnswered) || 0

  // 出题中：任务在队列（pending/running）→ 同槽位灰化占位，失败/取消后自动回落
  if (hasTask) {
    return {
      state: GENERATING_STATE,
      label: '出题中…',
      icon: 'sparkle',
      enabled: false,
      reason: 'AI 正在出题，完成后按钮将变为「开始答题」',
    }
  }

  // 轮次存在且有未答题目 → 开始答题（0 已答为开始，部分已答自动续答）
  if (total > 0 && answered < total) {
    return { state: ANSWER_STATE, label: '开始答题', icon: 'book', enabled: true, reason: '' }
  }

  // 无轮次 / 本轮全部答完 → 开始出题（可生成下一轮）
  return {
    state: GENERATE_STATE,
    label: '开始出题',
    icon: 'sparkle',
    enabled: !!canGenerate,
    reason: canGenerate ? '' : (blockReason || '当前暂不可用'),
  }
}
