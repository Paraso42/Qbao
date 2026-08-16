// 字体大小设置应用（CSS 变量），自 legacy settings.js applyAllFontSizes 迁移
export function applyFontSizes(settings) {
  if (!settings) return
  const quizFs = settings.quizFontSize || 17
  const sidebarFs = settings.sidebarFontSize || 13
  const topbarFs = settings.topbarFontSize || 14
  const mainFs = settings.mainFontSize || 17
  const root = document.documentElement
  root.style.setProperty('--sidebar-font-size', sidebarFs + 'px')
  root.style.setProperty('--topbar-font-size', topbarFs + 'px')
  root.style.setProperty('--main-font-size', mainFs + 'px')
  root.style.setProperty('--quiz-font-size', quizFs + 'px')
  root.style.setProperty('--quiz-option-font-size', (quizFs - 2) + 'px')
}
