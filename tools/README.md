# tools/ — 维护脚本

本目录用于存放**一次性维护/迁移脚本**。默认被 .gitignore 忽略（tools/*，仅保留本说明）。

- 需要长期使用的工具请放入 server/scripts/ 并随仓库发布。
- 涉及密钥、真实地址或用户数据的一次性脚本留在本目录或 local/，**不要上传**。

当前本地工具：

- local/.filter-tools/rewrite_history.py — 2026-07 历史重写脚本（含敏感字符串，勿提交）
- local/analysis/ — 用户数据分析脚本与报告（本地专用）

例外（入库的长期资产）：

- [e2e/](e2e/README.md) — 桌面端 UI 回归探针（Electron + app/dist），运行产物 out/ 不入库。
