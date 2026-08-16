# 更新日志 (Changelog)

本文件面向 GitHub 访客，按版本记录公开发布的功能与修复。
> 完整开发日记保留在本地 `local/log.md`（不公开）。

## v3.27.2

- 系统性交互 bug 修复（用户反馈 + 全组件代码审计）：
  - 修复科目/章节行悬停时操作按钮现身导致的整列位移（行高固定 + 操作按钮绝对定位覆盖）
  - 修复生产环境图标全部消失：img/icons.svg 此前从未部署到服务器，本次随包发布
  - 修复设置弹窗打开空白：打开时始终落到「个性化」tab、未知 tab 回退、去除 backdrop-filter 绘制风险
  - 修复开关滑块几何（44→40px 轨道、滑块行程与轨道匹配）、侧栏左下角 AI 出题开关对齐
  - 修复出题策略双滑块拖动卡顿（拖动中不再整库序列化，仅松手时持久化）
  - 答题历史重设计：按章节查看每一轮（默认当前章节、章节选择器、轮次折叠、只看错题/搜索、单轮 30 题起分批渲染）
  - 长列表折叠：知识点标签列（>5 个折叠 + 展开全部）、题库按章节折叠 + 单章 50 题分页、文件列表/资料列表/分享车限高滚动、消息列表最多渲染 200 条
  - 科目行单击直接展开/收起（原悬浮小箭头按钮删除），科目总览入口移至行内操作按钮
  - 移除顶栏与侧栏重复的「好友」入口（统一为侧栏「好友消息」+ 角标）
  - 修复 strategy 缺失 typeCounts 时主页崩溃（数据归一化 + 取值保护）
  - 修复历史章节选择器 v-if/v-for 同元素导致选项不渲染
  - 修复公告管理「启用/停用」文案颠倒、工单操作按钮透明却可点击、用户中心未知 tab 空白、大考卷章节空引用、题库答题图标/策略卡 emoji 图标化、题号点大题量开窗渲染等审计项

## v3.27.1

- 视觉升级 v5：设计 token 全面对齐 DeepSeek 官方 --dsw-* 色板（主蓝 #4176E6、alpha 边框、圆角 4/6/8/12、暗色 #151517/#232324 体系、官方语义色 #22C55E/#EF4444）
- 借助 ecnu-plus 视觉模型完成两轮截图级设计评审（4 位评审 × 15 界面状态）并逐项修复：Toast 类型色条/图标/队列/弹窗隐藏、侧栏重组为「科目树/导航区/账号区」+ 章节进度条、主页 hero 压缩 + 主 CTA「开始刷题」、危险操作确认（删除/重置/清除密钥）、导入 JSON 实时校验+预览+追加/替换模式、登录弹窗离线模式移为底部链接 + 密码可见性切换、答题页题号图例/上一题/查看报告
- 浮层治理：弹窗打开自动收起侧栏抽屉、z-index 分层规范（侧栏 9500 < 弹窗 9800 < Toast 10000）、移动端弹窗防遮挡
- 无障碍与细节：全局 :focus-visible 聚焦环、prefers-reduced-motion、ARIA 题号导航、触控目标 ≥40px、暗色幽灵按钮对比度修正

## v3.27.0

- 前端大规模重构：Vue 3 + Vite + Pinia 全量组件化（JavaScript），27 个全局脚本（约 7800 行）迁入 `app/src/`（stores/services/components/views 分层），业务算法原样保留
- DeepSeek 设计语言重设计：官方同款色板（主蓝 #4D6BFE / 背景 #F8F9FB / 暗色 #17181C）、SVG 线性图标、扁平无气泡聊天、全套组件库（按钮/输入/胶囊/状态 pill/Toast/空状态/弹窗），暗色模式从零重做
- 移动端网页一等公民：≤900/768/480 断点、侧栏抽屉、全屏弹窗、触控 ≥44px、safe-area、答题页底部操作栏、聊天单栏切换
- 工程化：Vite singlefile 打包（file:// 与 CSP 兼容、KaTeX 外部化）、桌面端 dev 加载 Vite dev server + 打包回退、CI 前端 job 改为构建门禁 + 服务层单测（10 例 vitest）
- 服务端 AI 任务队列前端补全：任务弹窗「服务端任务」区（列表/轮询/取消/一键导入/刷新恢复），停止全部同步取消服务端排队任务
- AI 配置对齐 provider 目录：baseUrl/能力徽章取自 /ai/providers，按 provider 记忆模型（消除 DeepSeek 残留 ecnu-plus 422），密钥可见性切换与清除按钮
- 新增答题/报告「分享给好友」目标选择器（好友/群聊，复用聊天分享车）
- 修复：chat v2 房间详情成员查询补回 avatar_url（直聊头像显示回归）
- AI API Key 移出 `state.aiConfig`，改为按账号本机存储，不再随 `user_data` 同步
- `GET/PUT/PATCH /api/v1/data` 服务端强制剥离 `aiConfig.apiKey/providerKeys`；备份创建/读取同样脱敏
- 新增存量数据清洗：`npm run scrub:ai-keys -- --dry-run` 与 `server/sql/migration_v3.27_scrub_ai_keys.sql`
- AI Provider 能力目录：`providers/catalog.js` 统一描述 apiStyle/capabilities/defaults/models；`GET /ai/providers` 返回完整能力
- `POST /ai/generate` 接入 zod 校验与严格 provider/model 匹配，未知供应商不再静默回退 ECNU
- 新增 `POST /ai/test` 最小化连接测试，不再复用生成接口
- 修复流式路径系统提示词重复拼接；移除 API Key 日志；max_tokens 受模型 maxOutput 约束
- Provider 适配层：ECNU/DeepSeek/OpenAI 合并为 OpenAI-compatible 基座；新增跨 chunk 缓冲的 SSE 解析器
- 文件提取缓存：`user_files` 增加 `extract_status/extracted_text/text_hash/source_mtime_ms/source_size`，相同文件不重复解析
- 题目结构校验器：拦截 answer 越界、缺 tag、题干过短等硬错误，非流式响应附 `validation.warnings`
- Node 版迁移执行器：`npm run migrate -- <sql文件>`，不再依赖 psql
- AI 题目解析服务：`normalizeQuestions/repairJson/tryExtractCompletedObjects` 迁至 `src/services/aiQuestionParser.js`，路由改为薄包装
- 流式生成结果接入题目校验器，SSE `done` 事件附 `validation.warnings`
- AI 请求审计补齐：`started/ok/error/parse_error` 状态覆盖流式、非流式与失败路径
- 部署与守护：`server/deploy/qbao-api.service` systemd 模板、`server/deploy/README.md`；本地一键脚本 `local/deploy-qbao.ps1`
- 安全修复：封禁检查改为 `await` 后放行；首个注册用户作为管理员引导，禁止凭用户名注册提权；启动时强校验 `JWT_SECRET`
- AI 自动判定开关：用户可配置 `selfCheck`，生成后由 AI 二次审核并修正题目，失败自动降级保留原始结果
- 服务端 AI 任务队列 v1：`ai_tasks` 表 + `/api/v1/ai/tasks` 创建/查询/取消，进程内 worker 串行执行非流式生成；API Key 不落库
- 前端接入服务端任务队列：设置项“服务端任务队列”，开启后 AI 出题改走 `/ai/tasks` 后台执行并轮询结果
- 路由治理：`files` 迁至 `files.routes.v2.js`，接入 zod/asyncHandler/ApiError，上传增加扩展名白名单
- 路由治理：`backup`、`share` 迁至 v2，接入 zod/asyncHandler/ApiError；分享码改用加密随机数
- 路由治理：`notices` 迁至 v2，接入 zod/asyncHandler/ApiError
- 路由治理：`users` 迁至 v2，接入 zod/asyncHandler/ApiError；头像 base64 限制 5MB，管理员角色枚举校验
- 路由治理：`issues` 迁至 v2，接入 zod/asyncHandler/ApiError；修复图片文件名路径穿越；状态流转与事务保持原逻辑
- 路由治理：`chat` 迁至 v2，接入 zod/asyncHandler/ApiError；修复 `update-quiz` 越权；撤回时清空附件；文件下载防路径穿越；房间列表消除 N+1 成员查询




















## v3.26.0

- 2026-08-16 — 后端结构化重构（Phase 5）：统一错误处理（ApiError + errorHandler + asyncHandler，响应统一为 `{error,...}`，不再向客户端泄露内部异常）、zod 参数校验（auth/data/quiz 三组路由）、Vitest + supertest 测试骨架（25 个用例覆盖健康检查/校验/rev 乐观锁 409/错误处理）并接入 CI；bcrypt → bcryptjs（纯 JS，免原生编译，哈希格式互通）
- 2026-08-16 — 桌面端打磨（Phase 6）：设置新增「桌面端」页（版本/服务器地址显示、应用内检查更新与下载进度、开机自启开关、修改服务器地址入口）；更新发现/下载开始/下载完成增加 Windows 系统通知

## v3.25.3

- 2026-08-15 — 修复：首次配置服务器地址后应用意外退出（窗口重建竞态）、启动自动检查更新有结果但不弹提示、409 冲突重试的 rev 空值守卫

## v3.25.2

- 2026-08-15 — 修复：打包后前端加载路径错误导致白屏（asar 内 app/ 路径）、隐藏默认菜单、加载失败弹窗诊断、打包版冒烟测试钩子

## v3.25

- 2026-08-15 — 双形态化第一阶段：API_BASE 运行时动态化（Electron 注入 `__QBAO_RUNTIME__`）、同步层 rev 乐观锁（409 冲突自动合并重试）、saveState 失败可见化、Electron 桌面壳（desktop/，electron-updater 自动更新）、CI Release 流水线、服务器恢复与防火墙端口矩阵文档

## v3.24.4

- 2026-06-30 — 主观题自动聚焦 + Enter提交/Shift+Enter换行 + '我不会'题号红色修复

## v3.24

- 2026-06-29 — 大考卷设置记忆+占比直接输入+8项修复

## v3.23

- 2026-06-29 — prevent quiz modal from auto-opening on page refresh

## v3.22

- 2026-06-25 — 新增我不会按钮 + 科目/章节置顶排序

## v3.21

- 2026-06-22 — Fix tag loss in _reclassifyTagsByRound + add console.error to chat catch blocks

## v3.18

- 2026-06-21 — -v3.20: 四项 bug 修复

## v3.12.1

- 2026-06-09 — AI 出题流式/严格模式自动检测修复

## v3.12.0

- 2026-06-08 — AI 出题流式/严格模式自动选择

## v3.11.12

- 2026-06-08 — rollback: revert v3.12.0 ai_auto_stream_strict changes
- 2026-06-08 — fix "只看错题" button requiring two clicks

## v3.11.11

- 2026-06-08 — fix share selector empty + report unclosable regression

## v3.11.10

- 2026-06-08 — quiz resume fix — auto-finalize on close/refresh when all answered

## v3.11.9

- 2026-06-08 — quiz share button + tag drag diag + file upload 409 toast

## v3.11.8

- 2026-06-08 — fix 开始答题按钮永不显示 + Share API JSON序列化&路由顺序

## v3.11.7

- 2026-06-08 — bank-share guard for questions without answer

## v3.11.6

- 2026-06-08 — fix refresh badge + bank share missing answer

## v3.11.5

- 2026-06-08 — fix script load order (chat.js before users.js) + answer fallback

## v3.11.4

- 2026-06-08 — badge polling guarantee via showScreen + answer unified to letter format

## v3.11.3

- 2026-06-08 — backend fixes — revoke updated_at + answer normalization + polling self-start

## v3.11.2

- 2026-06-08 — fix revoke sync, quiz flicker, bank-share answer, badge robustness

## v3.11.1

- 2026-06-08 — fix badge not appearing before first chat + own message timestamp invisible

## v3.11

- 2026-06-08 — incremental message updates — append only, never rebuild on poll

## v3.10.6

- 2026-06-08 — skip innerHTML when content unchanged to prevent flicker

## v3.10.5

- 2026-06-08 — eliminate chat flicker + faster badge notifications

## v3.10.4

- 2026-06-08 — remove content hash skip — always render + 2s polling

## v3.10.3

- 2026-06-08 — fix message display race condition + silent error swallowing

## v3.10.2

- 2026-06-08 — fix badge polling, batch quiz answer rendering, and 429 rate limit

## v3.10.1

- 2026-06-07 — chat answer speed optimization + 429 fix + dashboard crash fix

## v3.10

- 2026-06-07 — 题库修复 + 聊天渲染崩溃修复

## v3.7.2

- 2026-06-06 — P0/P1/P2/P3 bugfix sprint — 同步到生产环境 9178

## v3.6.9

- 2026-06-05 — 移动端标签拖拽 touch-action 修复

## v3.6.8

- 2026-06-05 — AI新题禁止复用已有标签 + 标签面板滚动修复

## v3.6.7

- 2026-06-05 — newTopicTags 改为纯用户管理 + 标签面板滚动

## v3.6.6

- 2026-06-05 — 移除 prompt hasNew 分支，统一新文件/旧文件措辞

## v3.6.5

- 2026-06-05 — 修复 newTopicTags 属性名 bug + 保护新题标签不被自动清空

## v3.6.4

- 2026-06-05 — 移除独立标签提取API，拖拽全面重写为程序化事件

## v3.5.1

- 2026-06-04 — 头像裁剪 + 刷新恢复修复

## v3.5.0

- 2026-06-04 — 6 项 Bug 修复 + UX 优化

## 其他

- 2026-08-15 — docs: 添加 MIT LICENSE、后端 .env.example、部署文档与项目计划
- 2026-08-15 — chore: 扩充 .gitignore 敏感文件黑名单 + 清理 .bak/.save 与 backend/src/src 重复目录
- 2026-06-13 — fix: 回退 v3.14 策略配额双维度筛选 — 恢复简洁流式累积逻辑 (v3.17)
- 2026-06-13 — docs: README 添加 LaTeX/KaTeX 公式渲染功能说明
- 2026-06-13 — fix: LaTeX/KaTeX 数学公式渲染支持
- 2026-06-12 — fix: 答题完成后状态同步 & 错题标签自动迁移 (v3.15)
- 2026-06-12 — Revert v3.14 to v3.13.1 — 测试服更新尝试不成功，回退到生产服稳定版本
- 2026-06-11 — feat: v3.14 — 出题策略强制约束：双维度筛选 + 同轮注入
- 2026-06-11 — feat: v3.12.3 — AI provider auto-config, DeepSeek streaming+json_object, response_format cleanup
- 2026-06-10 — feat: 科目章节折叠功能 (v3.12.2)
- 2026-06-07 — docs: README 新增用户反馈功能介绍
- 2026-06-07 — feat: v3.8.0 用户反馈/Issue 系统
- 2026-06-07 — chore: remove Qbao_skill.lnk from tracking, add *.lnk to gitignore blacklist
- 2026-06-07 — 安全清理: README移除服务器地址 + Git移除敏感/非主体文件
- 2026-06-07 — 文档重构: SKILL.md 精炼为开发者参考 + README.md 提取用户指南
- 2026-06-05 — 精简 log.md v3.5.2 条目为要点记录
- 2026-06-05 — 修复答题进度持久化：null处理、-1清理、跨设备恢复、文件池重新分配等8项bug
- 2026-06-04 — 6项Bug修复: ECNU流式结束/答题持久化status锁定/文件池AI读取/章节上传归池/头像服务端存储/章节进度累计统计 (v3.4.0)
- 2026-06-04 — 答题持久化 + 文件管理 + 账号修复 (Part 2+3): answer_sessions/file_pool/avatar_compress/storage_points
- 2026-06-04 — AI多模型兼容 Part 1: Provider抽象层支持DeepSeek/OpenAI/Gemini
- 2026-06-04 — fix: 开始出题按钮状态、备份功能修复 & 报告页/用户中心 UX 优化
- 2026-06-04 — fix: isOnlineMode crash + notice scroll speed + material upload button state
- 2026-06-04 — Phase 7: Modal refactoring + UX improvements
- 2026-06-03 — Phase 2+3: JS modularization & UI redesign
- 2026-06-03 — Merge remote-tracking branch 'origin/main'
- 2026-06-03 — Phase 1: CSS modular split - extract inline CSS to 15 modular files
- 2026-05-07 — Add files via upload
- 2026-05-07 — Delete Qbao1.0.html
- 2026-05-07 — Add files via upload
- 2026-05-07 — 更新至 v1.3: 文件名改为 Qbao.html, 新增间隔复习/错题本/大考卷等功能
- 2026-05-06 — 更新 Qbao1.0：分区域字体调节、备份兼容升级、标题改为 Qbao
- 2026-04-29 — Qbao1.0 - initial release


---

## 版本管理说明

- 版本快照（含更细的历史版本）保存在本地 `local/Version/`，不随 Git 发布。
- 每个发布版本对应 Git tag 与 GitHub Release（规划中）。
