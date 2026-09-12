# 部署手册（生产 · 单机直出）

> 占位符：{DOMAIN}/{HK_IP}/{PROD_ROOT} 的真实值仅存本地 local/ENV.md，公开仓库不展示；执行前先替换。

实机记录：2026-09-07 首次部署；2026-09-10 随全量迁港改为**香港单机直出**
（Caddy 就地终结 TLS + 静态直出 + 反代 :3011）。原有的「Cloudflare 边缘 → 香港 Caddy 中继 → 大陆源站」
两层链路与 nginx 配置已随大陆源站退役一并废弃（原 nginx 片段文件已删除）。

## 步骤

1. 前端 `vite build`（base=/games/werewolf/，CLIENT_BASE_URL=同源）→ tar -C dist .
2. 后端 `tsc -p werewolf-backend`（rootDir 推断为仓库根，保持 dist/werewolf-backend 与 dist/werewolf-frontend 结构）→ tar -C werewolf-backend/dist .
3. 运行时闭包：从安装环境提取 koa 栈传递依赖（纯 JS）→ 与后端 dist 一起解到 {PROD_ROOT}/party/werewolf/。
4. systemd 单元 `qbao-werewolf.service`（本目录文件）→ `/etc/systemd/system/`，daemon-reload 后 enable --now。
5. 前端产物解到 {PROD_ROOT}/app/games/werewolf/（Caddy 静态直出）。
6. Caddy：`/etc/caddy/Caddyfile` 的两个 site 块内各含两条狼人杀路由——
   `route /games/werewolf/api/*`（`uri strip_prefix` 剥前缀后转 3011）与
   `@ws path /games/werewolf/werewolf-ws`（**不剥前缀**，WebSocket 透传）。
   改后 `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`。

## 历史坑（勿重蹈）

- tar 打包必须用 `-C <dir> .`（成员以 ./ 开头），远端直接解包；裸路径 + --strip-components 会毁目录结构。
- **API 与 WS 的前缀处理相反**：API 必须剥掉 `/games/werewolf/api`（否则路径多一段，koa 返回空 200），
  WS 必须**保留**完整路径（socket.io 按完整前缀挂载）。Caddy 里即 `uri strip_prefix` 只写在 API 那条 route 内。
  （nginx 时代此坑表现为尾斜杠：`^~ /games/werewolf/api/` 漏尾斜杠会多一个 `/`。）
- eol：远端执行本地脚本前先 `tr -d '\r'`。
- 构建期注意：@types/node 用 18/20（新版 FFI 类型需新 TS）；koa-body 最新 v6 依赖 zod（TS5.5 语法），钉 @koa/cors@3 等上游大版本。
