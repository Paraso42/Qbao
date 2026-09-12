# 贡献指南

感谢关注 Qbao！项目由小团队维护：欢迎提交 Issue、PR 与改进建议。

## 工作方式

- 小改动可直接提交 main；较大功能建议先开 Issue 对齐方案，再用 feature 分支 + PR。
- 提交信息格式：`类型: 描述`（类型：feat / fix / docs / refactor / chore）；发布提交带版本号，如 `v3.38.0: ...`。
- 描述以中文为主，简短说明「做了什么 + 为什么」。

## 开发环境

- **server**：Node.js ≥ 18 + PostgreSQL；`cd server && npm ci --include=dev && npm run dev`（node --watch，默认 3000）
- **app**：Vue 3 + Vite；`cd app && npm ci && npm run dev`（HMR）；构建 `npm run build`（singlefile 产物 dist/）
- **desktop**：`cd desktop && npm ci && npm run dev`（Electron）
- **测试**：app / server 均为 Vitest（`npm test`）；静态检查：`npm run lint`（eslint 0 error）

## 开发上线流程

**网页先行、验收后门**：修改 → 本地 DoD 全绿 → 本地提交（不 push）→ 部署测试 → **用户明确验收通过后才 push + tag + Release**。完整阶段与检核清单见 docs/DEVELOPMENT_FLOW.md。

## 提交 PR 前自检清单

- [ ] 改动聚焦单一问题；涉及数据库时提供幂等迁移（server/sql/NNN_*.sql）
- [ ] app / server 两端测试全绿、eslint 无 error（新增逻辑附测试）
- [ ] 涉及部署行为时同步更新 docs/DEPLOY.md；涉及发布流程时更新 docs/PUBLISHING.md
- [ ] 功能变化已更新 CHANGELOG.md；版本号变更时三端（app / server / desktop）同步
- [ ] 未包含任何真实服务器地址、密钥或用户数据（见下方隐私红线）

## 贡献许可条款

本项目采用 **[PolyForm Noncommercial License 1.0.0](LICENSE)**（非商业许可，详见 [docs/LICENSING.md](docs/LICENSING.md)）。

**提交贡献（Issue / PR / 补丁 / 代码片段 / 文档）即表示你同意：**

1. 你确认自己有权提交该贡献，且其中不包含任何你无权许可的第三方代码、素材或专利内容；
2. 你授予项目维护者一项**永久、全球范围、非独占、免版税、不可撤销**的许可，允许其复制、修改、衍生、分发你的贡献；
3. 你同意维护者可将你的贡献**按本项目当前许可证发布，或在未来变更、重新许可（包括商业许可）时一并纳入**，
   无需另行征得你同意，亦无需向你支付任何费用；
4. 你保留自己贡献的著作权，本条款不改变你对贡献的所有权归属。

> 不接收「仅限非商业使用」「仅限本项目使用」等与本项目许可冲突的贡献。若你的贡献包含第三方代码，
> 请一并说明其来源与许可证，并确保与本项目兼容（见 [docs/LICENSING.md](docs/LICENSING.md) §4）。

## 隐私红线

**禁止**提交真实服务器地址、API 密钥、证书、用户数据与 VPN 配置；文档一律使用占位符（见 docs/DEVELOPMENT.md §1）。历史中曾出现敏感信息泄漏并被重写清理——请不再犯。