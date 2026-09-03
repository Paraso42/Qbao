# 开发上线流程规范

> 版本 v1.0 · 生效 2026-09-03 · 本文档为本开发流程的**唯一事实源**（CHANGELOG 只记产品变更）。
> 配套文档：环境与隐私铁律见 `docs/DEVELOPMENT.md`，部署细节见 `docs/DEPLOY.md`。

## 1. 总则（核心节奏）

```
① 提出要求（用户）
      ↓
② 方案确认（影响面大/有歧义时，先一句话方案再动手）
      ↓
③ 代码修改 + ④ 本地 DoD 全绿
      ↓
⑤ 版本对齐 + CHANGELOG + 本地 commit（不 push）
      ↓
⑥ 部署网页端（app + server，生产）
      ↓
⑦ CDP 冒烟自检
      ↓
⑧ 用户验收（Ctrl+F5 强刷 → 测试）
      ├─ 通过 → ⑨ git push + tag → ⑩ Release 构建 → ⑪ 收尾
      └─ 不通过 → 回 ③/⑤ 继续本地修复，重新 ⑥⑦⑧，绝不推送
```

一句话：**网页先行、验收后门 —— push/tag/Release 的唯一门票是用户明确说「测试通过」。**

## 2. 阶段总表

| 阶段 | 动作 | 产出 | 责任人 |
|------|------|------|--------|
| ① 需求 | 用户提出要求 | 明确的问题/需求条目 | 用户 |
| ② 方案 | 影响面大或有歧义时先给一句话方案，确认后再动手 | 确认过的方案 | 双方 |
| ③ 修改 | 先定位根因（日志/复现证据）→ 修改 → 按需补测试 | 干净的代码 | Agent |
| ④ DoD | 见 §3 清单，全部通过才允许部署 | 通过清单 | Agent |
| ⑤ 版本+提交 | 三端版本对齐、CHANGELOG 条目、`git commit`（本地） | 本地提交（回滚点） | Agent |
| ⑥ 部署网页端 | 本地工作树直接打包部署，不依赖 GitHub | 生产新版 | Agent |
| ⑦ 冒烟 | CDP 回归改动点 + 主流程，0 异常；产物 sha256 校验 | 冒烟报告 | Agent |
| ⑧ 用户验收 | 通知测试清单，等待明确结论 | 验收结论 | 用户 |
| ⑨ 推送 | `git push origin main` + `git tag vX.Y.Z` + push tag | 远端提交与标签 | Agent |
| ⑩ Release | GitHub Actions「Release 桌面版构建」→ 校验发布资产 | 公开发布 | Agent |
| ⑪ 收尾 | `local/log.md` 记录、强刷提醒 | 日志 | Agent |

## 3. 阶段细则

### ③ 修改
- 每次动代码先给根因（以日志/线上 state/复现脚本为证据），说明「修症状」还是「修根因」的取舍。
- 修改小步、局部；同一轮涉及多个无关问题时逐条编号，对应 ⑪ 的日志条目。
- 涉及数据库变更：`server/sql/` 提供幂等迁移脚本，编号递增（当前已到 011/011），并本地验证迁移可重复执行。

### ④ DoD（部署前必须全绿）
- `server`: `npx vitest run` 全绿（基线 154 用例）
- `app`: `npx vitest run` 全绿（基线 118 用例）
- `npx eslint .`（app/server）0 error
- `app`: `npx vite build` 成功；`dist/index.html` 大小**以字节核对**（坑：UTF-16 长度 ≠ 字节数）
- 改动涉及 Vue 模板时：compiler-sfc 扫描全部 vue 文件，确认无悬空模板绑定（改动后新增引用也纳入）

### ⑤ 版本与提交
- 版本号 `vMAJOR.MINOR.PATCH` 三端对齐：app/server/desktop 的 `package.json` + `package-lock.json` 的 `packages[""].version`（旧版 `lock.version` 字段不动，npm ci 容忍）。
- `CHANGELOG.md` 顶部追加条目：修复/功能项 + 测试数量 + 版本号，格式沿用历史条目。
- `git add`（仅本次改动文件）→ `git commit -m "v3.x.x: <中文摘要>"`（**只本地提交，不 push**，为部署提供回滚点）。
- 严禁把服务器地址/凭据/密钥写入任何跟踪文件（见 docs/DEVELOPMENT.md §1 隐私铁律）。

### ⑥ 部署网页端（不依赖 GitHub，从本地工作树）
- 打包：server tgz（排除 `node_modules/`、`.env`、`uploads/`）；app 用 `-C app/dist .` 打根级 tgz（不带 `dist/` 前缀）。
- 传输：走 `local/` 的 pem（ssh/scp），凭据不落盘到跟踪文件。
- 应用：远端 deploy 脚本（保留 `node_modules/` `.env` `.backup*`；`run_migration.js` 应用新迁移；`systemctl restart`；app 先删 `index.html`/`img`/`vendor`/`favicon.svg` 再解包）。
- 校验：systemd active、`/health` OK、迁移数符合预期、`index.html` 字节数与 sha256 与本地一致。
- 桌面端**不在**此阶段部署：桌面版产物由 ⑩ GitHub Actions 构建（验收通过后产出）。

### ⑦ 冒烟（Agent 自检，不等用户）
- CDP（Edge remote-debugging，端口见 local/ 记录）连生产页面，执行登录 + 本次改动点 + 2~3 条主流程（按改动范围选：题库/出题/复习/设置…）。
- 全程 Runtime 异常计数 = 0；关键状态通过 `window.__pinia` 内省确认。
- 冒烟失败 → 回 ③ 或 ⑥，不得进入 ⑧。

### ⑧ 用户验收
- Agent 通知：「已部署 v3.x.x，请 **Ctrl+F5 强刷** 后测试：<待测清单>」。
- 用户明确给出「测试通过」之前，**禁止** ⑨/⑩。同一轮可多次迭代：不通过 → 本地修复 → 重新部署 → 再验收；GitHub 上始终不存在任何未验收内容。

### ⑨ 推送
- 前置：Clash Verge 运行且 127.0.0.1:7897 可达（GitHub 走 SOCKS 代理）。
- `git push origin main` → `git tag v3.x.x` → `git push origin v3.x.x`。
- 大功能可走 feature 分支 + PR，但验收门槛不变：合并进 main 前必须先过 ⑧。

### ⑩ Release
- 等待 GitHub Actions「Release 桌面版构建」success，核对发布资产齐全（三端版本一致，含 release 版本断言）。

### ⑪ 收尾
- `local/log.md` 追加：需求、根因、修复、验证数据、残余风险。
- 提醒用户强刷；涉及桌面端时提示等待更新推送。

## 4. 回滚

| 场景 | 操作 |
|------|------|
| 网页端回滚 | 服务器 `.backup*` 恢复，或重新部署上一验收版本的工作树构建；不影响 git |
| 未推送的本地提交 | `git reset` / `git commit --amend` 清理 |
| 已推送的缺陷版本 | revert 或新版本修复 + 新 tag；旧 tag 不动 |
| 生产事故 | 先 ⑥ 应急部署修复恢复服务，再走 ⑧⑨（红线不变：仍须验收后才推送） |

## 5. 硬性红线

1. **push/tag/Release 只允许在用户明确验收之后**——无例外，包括紧急修复。
2. 生产地址、凭据、密钥、用户数据永不进 git 跟踪文件（一律占位符）。
3. DoD 未全绿不允许部署。
4. 每次部署前服务器保留备份；部署顺序固定：本地提交 → 部署 → 验收 → 推送。

## 6. 例外与备注

- 纯文档/流程类改动（如本文档）无网页可测：本地提交后，随下一个验收通过的版本一并推送，或用户明确指示立即推送。
- 紧急修复可压缩 ②③⑥⑦ 的节奏，但 ⑧→⑨ 的闸门不变。
- **视觉校验（v3.34 增补）**：开发/测试中需要图片类视觉判断（界面截图审阅、视觉回归、图像内容校验）时，统一交给视觉模型 **ecnu-plus** 分析——当前日常默认模型 ecnu-max 无视觉能力，这是工作方式约定，不属于产品功能。
- 本规范修订：更新版本号 + `local/log.md` 记录变更；修订后以此文件为准。
