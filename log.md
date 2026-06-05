# Qbao 更新日志

---

## 2026-06-05 — 新题标签管理范围修正 + 面板滚动 v3.6.7（仅测试环境 8080）

### 一、newTopicTags 改为纯用户管理
- 移除 `_aiExecuteTask()` 中出题后自动收集题目标签注入 newTopicTags 的逻辑
- 移除 `autoUpdateChapterWeakTags()` 中从 tagMeta 自动追加 newTopicTags 的逻辑
- newTopicTags 仅由用户手动添加/拖入/输入，未被作答的标签不再自动分类至此

### 二、标签面板滚动
- `.tag-col-list` 新增 `max-height: 160px; overflow-y: auto`，标签过多时列内滚动

### 涉及文件
- `js/ai-workflow.js` — 移除 tagCollect 块（~28 行）
- `js/quiz-engine.js` — autoUpdateChapterWeakTags 移除 newTopicTags 自动注入
- `css/components.css` — .tag-col-list 滚动

### 改动
- `generatePromptText()` 移除 `hasNew` 分支 — 有无新文件统一使用同一套 prompt 措辞
- 移除"之前已分析过的学习资料"误导表述 → 改为"根据提供的学习资料"
- 移除 `hasNew` 变量、"新提取的"动态文本 → 统一为"新知识点标签"
- 代码净减少 4 行

### 涉及文件
- `js/strategy.js` — generatePromptText 统一化

---

## 2026-06-05 — 三列标签修复 + 新题标签保护 v3.6.5（仅测试环境 8080）

### 一、newTopicTags 属性名 bug 修复
- **根因**: 三列标签管理使用 `s[cat + 'Tags']` 模式，`cat='new'` 时解析为 `s.newTags` 但实际属性是 `s.newTopicTags` → 新题标签渲染/添加/删除/拖拽全部失效
- **修复**: 新增 `_tagArr(s, cat)` 辅助函数，`cat==='new'` 时返回 `s.newTopicTags`，其余返回 `s[cat+'Tags']`
- 涉及函数: `renderTagColumns()`, `addTagToCategory()`, `removeTagFromCategory()`, `moveTagBetweenColumns()`, `mergeTagInCategory()`, `tagRenameStart()`

### 二、autoUpdateChapterWeakTags 保护 newTopicTags
- **修改前**: 答题后强制重建 newTopicTags（只保留未答过的标签）→ 出题后收集的标签一旦被答就被清空
- **修改后**: newTopicTags 永不自动删除，仅从 tagMeta 中 `totalQ===0` 的标签追加。用户可手动拖拽移除

### 三、prompt 简化
- `generatePromptText()` hasNew 分支移除"知识点标签已预先整理好"的误导措辞
- `newTopicTags` 现在也附带正确率统计（与 errorTags/reviewTags 一致）

### 涉及文件
- `js/strategy.js` — _tagArr 辅助 + prompt 优化
- `js/quiz-engine.js` — autoUpdateChapterWeakTags 保护 newTopicTags

### 一、移除独立 AI 标签提取（性能优化）
- 移除 `POST /ai/extract-tags` 端点及前端 `_aiExtractTags()` 调用
- 移除 `_aiExecuteTask()` 中出题前预注入标签的逻辑块
- 新题标签来源改为：(1) 出题后从题目 tag 字段收集 (2) 用户手动添加 (3) 从错题/复习标签拖入
- JSON Schema `tag` 和 `strategy` 保留在 `required` 中，确保每道题都有标签

### 二、标签拖拽全面重写（三列互通）
- 拖拽从内联 `ondragstart` 改为程序化 `addEventListener`（`_setupDragListeners()`）
- 每个 chip 绑定 `dragstart`/`dragend`（`_hasDrag` 防重复），panel 绑定 `dragover`/`drop`（`_dropReady` 防重复）
- drop 目标改为 `.tag-column` 整列匹配
- 支持三列之间任意拖拽移动（错题↔复习↔新题）
- 同列内拖到另一标签上触发合并（confirm 确认）
- `moveTagBetweenColumns`/`mergeTagInCategory` 增加 console.log 全程追踪

### 涉及文件
- 后端：`backend/src/routes/ai.routes.js` — 移除 extract-tags 端点、保留 tag+strategy required
- 前端：`js/strategy.js` — `renderTagColumns()` 程序化拖拽 + `_setupDragListeners()`
- 前端：`js/ai-workflow.js` — 移除 pre-generation 块和 `_aiExtractTags()`，保留 post-generation 标签收集

---

## 2026-06-05 — AI 出题标签系统重构 v3.6.0（仅测试环境 8080）

### 一、文件内容提取诊断系统
- 后端 `extractText()` 返回结构化结果：`{type, content, extracted, empty, error, warning}`
- 模块启动时预检 mammoth/pdf-parse/unzipper，缺失打 console.error
- API 响应新增 `poolFilesStatus` 字段，逐文件记录提取状态和错误原因
- 扫描型 PDF 标记 `empty:true, warning:"未提取到文字内容"`（纯事实描述）
- 前端任务通知展示文件诊断：「使用 X/Y 份资料」及提取失败原因
- 池文件在材料列表中显示蓝色「池」标签

### 二、三类标签系统重构
- `weakTags` 升级为三类标签：`errorTags`（错题）、`reviewTags`（复习）、`newTopicTags`（新知识点）
- 新增 `tagMeta` 记录每标签的 totalQ 和 correct，支持正确率计算
- 标签管理面板改为三列布局（错题/复习/新题），原 toggle 式 UI 废弃
- 支持手动添加、拖拽跨列移动、同列内拖拽合并标签
- 双击标签名可重命名
- 答题结束后增量更新 tagMeta 并自动重新分类

### 三、AI 出题策略
- `generatePromptText()` 根据三类标签生成精确出题指令
- 计算每类题目的精确数量（`totalQ × 百分比`）
- 新增文件检测机制：`_hasNewFilesSinceLastGen` 标记控制是否让 AI 先提取标签
- 出题后 `__meta` 解析 → 自动写入 `newTopicTags`
- 策略合规校验：统计 strategy 分布，偏差 >±2 时通知警告
- JSON Schema 新增 `strategy` 字段（enum: error/review/new）

### 四、修复
- `assignFileToChapter()` 现在同步 `chapterMaterials` 并设 `_hasNewFilesSinceLastGen`
- `assignFilePoolToChapter()` 设 `_hasNewFilesSinceLastGen`

### 涉及文件
- 后端：`backend/src/routes/ai.routes.js`
- 前端：`js/state.js`, `js/strategy.js`, `js/ai-workflow.js`, `js/quiz-engine.js`, `js/users.js`, `index.html`
- 样式：`css/components.css`, `css/dark-mode.css`, `css/responsive.css`

---

## 2026-06-05 — 答题进度持久化全面修复 v3.5.2（仅测试环境 8080）

解决了答题进度在刷新/重进/跨设备场景下丢失或错误结算的问题。涉及 8 个文件。

- **根因修复**: [state.js] currentQuizSetIdx===0 被 || 当作 falsy → 用 typeof number 判定；[quiz-engine.js] restoreQuizFromServer 本地优先合并 + beforeunload/visibilitychange 强行同步
- **null/-1 清理**: [quiz-engine.js] hasAns/selectOption/submitAnswer/sync/nav 全部排除 null（JSONB 将 undefined 存为 null）；[strategy.js] updateQuickActions 排除 -1/null；[state.js] startQuizSession 清除 -1/null；[app.js] closeQuizModal 排除 -1
- **跨设备恢复**: [quiz-engine.js] 本地无题目时从服务端 session 重建 quizSet；[users.js] doLogin() 静默恢复；[subjects.js] switchChapter() 恢复
- **其他**: [ai-workflow.js] ignoreCurrentQuestion 设正确答案 + _aiStreamGenerate 补 chapterId；[subjects.js] switchChapter 先 showScreen 再定位 card-bottom-bar；[quiz.routes.js] completed 分支穿透修复；[state.js] saveQuizHistory 补 name 属性
- **UX**: init/doLogin 取消弹窗，静默恢复，按钮可见性体现进度

---

## 2026-06-04 — 头像裁剪 + 刷新恢复修复 v3.5.1（仅测试环境 8080）

### Bug #1: 头像裁剪结果扭曲偏移 + 图片可拖出画面
- [修复] [js/users.js](js/users.js) — `confirmAvatarCrop()` 源矩形高度从 `srcSize * naturalH / naturalW` 修正为 `srcSize`（视口正方形→原图正方形，不需要宽高比换算）；新增 `clampAvatarCropOffset()` 在 `applyAvatarCropTransform()` 中调用，约束拖拽使视口圆心始终落在图片边界内

### Bug #2: 刷新页面后答题仍被结算为错题
- [根因] `endQuizSession()` 中 `finalizeUnansweredQuestions(as)` 直接修改 quizSet 将 undefined 改为 -1，`saveState()` 将此持久化到 localStorage。刷新后 `startQuizSession()` 不清除旧 -1 标记，导致这些标记混入后续答题记录
- [修复] [js/state.js](js/state.js) — `startQuizSession()` 在 `answered === 0`（无真实作答，全为 -1 或 undefined）时清除旧标记：`qs.userAnswers = new Array(n).fill(undefined)` 并重置 `currentIdx = 0`

---

## 2026-06-04 — 6 项 Bug 修复 + UX 优化 v3.5.0（仅测试环境 8080）

### Bug #1: 刷新页面答题进度恢复修复
- [修改] [js/quiz-engine.js](js/quiz-engine.js) — 新增 `_firstSyncDone` 标志，首次 sync 跳过 5s 节流立即发送；`restoreQuizFromServer()` 增加题目文本逐题比对，服务端题目数量/内容不匹配时跳过合并
- [修改] [js/state.js](js/state.js) — `startQuizSession()` 将 `-1`（未答占位）排除出"已答"计数，避免全部结算后无法重新进入；入口重置 `_firstSyncDone`
- [修改] [js/users.js](js/users.js) — `hasPartialProgress` 检测排除 `-1`，避免将已结算会话误判为有进度

### Bug #2: 文件池文件连坐删除 + 到期时间优化
- [新增] [backend/src/routes/files.routes.js](backend/src/routes/files.routes.js) — `POST /files/:id/unassign` 端点，解除章节关联（SET chapter_id=NULL）而不删磁盘文件
- [新增] [js/users.js](js/users.js) — `removeFileFromChapter()` 函数调用 unassign 端点；章节资料"删除"按钮改为"移除"并调用此函数
- [修改] [js/users.js](js/users.js) — `formatDuration()` 简化为只显示最大单位（X 天 / X 小时 / X 分钟），不再拼接二级单位

### Bug #3: 答题界面点击遮罩退出
- [修改] [index.html](index.html) — quiz-modal overlay 添加 `onclick="if(event.target===this)closeQuizModal()"`

### Bug #4: 文件池批量上传 + 拖入上传
- [修改] [js/users.js](js/users.js) — `handleFilePoolUpload()` 改为遍历 `e.target.files` 逐个上传；新增 `setupFilePoolDragDrop()` 拖放处理函数；`renderFilesPage()` 注入 drop-zone HTML
- [修改] [index.html](index.html) — file-pool-input 添加 `multiple` 属性
- [修改] [css/files.css](css/files.css) — 新增 `.drop-zone` / `.drop-zone-active` / `.drop-zone-icon` / `.drop-zone-text` / `.drop-zone-hint` 样式
- [修改] [css/dark-mode.css](css/dark-mode.css) — drop-zone 暗色模式覆盖

### Bug #5: 手机端滑块拖动带动全页面滚动
- [修改] [css/components.css](css/components.css) — `.dual-range-wrap` 和 `.multi-range-wrap` 添加 `touch-action: none`
- [修改] [css/responsive.css](css/responsive.css) — 移动端媒体查询中间接添加 `touch-action: none`

### Bug #6: 头像交互式裁剪编辑器
- [重写] [js/users.js](js/users.js) — `handleAvatarUpload()` 不再直接压缩至 200x200，改为打开裁剪弹窗；新增 `initAvatarCrop()` / `applyAvatarCropTransform()` / `updateAvatarCropZoom()` / `cancelAvatarCrop()` / `confirmAvatarCrop()` 完整交互裁剪函数
- [新增] [css/avatar-crop.css](css/avatar-crop.css) — 裁剪弹窗样式（圆形视口 280px、遮罩层、拖拽缩放控件、移动端适配）
- [修改] [css/dark-mode.css](css/dark-mode.css) — 裁剪弹窗暗色模式
- [修改] [index.html](index.html) — 引入 `css/avatar-crop.css`

---

## 2026-06-04 — 6 项 Bug 修复 v3.4.0（仅测试环境 8080）

### Bug #1: ECNU 流式出题达到目标数后无法自动结束
- [修改] [backend/src/routes/ai.routes.js](backend/src/routes/ai.routes.js) — `streamDone` 时发送 `done` SSE 事件 + `res.end()`，传出 `accumulatedQuestions.slice(0, totalQ)`，不再直接 return 导致前端挂等超时。修复在 route handler 层，不修改 ecnu.js provider

### Bug #2: 刷新页面/换设备导致未答题自动结算
- [新增] [backend/sql/migration_v3.4.sql](backend/sql/migration_v3.4.sql) — `answer_sessions` 新增 `subject_id VARCHAR(64)`、`status VARCHAR(16) DEFAULT 'in_progress'` 列
- [重写] [backend/src/routes/quiz.routes.js](backend/src/routes/quiz.routes.js) — POST 接受 `subjectId`/`setId`/`status`；in_progress 持续更新，completed 锁定拒改（409）；GET /sessions 支持 `?status=` 筛选
- [修改] [js/quiz-engine.js](js/quiz-engine.js) — `restoreQuizFromServer()` 只请求 `?status=in_progress`、跳过 `-1` 标记、选最新会话；`syncAnswerToServer()` 发送 `status: 'in_progress'`；`syncAnswerToServerFinal()` 发送 `status: 'completed'`

### Bug #3: 文件池 — AI 直接从池中调取源文件
- [修改] [backend/src/routes/ai.routes.js](backend/src/routes/ai.routes.js) — `POST /ai/generate` 接收 `chapterId`，查询 `user_files` 从磁盘 `/home/qbao/uploads/pool/{userId}/` 读取文件并用 `extractText()` 提取内容合并到 prompt
- [修改] [backend/src/routes/files.routes.js](backend/src/routes/files.routes.js) — `POST /:id/assign` 移除 `in_pool = false`，分配后文件保留在池中
- [修改] [js/users.js](js/users.js) — `renderFilesPage()` 移除池文件"分配到当前章节"按钮

### Bug #4: 章节内上传资料归入文件池并自动分配
- [修改] [backend/src/routes/files.routes.js](backend/src/routes/files.routes.js) — `POST /upload` 接受 `chapterId`，传入时直接设置 `chapter_id`
- [修改] [js/ai-workflow.js](js/ai-workflow.js) — `handleAiFiles()`/`handleCmFiles()` 在 IndexedDB 存储后同时 `POST /files/upload` + `chapterId`

### Bug #5: 头像上传后保存消失
- [修改] [backend/src/routes/users.routes.js](backend/src/routes/users.routes.js) — `PUT /me/avatar` 解码 base64 → 写入磁盘文件 `/home/qbao/uploads/avatars/{userId}.jpg`，DB 存相对路径而非 data URL
- [修改] [backend/server.js](backend/server.js) — 新增 `app.use('/uploads', express.static(...))` 静态文件服务
- [修改] [js/users.js](js/users.js) — `saveAccountChanges()` 保存前暂存 `avatar`/`avatarUrl`，`authUser = json.user` 覆盖后恢复

### Bug #6: 章节进度条改为章节累计统计
- [修改] [js/quiz-engine.js](js/quiz-engine.js) — 新增 `calcChapterStats(chapterId)` 遍历所有 quizSets，仅统计已完成的集合（answered >= total 且无 `-1`）；`updateChapterProgress()` 调用新函数；`calcStats()` 排除 `-1`
- [修改] [js/subjects.js](js/subjects.js) — 侧栏统计排除 `-1` 和未完成集合
- [修改] [index.html](index.html) — 进度条标签改为"章节正确率/章节题量/错题数"

### 附：AI 提示词编号修复
- [修改] [js/strategy.js](js/strategy.js) — `generatePromptText()` 标签标注行动态编号（tagLine7 存在时 `8.` 否则 `7.`）
- [修改] [backend/src/routes/ai.routes.js](backend/src/routes/ai.routes.js) — chapterHistory 附加要求改用 `- ` 列表避免编号冲突

### 部署确认
- 仅上传测试环境（8080 + 3001），生产环境（9178 + 3000）未触碰
- SQL migration_v3.4 已执行（`sudo -u postgres psql -d qbao`）
- `/home/qbao/uploads/avatars/` 目录已创建
- 前端 7 文件 + 后端 5 文件，MD5 全部校验通过
- PM2 qbao-api-test 已重启

---

## 2026-06-04 — 文件同步 + 账号修复 + 积分预留 Part 3（仅测试环境 8080）

### 文件过期前端同步
- [修改] [js/users.js](js/users.js) — init() 登录后调用 checkExpiredFilesOnLogin() 检测即将过期文件（24h 内），弹出提示横幅；横幅点击跳转文件管理页，8s 自动消失
- 服务端 GET /files 已含 cleanupExpiredFiles()（Part 2 完成），每次打开文件管理页自动清理

### 存储积分预留
- [修改] [js/users.js](js/users.js) — renderAccountPage() 新增存储积分显示区域（当前积分 + 续期说明）；renderFilesPage() 顶部新增积分余额 badge；续期按钮改为"续期 (10积分)"，title 提示需 10 积分（功能预留）
- 后端 GET /users/me 已返回 storagePoints（Part 2 完成）

### 账号管理修复
- [修改] [js/users.js](js/users.js) — handleAvatarUpload() 改为 Canvas 压缩至 200x200（JPEG 0.8），避免 data URL 过大；saveAccountChanges() 新增头像上传到服务端（PUT /users/me/avatar）、修复 openUserCenter() → renderAccountPage() 刷新当前页面 + 更新弹窗头部名称和头像；保存后合并 avatarUrl 确保显示一致

### CSS 补充
- [修改] [css/files.css](css/files.css) — 新增 .file-expiry-banner 横幅样式 + 滑入动画
- [修改] [css/dark-mode.css](css/dark-mode.css) — 新增文件过期横幅、存储积分暗色覆盖
- [修改] [css/responsive.css](css/responsive.css) — 新增文件过期横幅移动端全宽底部定位、存储积分移动端纵向排列

### 部署确认
- 仅上传测试环境（8080），生产环境（9178）未触碰
- 后端无变更（Part 2 已有全部 API）
- MD5 全部校验通过

---

## 2026-06-04 — 答题持久化 + 文件管理 Part 2（仅测试环境 8080）

### 数据库
- [新增] [backend/sql/migration_v3.sql](backend/sql/migration_v3.sql) — v3.3 迁移脚本：answer_sessions、user_files 表，users 表新增 storage_points
- [修改] [backend/init.sql](backend/init.sql) — 新建安装含新表

### 后端：答题会话 API
- [新增] [backend/src/routes/quiz.routes.js](backend/src/routes/quiz.routes.js) — POST/GET/DELETE 答题会话 CRUD，user+chapter upsert
- [修改] [backend/server.js](backend/server.js) — 注册 quiz.routes、files.routes

### 后端：文件管理 API
- [新增] [backend/src/routes/files.routes.js](backend/src/routes/files.routes.js) — 文件池上传/列表/删除/分配章节/续期，含过期清理
- [修改] [backend/src/routes/users.routes.js](backend/src/routes/users.routes.js) — GET /users/me 返回 storage_points

### 前端：答题服务端同步
- [修改] [js/quiz-engine.js](js/quiz-engine.js) — 新增 syncAnswerToServer()（5s 节流）和 syncAnswerToServerFinal()（结束强制同步）
- [修改] [js/state.js](js/state.js) — endQuizSession() 结束时调用 syncAnswerToServerFinal
- [修改] [js/srs.js](js/srs.js) — endExamGenerated() 结束时调用 syncAnswerToServerFinal

### 前端：文件管理页
- [修改] [index.html](index.html) — 用户中心侧栏新增"文件管理"tab + #ucm-tab-files 内容容器；章节资料弹窗新增"从文件池选择"按钮
- [修改] [js/users.js](js/users.js) — 新增 renderFilesPage()/uploadToFilePool()/handleFilePoolUpload()/assignFileToChapter()/deleteFileFromPool()/extendFileInPool()/formatDuration()/formatFileSize()/getFileIcon()；switchUcModalTab 添加 'files' 分支
- [新增] [css/files.css](css/files.css) — 文件列表样式
- [修改] [css/dark-mode.css](css/dark-mode.css) — 文件管理暗色覆盖
- [修改] [css/responsive.css](css/responsive.css) — 文件管理移动端适配（操作按钮折行）
- [修改] [js/ai-workflow.js](js/ai-workflow.js) — 新增 openFilePoolForChapter()/assignFilePoolToChapter() 供章节资料弹窗从文件池选择

### 部署确认
- 仅上传测试环境（8080 + 3001），生产环境（9178 + 3000）未触碰
- migration_v3.sql 已执行：answer_sessions + user_files 表已创建
- API 端点已注册，PM2 qbao-api-test 已重启

---

## 2026-06-04 — AI 多模型兼容 Part 1（仅测试环境 8080）

### 后端：Provider 抽象层
- [新增] [backend/src/providers/index.js](backend/src/providers/index.js) — Provider 工厂，注册 4 个提供商：ECNU/DeepSeek/OpenAI/Gemini
- [新增] [backend/src/providers/ecnu.js](backend/src/providers/ecnu.js) — ECNU 提供商（从 ai.routes.js 提取）
- [新增] [backend/src/providers/deepseek.js](backend/src/providers/deepseek.js) — DeepSeek 提供商，baseURL `https://api.deepseek.com`，模型 `deepseek-v4-flash`/`deepseek-v4-pro`
- [新增] [backend/src/providers/openai.js](backend/src/providers/openai.js) — OpenAI ChatGPT 提供商，支持原生 json_schema + streaming
- [新增] [backend/src/providers/gemini.js](backend/src/providers/gemini.js) — Gemini 提供商（adapter 层），处理 messages→contents 转换、SSE 格式差异、API key query param

### 后端：路由重构
- [修改] [backend/src/routes/ai.routes.js](backend/src/routes/ai.routes.js) — 移除 ECNU 硬编码，接入 provider 层；新增 `GET /api/v1/ai/providers` 端点；流式路径统一使用 provider 接口

### 前端：Provider + Model 双级选择器
- [修改] [index.html](index.html) — 设置弹窗 AI 配置区替换为 Provider 下拉 + Model 下拉联动 + 自动更新 Base URL
- [修改] [js/settings.js](js/settings.js) — `loadAiConfig()` 从后端获取 provider 列表；新增 `onAiProviderChange()`/`fetchProviders()`/`populateProviderSelect()`/`updateAiBaseUrl()`；`saveAiConfig()` 存储 per-provider keys；`testAiConfig()` 传 `x-ai-provider`
- [修改] [js/config.js](js/config.js) — 新增 `aiProviders`、`aiCurrentProvider` 全局变量
- [修改] [js/state.js](js/state.js) — `migrateState()` 新增旧 apiKey→providerKeys 迁移逻辑
- [修改] [js/ai-workflow.js](js/ai-workflow.js) — 所有 `/ai/generate` 调用添加 `x-ai-provider` header，使用 per-provider key

### 部署确认
- 仅上传测试环境（8080 + 3001），生产环境（9178 + 3000）未触碰
- 后端 API：`GET /api/v1/ai/providers` 返回 4 个 provider 含模型列表
- MD5 全部校验通过

---

## 2026-06-04 — Bug 修复 & UX 优化 (第四轮)

### 开始出题按钮任务完成后状态修复
- [ai-workflow.js](js/ai-workflow.js): `_aiExecuteTask()` 任务完成路径新增 `updateGenerateButtonState()` 调用；`aiTaskRunnerLoop()` 两个退出路径均新增 `updateGenerateButtonState()` 调用。解决出题任务结束后按钮仍灰色显示"该章节已有任务在队列中"的问题

### 备份功能重写 — 兼容 HTTP 环境
- [backup.js](js/backup.js): File System Access API (`showDirectoryPicker`) → JSON 下载/上传通用方案。`doManualBackup()` 生成 `.json` 并通过 `<a download>` 触发下载；`restoreFromFile()` 通过 `<input type="file">` 选择备份文件恢复；移除目录句柄 IndexedDB 存储、`autoBackup()`/`tryAutoRestore()` 等 HTTP 不可用代码
- [index.html](index.html): 备份对话框简化为直接下载；回档对话框改为文件上传入口
- [users.js](js/users.js): `renderDataPage()` 简化备份操作区域

### 报告页 UX 优化
- [index.html](index.html): 移除报告页"重新开始"按钮；"只看错题"/"显示全部" + "返回首页"放入 `report-bottom-bar`
- [modals.css](css/modals.css): 新增 `.report-bottom-bar` — `position: sticky; bottom: 0` 固定在 quiz-modal 滚动容器底部

### 用户中心 UI 美化
- [users.js](js/users.js): `renderAccountPage()` 头像/显示名称/修改密码改为独立卡片式分区；`renderDataPage()` 备份/云同步改为卡片式布局
- [modals.css](css/modals.css): `.account-manage-section` 增加卡片底板（`background` + `border` + `border-radius`）；input focus 增加 box-shadow

### 运维
- 部署至 8080 测试 + 9178 生产，MD5 全量匹配
- 本地版本备份: `Version/Qbao_v3.2.2/`
- GitHub: commit `1a7e1a5`，push `origin/main`

---

## 2026-06-04 — 生产端口同步 & Nginx 缓存修复

### 问题发现
- 9178 生产端口页面行为与 8080 测试不一致（消息栏移动端不独立、开始出题底栏不固定）
- MD5 校验 36 个文件全部一致，排除文件差异

### 根因分析
1. **Nginx `expires 1h`**: 9178 server block 配置了静态资源缓存 1 小时，浏览器使用旧缓存不请求新文件；8080 无此配置故每次刷新生效
2. **SCP 路径错误**: 批量 `scp` 上传 CSS 时目标路径写成 `/var/www/qbao/` 根目录而非 `css/` 子目录，残留 4 个 CSS + 2 个 JS 在根目录（不影响功能但造成干扰）

### 修复
- [Nginx] 9178 `location /` 中 `expires 1h;` → `add_header Cache-Control "no-cache, must-revalidate";`
- [服务器] 清理 `/var/www/qbao/` 和 `/var/www/qbao_test/` 根目录残留文件
- [Nginx] `nginx -t && systemctl reload nginx`
- [验证] `curl -sI` 确认 9178 返回 `Cache-Control: no-cache, must-revalidate`

### 服务器后端端口
- 9178 生产 → API `proxy_pass http://127.0.0.1:3000`
- 8080 测试 → API `proxy_pass http://127.0.0.1:3001`

### 文档更新
- [SKILL.md](SKILL.md): 服务器信息表补充后端端口映射 + Nginx 单文件双 server block 说明；新增注意事项 #12 Nginx 缓存坑

---

## 2026-06-04 — Bug 修复 & UX 优化 (第三轮)

### isOnlineMode 崩溃修复
- [ai-workflow.js](js/ai-workflow.js): 修复两处 `isOnlineMode()` 函数调用 → `isOnlineMode` 变量引用。`config.js` 中定义为 `let isOnlineMode` 而非函数，误写导致 TypeError 中断 `init()` 执行链，连锁导致 `updateAuthUI()` 和 `loadNotices()` 未执行

### 上传资料后按钮状态
- [ai-workflow.js](js/ai-workflow.js): `handleAiFiles()` 和 `handleCmFiles()` 的 reader.onload 回调中新增 `updateGenerateButtonState()` 调用，上传资料后"开始出题"按钮即时变绿，无需刷新

### 消息栏滚动速度自适应
- [notices.js](js/notices.js): `applyNoticeScrollClass()` 新增 `--scroll-duration` CSS 变量计算，取当前消息的 `duration` 设置值（最低 3s），驱动 marquee 动画速度匹配管理员设定的展示时长
- [topbar.css](css/topbar.css): `.scroll` 动画 duration 从固定 `14s` → `var(--scroll-duration, 14s)`

### 运维
- 部署至生产端口 9178，MD5 校验通过
- 本地版本备份: `Version/Qbao_v3.2.1/`
- GitHub: commit `21d4cab`，push `origin/main`

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
