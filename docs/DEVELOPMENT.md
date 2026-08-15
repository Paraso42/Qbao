# 开发指南

## 1. GitHub 与本地信息分离（隐私铁律）

| 内容 | 位置 | 是否上传 GitHub |
|------|------|----------------|
| 前端代码 | `app/` | ✅ |
| 后端代码 | `server/` | ✅ |
| 公开文档 | `docs/`、根目录 `*.md` | ✅ |
| 密钥/证书 | `local/keys/`、`local/wg-*.conf` | ❌ |
| 用户数据与分析 | `local/my_data/`、`local/analysis/`、`local/console/` | ❌ |
| 开发日志 | `local/log.md` | ❌ |
| 版本快照 | `local/Version/` | ❌ |
| 历史备份 bundle | `local/*.bundle` | ❌ |

**铁律**：真实服务器地址、密钥、用户数据、VPN 配置一律只放 `local/`（已被 `.gitignore` 整体排除）。部署文档只用占位符。

## 2. 目录结构

```
Qbao/
├── app/            # 前端 SPA（index.html + css/ + js/，网页与桌面共用）
├── desktop/        # Electron 桌面壳（main/preload/updater，配置见 desktop/README）
├── server/         # Node.js 后端
│   ├── src/        # routes/ providers/ 中间件
│   ├── sql/        # 数据库迁移
│   ├── scripts/    # 诊断脚本
│   └── init.sql    # 建库脚本
├── docs/           # 架构/部署/开发文档（公开）
├── tools/          # 一次性维护脚本（默认不上传，见 tools/README）
├── local/          # 【本地专用】隐私文件，永不上传
├── CHANGELOG.md    # 公开版本日志
└── README.md
```

## 3. 本地启动

```bash
# 后端
cd server
npm install
cp .env.example .env     # 配置数据库与 JWT_SECRET
npm run dev              # node --watch，改动自动重启

# 前端：任选其一
npx serve app                        # 简单静态服务
# 或完整 nginx 配置见 docs/DEPLOY.md
```

## 4. 版本与发布流程

1. 功能开发完成后提交：`git commit -m "feat: 描述"`；发布提交带版本号：`v3.25: ...`。
2. **本地快照**（惯例）：发布前把工作副本复制到 `local/Version/Qbao_vX.Y.Z_<主题>/` 留存。
3. 更新 `CHANGELOG.md`（公开摘要），开发细节写 `local/log.md`（不公开）。
4. 推送 GitHub；正式版本打 tag（规划中，配合 GitHub Release）。

## 5. 诊断脚本

```bash
# 直接测 ECNU 出题（流式/非流式 + response_format 组合）
node server/scripts/diagnose_ai.js <api_key> [model]
# 端到端测 /api/v1/ai/generate（需本地后端跑在 3001）
node server/scripts/diagnose_api.js <api_key> [model] [jwt_token]
```

## 6. 测试与 CI

- 当前无自动化测试；GitHub Actions 仅做语法检查与依赖安装（`.github/workflows/ci.yml`）。
- 补测试的方向见 docs/ARCHITECTURE.md §5-11。

## 7. 数据库变更

新表/字段变更：在 `server/sql/` 新增 `migration_vX.Y.sql`（幂等写法：`ALTER TABLE ... IF NOT EXISTS` 或先判断），新装环境按文件名顺序执行即可。
