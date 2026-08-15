# Qbao 桌面端（Electron）

## 配置服务器地址（隐私：真实地址不入库）

复制 `config.json` 为 `config.local.json`（已被 .gitignore 忽略），填入：

```json
{
  "apiBase": "https://your.domain.com/api/v1",
  "serverLabel": "线上服务器",
  "updateChannel": "stable"
}
```

或设置环境变量 `QBAO_API_BASE`。

**安装版（打包后）**：首次启动会弹出「设置服务器地址」引导框，输入服务器地址（如 `http://114.55.210.82`，自动补全 `/api/v1`）后窗口自动重建并连接。地址保存在用户数据目录 `settings.json`，后续可在应用内修改。**apiBase 留空 = 纯本地/离线模式**（账号与 AI 出题不可用，本地题库与答题可用）。

## 开发

```bash
cd desktop
npm install        # 首次（Electron 二进制较大）
npm run dev        # 开发模式打开窗口
npm run dist       # 打包 Windows NSIS 安装包（输出 release/）
```

## 自动更新

- 更新源为 GitHub Releases（`package.json → build.publish`），公开仓库无需 token。
- 发布流程：CI 构建 → 上传 `Qbao-Setup-x.y.z.exe` + `latest.yml` + `blockmap` → 桌面端启动后自动检测。
- 用户手动「检查更新」入口：应用内（Phase 6 接入 UI）或 `__qbaoDesktop.checkForUpdates()`。
