# Qbao — 全能互动做题引擎

在线题库学习平台：AI 智能出题、间隔重复复习、考试模拟、好友协作学习。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Frontend](https://img.shields.io/badge/Frontend-Vanilla%20JS-f7df1e)
![Backend](https://img.shields.io/badge/Backend-Node.js%2FExpress-339933)
![DB](https://img.shields.io/badge/DB-PostgreSQL-4169E1)

## 📚 功能概览

- **科目与章节**：多科目多章节管理、折叠定位、答题历史、章节策略强弱分析
- **AI 智能出题**：上传 PDF/文本/图片自动生成选择题/判断题/名词解释/简答题；支持 DeepSeek / ECNU / Gemini / OpenAI 多 Provider；流式出题实时可见；LaTeX/KaTeX 公式渲染
- **答题引擎**：普通练习、限时考试、间隔重复（SRS）、大考卷薄弱点组卷；键盘快捷键与「我会了」两段式防误触
- **数据回顾**：仪表盘（总题数/掌握率/到期复习/连续天数）、答题历史、单次答题报告
- **账号与同步**：注册登录、头像裁剪、成就系统、云端同步与本地备份还原
- **好友与群聊**：好友申请/群聊/文字图片文件消息、Ctrl+V 粘贴图、题目与题库分享、聊天内直接答题、消息撤回
- **用户反馈**：右下角悬浮反馈入口，工单全流程状态追踪，处理结果用户确认
- **移动端**：响应式适配，弹窗全屏化、侧栏转顶部标签
- **个性化**：暗色模式、AI Provider/流式/严格格式配置、API Key 自管

## 🚀 快速开始

```bash
git clone git@github.com:Paraso42/Qbao.git
cd Qbao/server
npm install
cp .env.example .env   # 配置数据库、JWT_SECRET、AI Key
npm run dev            # 后端默认 3000 端口
```

前端是 app/ 目录下的纯静态文件，任意静态服务器托管即可（完整 nginx 配置与生产部署见 docs/DEPLOY.md）。

## 📖 文档

| 文档 | 内容 |
|------|------|
| docs/ARCHITECTURE.md | 架构、模块清单、**代码级重构方向** |
| docs/DEPLOY.md | 部署：nginx / PM2 / 数据库 / 备份 / 升级 |
| docs/DEVELOPMENT.md | 开发工作流、隐私分离规则、诊断脚本 |
| CHANGELOG.md | 版本发布记录 |
| CONTRIBUTING.md | 贡献指南 |
| SECURITY.md | 安全政策与漏洞上报 |

## 🗂 目录结构

```
Qbao/
├── app/          # 前端 SPA：index.html + css/ + js/（无框架、无构建）
├── server/       # Node.js 后端：Express + PostgreSQL
│   ├── src/      # 路由、鉴权中间件、AI Provider 适配器
│   ├── sql/      # 数据库迁移脚本
│   ├── scripts/  # AI 出题诊断脚本
│   └── init.sql  # 建库脚本
├── docs/         # 架构/部署/开发文档
├── tools/        # 维护脚本（默认不上传）
└── local/        # 【本地专用】密钥/日志/数据快照，永不上传（.gitignore）
```

## 🛠 技术架构

纯前端 Vanilla JS SPA（无框架依赖）+ Node.js/Express 后端 API + PostgreSQL。AI 请求由后端代理到各 Provider，支持流式输出与严格 JSON 校验。

## 📄 许可证

[MIT](LICENSE)
