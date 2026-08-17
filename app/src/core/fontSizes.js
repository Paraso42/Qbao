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

  // 顶栏/主页内绝大多数元素使用显式的 --fs-* 字号，容器的 font-size 继承多数被覆盖，
  // 导致“顶栏/主页字体大小”调节看起来不生效。这里把 --fs-* 缩放应用到 #topbar / #main
  // 作用域，使调节真正作用于其内部所有文字（仅影响该容器，侧栏与全局弹层不受影响）。
  const FS = { xs: 12, sm: 13, base: 14, md: 16, lg: 18, xl: 20, '2xl': 24 }
  function scaleFs(el, baseFs) {
    if (!el) return
    const ratio = baseFs / 14 // --fs-base 默认 14px
    for (const k in FS) {
      el.style.setProperty('--fs-' + k, Math.round(FS[k] * ratio) + 'px')
    }
  }
  scaleFs(document.querySelector('#topbar'), topbarFs)
  scaleFs(document.querySelector('#main'), mainFs)
  // 答题区单独缩放，使“题目字体大小”同样生效
  scaleFs(document.querySelector('#quiz-root'), quizFs)
}
