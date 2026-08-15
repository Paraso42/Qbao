# 更新日志 (Changelog)

本文件面向 GitHub 访客，按版本记录公开发布的功能与修复。
> 完整开发日记保留在本地 `local/log.md`（不公开）。

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
