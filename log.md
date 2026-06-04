# Qbao 更新日志

---

## 2026-06-04 — Bug 修复 & UX 优化 (第二轮)

### 消息栏重构
- [notices.js](js/notices.js): 双模式消息切换 — 独立成栏模式(≤900px)用 `translateX` 滑入/滑出动画(450ms)，桌面模式保留淡入淡出(300ms)；新增 `applyNoticeScrollClass()` 检测文本溢出并设置 `--scroll-dist` CSS 变量驱动 marquee
- [topbar.css](css/topbar.css): inline style 全量移入 CSS 文件消除特异性冲突；重写 `@keyframes noticeScroll` 使用 CSS 变量按实际溢出量滚动
- [responsive.css](css/responsive.css): 新增 `@media (max-width: 900px)` 断点让通知栏在更宽屏幕上独立成行；移除 `#footer-beian` 移动端规则

### "开始出题"底栏
- [components.css](css/components.css): 最终采用 `position: fixed; bottom: 0; z-index: 100` 消除与 `#main` overflow scroll 间的缝隙
- [ai-workflow.js](js/ai-workflow.js): 新增 `positionCardBottomBar()` — 动态读取卡片 `getBoundingClientRect()` 设置底栏 `left`/`width` 精确匹配卡片宽度；`window.resize` 监听自动重定位；`applyAiModeUi()` 管理 `#main.paddingBottom`
- [app.js](js/app.js): 侧栏展开/收起后延迟 350ms 调用 `positionCardBottomBar()`
- [index.html](index.html): 移除 `#footer-beian` ICP备案号
- [strategy.js](js/strategy.js): `loadChapterStrategyToUI()` 同步管理 paddingBottom

### 题型数量选择器
- [index.html](index.html): 4 个 `<select>` → 自定义 `.num-picker`（− 按钮 + `input[type=number]` + + 按钮）
- [strategy.js](js/strategy.js): 新增 `numPickerStep()`（±1 步进触发 change 事件）和 `numPickerClamp()`（限幅 0-50）全局函数；`initTypeCountSelects()` → `initTypeCountPickers()`
- [exam.js](js/exam.js): `renderSubjComposeExam()` 动态生成 num-picker 替代 select
- [components.css](css/components.css): `.num-picker` 圆角容器、隐藏原生 spinner、hover/active 反馈；[responsive.css](css/responsive.css) 移动端放大触控区域

### 章节切换 Bug 修复
- [subjects.js](js/subjects.js): `switchChapter()` 增加遍历查找父科目并同步 `currentSubjectId`；`switchSubject()` 不再自动选中首个章节 (`currentChapterId = null`)
- [srs.js](js/srs.js): 删除重复的简化版 `showScreen()`（缺少弹窗路由处理，虽被 app.js 覆盖但属隐患）

### 字体大小继承
- [sidebar.css](css/sidebar.css), [topbar.css](css/topbar.css), [components.css](css/components.css), [base.css](css/base.css): 子元素 `font-size` 从 `var(--fs-*)` / `px` 改为 `em` 相对单位，使父容器 inline font-size 可级联缩放
- [settings.js](js/settings.js): `applyAllFontSizes()` 同时设置 CSS 变量和 inline font-size；4 个滑块 oninput 实时更新预览块字号
- [index.html](index.html): 设置页新增 4 个字号预览块 (`#preview-sidebar` 等)

### 其他
- [settings.js](js/settings.js): `openSettingsModal()` 开头显式调用 `switchSettingsTab('personalize')` 修复首次打开空白
- [state.js](js/state.js): 新增 `showNoticeBar: true` 设置项
- [index.html](index.html): 设置页新增"显示顶栏消息"开关；AI出题队列弹窗增加 overlay onclick 关闭和倒序渲染
- 部署: 全部文件 SCP 至测试服务器，MD5 校验全部通过

---

## 2026-06-04 — 项目文档完善

- **skill 迁移**: 将 `skill.md` 转为标准 Claude Code skill 格式，上传至 `~/.claude/skills/Qbao/SKILL.md`，可通过 `/Qbao` 或 `cc switch` 搜索管理; 删除旧 `D:\Qbao\skill.md`
- **log 更新**: 新增本次变更记录
- **工作流规则**: skill 中明确"每次任务完成后更新 skill 文件 + 只增不改 log 文件"

---

## 2026-06-03 — Phase 7: 弹窗化改造 + UX 优化

### 弹窗化架构重构
- 10 屏 → 4 屏 + 3 弹窗：移除 7 个旧 screen + 1 个下拉菜单，新增 quiz-modal / settings-modal / user-center-modal
- 路由层改造 [app.js](js/app.js)：`showScreen()` 增加弹窗类路由分发，`closeAllModals()` 统一关闭，ESC 键监听
- 用户中心改为侧栏弹窗（账号/数据/成就/管理员 4 tab），移除旧的 hover 下拉交互
- 答题界面 + 报告界面合并为双视图弹窗（quiz/report 切换），答题中隐藏关闭按钮
- 设置页改为弹窗，双标签（个性化/AI 配置）

### 5 项 UI 改进
1. **逐题回顾美化** — [dashboard.css](css/dashboard.css) + [quiz-report.js](js/quiz-report.js)：卡片式题目布局、颜色编码答案标签、结构化 HTML 层级
2. **弹窗大小稳定** — [modals.css](css/modals.css)：`.uc-modal-box` 从 `max-height` 改为固定 `height: 85vh`，内部 overflow 滚动
3. **AI 提示增强** — [topbar.css](css/topbar.css)：角标从 8px 圆点改为文字 badge（运行中/就绪），删除侧栏底部重复提示点
4. **移除面包屑** — [index.html](index.html) 删除 `<span id="breadcrumb">`，[app.js](app.js) `updateBreadcrumb()` 改为空壳
5. **设置侧栏** — [index.html](index.html) + [modals.css](css/modals.css)：180px 侧栏 + `data-settings-tab` 切换，与用户中心布局一致

### 答题页按钮重组
- 分层设计：主操作（提交/下一题）、次要操作（我会了/结束考试/返回）
- 报告页增强：新增"只看错题"按钮

### 配套 CSS
- [dark-mode.css](css/dark-mode.css)：全部新增 UI 的暗色覆盖
- [responsive.css](css/responsive.css)：弹窗移动端全屏适配、侧栏变水平 tabs
- [components.css](css/components.css)：`.btn-start-quiz` 渐变主按钮

### 服务器运维
- `/var/www/qbao_staging/` → `/var/www/qbao_test/` 重命名，避免传输混淆
- 修复 9178 正式端口被错误覆盖的问题（从测试环境恢复）
- Nginx 配置更新 8080 端口 root 指向

### Git
- 提交 `a7cf0e4`：51 files changed, +6601/-948 lines
- 推送至 `origin/main`

---

## 2026-06-04 — 项目文档

- 创建 [skill.md](skill.md)：项目工作参考（文件排布、架构、服务器、部署流、注意事项）
- 创建 [log.md](log.md)：本更新日志
