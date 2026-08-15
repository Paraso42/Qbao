# 架构说明与重构方向

> 最后更新：2026-07。本文描述当前架构、已知技术债，以及向正式软件转化的初步重构方向。

## 1. 系统拓扑

```
浏览器 (app/ 纯静态 SPA，无构建)
   │ HTTPS  /api/v1/*   /uploads/*
   ▼
Nginx (静态托管 + 反向代理 + TLS)
   │ /api → http://127.0.0.1:3000
   ▼
server/  Node.js + Express API（端口 3000）
   ├── PostgreSQL（库名 qbao）
   └── 外部 AI API（ECNU / DeepSeek / OpenAI / Gemini，由后端代理调用）
```

- 前后端**同源部署**：前端 `js/config.js` 固定 `API_BASE = '/api/v1'`，由 nginx 反代到后端。
- 移动端与桌面共用同一套响应式前端，无独立客户端。

## 2. 前端（app/）

- **技术形态**：无框架、无构建。`index.html` 是唯一入口（约 45KB，包含全部页面与弹窗 DOM），20 个 JS 模块按 `<script>` 顺序加载，共享全局命名空间。
- **状态**：本地 localStorage/IndexedDB（`js/db.js`）+ `js/state.js` 统一状态入口；登录后与云端 `user_data.state_json` 做全量双向同步。
- **渲染**：手工 DOM/innerHTML 拼接 + 事件委托，无虚拟 DOM、无组件抽象。
- **主要模块**（按体量）：

| 模块 | 大小 | 职责 |
|------|------|------|
| js/chat.js | 90KB | 好友/群聊、消息渲染、轮询增量、题目分享、撤回 |
| js/users.js | 61KB | 注册登录、用户中心、头像裁剪 |
| js/ai-workflow.js | 44KB | AI 出题工作流（上传资料→流式生成→入库） |
| js/feedback.js | 31KB | 反馈/工单（Issue）全流程 |
| js/dashboard.js / strategy.js | 25KB | 仪表盘、章节策略分析 |
| js/quiz-engine.js / exam.js | 20KB+ | 答题引擎、考试模式、主观题 |
| js/state.js | 19KB | 全局状态与同步 |

## 3. 后端（server/）

- **框架**：Express 4 + pg 连接池；12 个路由模块、约 60 个端点（见 routes/ 下 auth/data/backup/ai/share/notices/users/quiz/files/issues/chat）。
- **鉴权**：JWT（30 天）+ bcrypt 密码哈希；`requireAuth` / `requireAdmin` 中间件；`express-rate-limit` 全局与登录限流。
- **AI 层**：`providers/` 每供应商一个适配器（ecnu / deepseek / openai / gemini），统一「流式 / 严格 JSON」两轴能力开关；用户自配 API Key，经请求头 `x-ai-api-key` 传入后端。
- **数据**：核心业务数据整包存 `user_data.state_json JSONB`，`GET/PUT /api/v1/data` 全量读写；答题会话、聊天、反馈、公告、文件、分享各有独立表。
- **上传**：multer 多实例。共享文件池/聊天图片/头像落在仓库根 `uploads/`，AI 临时文件落在 `server/uploads/`（不一致，见 §5-6）。

## 4. 数据模型要点

`users`（账号）、`user_data`（整包业务状态 JSONB）、`backups`（用户备份）、`shared_banks`（题库分享）、`ai_request_log`（AI 调用审计）、`answer_sessions`（按章节答题会话）、`user_files`（资料文件池）、`issues / issue_messages`（反馈工单）等；建表脚本 `server/init.sql` + `server/sql/migration_v*.sql`。

## 5. 已知技术债与重构方向（初步判断）

### P0 — 安全与正确性（优先）

1. **CORS 全开**：`cors({ origin: true })` 反射任意 Origin。同源部署场景应改为白名单或直接关闭。
2. **上传安全**：有大小上限但缺 MIME 白名单与图片重编码（防伪造类型/恶意内容）。
3. **全量同步冲突**：`user_data` 单行 JSONB 全量覆盖是 last-write-wins，多端并发会互相覆盖，且每次同步放大写。短期加版本号乐观锁，中期按实体拆表。
4. **统一错误处理**：路由内大量手工 try/catch + 直接 `res.status(...)`。抽 `ApiError` + errorHandler 中间件，统一响应格式。
5. **请求校验缺失**：大部分端点直接信任入参。引入 zod/joi 做 schema 校验。
6. **上传目录不一致**：统一 `server/uploads/`（或独立数据卷），static 服务与 multer 指向同一处。

### P1 — 可维护性

7. **chat.js（90KB）拆分**：消息渲染 / 增量轮询 / 分享选择器 / 撤回各自独立模块。
8. **index.html 单文件 DOM**：按页面拆分模板（`<template>` 或 JS 模板函数），弹窗组件化。
9. **前端模块化**：迁移 ES Modules（`type=module` 或轻量构建 esbuild/vite 打包压缩），消除全局变量依赖与脚本顺序耦合。
10. **后端分层**：routes → services → repositories，SQL 集中到数据访问层（当前散落各路由）。
11. **测试骨架**：前端 Vitest + jsdom 先覆盖 quiz-engine/srs 等纯逻辑；后端 supertest 覆盖 auth/data/quiz 主流程；接入 CI。
12. **配置集中**：散落的路径常量（uploads、pool）收敛到 server/src/config.js。

### P2 — 工程化与正式软件化

13. **渐进 TypeScript**：后端先行，JSDoc 注解过渡。
14. **容器化**：Docker Compose（nginx + server + postgres）一键部署。
15. **CI/CD**：CI 现有语法检查，逐步加测试、构建产物、自动部署。
16. **可观测性**：结构化日志（pino）、错误上报（Sentry/自建）、健康与指标端点。
17. **迁移工具化**：node-pg-migrate / drizzle 替代手写 SQL 人工执行。
18. **发布流程**：CHANGELOG + git tag + GitHub Release，自动打包 app/ 静态资源。

## 6. 迁移与兼容性注意

- 2026-07 目录重组（`backend→server`、前端→`app/`）后，**生产部署路径需同步更新**（见 DEPLOY.md）；代码内部相对路径逻辑未变。
- 2026-07 已重写 Git 历史（清除服务器地址等敏感信息）：**其他机器上的克隆必须删除后重新克隆**，不可 `git pull`。
