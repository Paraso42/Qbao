# tools/e2e — 桌面端 UI 回归探针（Electron）

> 来源：原 `.tmp/` 一次性 QA 资产（2026-08 v3.27/v3.28 视觉回归与交互探针），
> P0.3（v3.30.2）收编入库，避免回归能力依赖本地单点目录。

## 用途

以 Electron 无头加载 `app/dist/index.html`（singlefile 构建产物），播种演示数据后
执行交互/布局断言或截图，用于**真实场景回归**（构建产物级冒烟，非单测）。

- `qa-check.cjs` — DOM 布局回归检查：滚动溢出/顶栏/侧栏/字体等，输出 JSON 报告
- `qa-shot.cjs` / `qa-shot2.cjs` / `qa-shot3.cjs` — 桌面/手机 × 亮/暗主题截图冒烟
- `probe.cjs` / `probe-*.cjs` — 针对性交互探针（历史、悬停、设置、AI、答题等）
- `probe-v3.28.cjs` — v3.28 答题链路全场景回归（36 题播种 → 答题 → 报告）
- `probe-p1-persistence.cjs` — v3.31 P1.1 分层持久化回归：2100 题播种 → 刷新/活动会话续答 →
  答题后骨架体积（<5MB）→ IDB 大字段分流 → 多账号隔离切换 → 登录态离线作答（pending + IDB 落盘）
- `samples/` — 历史运行结果样例（qa 报告格式参考）；`out/` 为最新运行输出（已 gitignore）

## 运行方式

```bash
# 先构建前端产物
cd app && npm run build

# 从 desktop 目录以 electron 运行（探针为主进程脚本）
cd desktop && npx electron ../tools/e2e/probe-v3.28.cjs
cd desktop && npx electron ../tools/e2e/qa-check.cjs
```

输出（报告 JSON / 截图）统一落在 `tools/e2e/out/`（已 gitignore，不入库）。

## 纪律

- 探针只加载本地 `app/dist` 与本地播种数据；**禁止**写入真实服务器地址、密钥或用户数据
  （历史资产入库前已做敏感串扫描，新增脚本同理）。
- 含真实密钥/账号的端到端场景（如 `local/e2e-ai-scenarios/`）**永不入库**，仅留本地运行。
- 修改探针后先在本地跑通再提交；提交不含 `out/` 产物。
