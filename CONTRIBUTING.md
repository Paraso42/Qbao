# 贡献指南

感谢关注 Qbao！当前由小团队维护，欢迎提交 Issue 与 Pull Request。

## 提交规范

- 分支：main 直接提交小改动；较大功能用 feature 分支 + PR。
- 提交信息：类型: 描述，发布提交带版本号，如 v3.25: 新增 XX 功能。
- 描述优先用中文，简短说明「做了什么 + 为什么」。

## 开发环境

见 docs/DEVELOPMENT.md。前端无构建流程，改动即生效；后端 npm run dev 自动重启。

## 提交 PR 前

1. 保持改动聚焦，一个 PR 解决一个问题。
2. 涉及数据库变更时，在 server/sql/ 提供幂等迁移脚本。
3. 涉及部署行为时，同步更新 docs/DEPLOY.md。
4. 功能有变化时更新 CHANGELOG.md。

## 隐私红线

**禁止**提交真实服务器地址、API 密钥、证书、用户数据与 VPN 配置；文档一律使用占位符（见 docs/DEVELOPMENT.md §1）。
