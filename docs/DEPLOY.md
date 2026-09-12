# 部署指南

> 面向运维与自托管用户。**本文所有地址一律使用占位符**：{DOMAIN}/{BETA_HOST} 域名、{HK_IP} 服务器 IP、
> {HOST_ROOT} 部署父目录、{PROD_ROOT}/{BETA_ROOT} 两套部署根、{BACKUP_DIR} 备份目录
> （真实值只在本机 gitignored 的 `local/ENV.md`），请勿将真实服务器信息写入本仓库。
> （{ORIGIN_IP} 随大陆源站退役已废弃，不应再出现。）

## 1. 拓扑（2026-09-10 全量迁港后 · 单机直出）

```text
用户 ──HTTPS──> Cloudflare（{DOMAIN} 走代理）或 DNS 直连（{BETA_HOST} 仅解析）
        │
        ▼
单台服务器 {HK_IP} · Caddy（TLS 终结 / Let's Encrypt 自动证书 / gzip）
        ├─ 静态本地直出 + SPA 兜底
        │    {DOMAIN}    → root {PROD_ROOT}/app    静态 7 天
        │    {BETA_HOST} → root {BETA_ROOT}/app    不缓存
        ├─ /api /uploads /avatars /dl → 127.0.0.1:3000（生产）/ :3100（内测）
        ├─ /games/werewolf/api/*（剥前缀）、/games/werewolf/werewolf-ws（不剥）→ 127.0.0.1:3011
        ├─ /download → 302 → /api/v1/desktop/download
        └─ PostgreSQL 14（127.0.0.1:5432）：库 qbao / qbao_beta（同一集群两本账）
```

> 原「大陆源站 + 香港边缘网关」两层结构已废弃：大陆机房会拦截未单列备案的 Host，
> 迁港后香港主机直接就是源站，**不再需要 nginx、回源 Host 改写、`X-Qbao-Route` 路由头或出口 IP 白名单**。
> 机制原理见 docs/ARCHITECTURE.md §2（含 Caddy 实际路由配置），内测环境概念见 docs/ENVIRONMENTS.md。

## 2. 环境要求

- Node.js ≥ 18（线上实测 v26.x）、PostgreSQL ≥ 13（线上 14）、Caddy 2（自动 HTTPS；自托管可用任意反向代理）。
- 域名 + 可公网校验的 DNS（Caddy 走 ACME HTTP-01 自动签发证书）。

## 3. 后端部署

> 本项目线上实例**不使用 PM2**：以 systemd 单元运行（qbao-api / qbao-api-beta / qbao-werewolf，
> 模板 server/deploy/qbao-api.service，见 §4B 与 docs/ARCHITECTURE.md §3.1）。以下为自托管最小部署写法。

```bash
# 1) 获取代码（注意：历史已重写，需全新克隆）
git clone git@github.com:Paraso42/Qbao.git {PROD_ROOT}

# 2) 初始化数据库
sudo -u postgres psql -c "CREATE DATABASE qbao"
sudo -u postgres psql -d qbao -f {PROD_ROOT}/server/init.sql
# 历史/新增迁移（T17 版本化：schema_migrations 追踪，只执行未应用项）
cd {PROD_ROOT}/server && npm ci --omit=dev && node scripts/run_migration.js

# 3) 配置环境变量
cd {PROD_ROOT}/server
cp .env.example .env   # 必填：PGPASSWORD、JWT_SECRET；按需填各 AI Key
chmod 600 .env
openssl rand -hex 32   # 生成 JWT_SECRET

# 4) 安装并启动
npm ci --omit=dev
npm start              # 生产请改用 systemd 单元（见 §4B.2 第 5 步），不要挂在前台
```

## 4. 前端部署（Caddy 静态直出）

前端为 Vue+Vite 构建产物：`cd app && npm ci && npm run build` 后发布 `app/dist/`
（singlefile：index.html + vendor/，CI 亦会构建并冒烟校验 CSP）。
> 线上实例把构建产物解包发布为独立静态目录 {PROD_ROOT}/app（Caddy `root` 直接指向该目录，见 §1/§4B）；
> 下列示例以仓库内 app/dist 为自托管最小写法。Caddyfile 示例：

```caddyfile
{DOMAIN} {
        encode gzip

        @static { not path /api /api/* /uploads/* /avatars/* /dl /dl/* /download }
        route @static {
                root * {PROD_ROOT}/app/dist   # 线上实例 = {PROD_ROOT}/app（解包目录）
                try_files {path} {path}/ /index.html
                file_server
        }

        @dyn path /api/* /api /uploads/* /avatars/* /dl/* /dl
        route @dyn {
                reverse_proxy 127.0.0.1:3000 {
                        header_up Host {host}
                        header_up X-Real-IP {remote_host}
                }
        }

        @assets path *.js *.css *.png *.jpg *.jpeg *.gif *.ico *.svg *.woff *.woff2
        header @assets Cache-Control "public, max-age=604800"
}
```

> 要点：`@static` 的 `not path` 列表必须与 `@dyn` 的列表**严格互补**——漏掉某个动态前缀，
> 该路径就会被静态兜底吞掉（返回 index.html 而不是 API 响应）。
> 改配置后先 `caddy validate --config /etc/caddy/Caddyfile` 再 `systemctl reload caddy`。

## 4B. 内测环境（beta）部署 —— 双环境纪律

> 内测环境与生产**同服务器、同代码、不同目录/进程/数据库/域名**：静态 {BETA_ROOT}/app、API :3100、
> 库 qbao_beta、域名 {BETA_HOST}。所有测试动作只允许发生在内测环境；生产库禁止测试写入。
> 流程纪律见 docs/DEVELOPMENT_FLOW.md（§3、§7），概念与内测入口见 docs/ENVIRONMENTS.md，
> 链路机制见 docs/ARCHITECTURE.md §2。

### 4B.1 目标布局（占位符，真实值见 local/ENV.md）

| 层 | 入口 | 静态根 | API | 数据库 | 缓存 |
|---|---|---|---|---|---|
| L2 生产 | https://{DOMAIN} | {PROD_ROOT}/app | :3000（qbao-api） | qbao | 静态 7 天 |
| L1 内测 | https://{BETA_HOST} | {BETA_ROOT}/app | :3100（qbao-api-beta） | qbao_beta | 不缓存 |

### 4B.2 一次性初始化

```bash
# 1) 目录与代码（部署侧非 git 检出；日常同步走 scripts/stage.ps1 -Env beta，首次可手工铺底）
mkdir -p {BETA_ROOT}/server {BETA_ROOT}/app {BETA_ROOT}/downloads {BETA_ROOT}/uploads

# 2) 建库（同一 PostgreSQL 集群，独立账本；<db_user> 为实际 PG 属主，见 local/ENV.md）
sudo -u postgres createdb -O <db_user> qbao_beta

# 3) 内测环境变量（.env）
cp -n {PROD_ROOT}/server/.env {BETA_ROOT}/server/.env   # 或从 .env.example 起
#   必改：PORT=3100、PGDATABASE=qbao_beta、JWT_SECRET=新随机值（openssl rand -hex 32）、CORS_ORIGIN=https://{BETA_HOST}
#   AI Key 留空；chmod 600 .env
#   内测网全员管理员：追加 AUTO_ADMIN=1（注册即 admin，仅内测可开；生产严禁）

# 4) Schema 初始化 —— 以生产库 schema-only 克隆（勿用仓库 init.sql：线上生产库与基线已漂移，克隆保证一致）
pg_dump --schema-only -U <db_user> -d qbao | sudo -u postgres psql -d qbao_beta
pg_dump -U <db_user> -d qbao -t schema_migrations --data-only | sudo -u postgres psql -d qbao_beta
#   再执行剩余迁移：cd {BETA_ROOT}/server && node scripts/run_migration.js（读本目录 .env → qbao_beta）

# 5) systemd 单元（以 server/deploy/qbao-api.service 为模板另存 qbao-api-beta.service）
#    WorkingDirectory={BETA_ROOT}/server，ExecStart=node server.js
systemctl daemon-reload && systemctl enable --now qbao-api-beta
curl -s http://127.0.0.1:3100/api/v1/health

# 6) 静态首灌与后续同步：scripts/stage.ps1 -Env beta -Mode app（构建产物 → {BETA_ROOT}/app）
#    Caddy 只需新增/确认 {BETA_HOST} site 块（见 4B.3），不需要改动生产块
```

### 4B.3 Caddy 双环境路由（两个 site 块）

> 环境由**访问哪个域名**唯一决定：`{DOMAIN}` 块指向生产静态根与 :3000，`{BETA_HOST}` 块指向内测静态根与 :3100。
> 两块的 route 结构完全相同，仅 `root`、`reverse_proxy` 端口与 `Cache-Control` 三处不同。
> 完整示例（含狼人杀剥前缀、WebSocket、`/download` 短链）见 docs/ARCHITECTURE.md §2.4。

```caddyfile
{BETA_HOST} {
        encode gzip

        @static { not path /api /api/* /uploads/* /avatars/* /dl /dl/* /download \
                          /games/werewolf/werewolf-ws /games/werewolf/api/* }
        route @static {
                root * {BETA_ROOT}/app
                try_files {path} {path}/ /index.html
                file_server
        }

        @dyn path /api/* /api /uploads/* /avatars/* /dl/* /dl
        route @dyn { reverse_proxy 127.0.0.1:3100 { header_up Host {host} } }

        @assets path *.js *.css *.png *.jpg *.jpeg *.gif *.ico *.svg *.woff *.woff2
        header @assets Cache-Control "no-cache, no-store, must-revalidate"
}
```

> DNS：{BETA_HOST} 在 Cloudflare 建 A 记录指向 {HK_IP} 并设为**仅 DNS（灰云）**，Caddy 才能走标准 ACME 校验；
> {DOMAIN} 走 Cloudflare 代理（橙云）。改动后必须：先备份 `/etc/caddy/Caddyfile`
> （`Caddyfile.bak_<日期>`），再 `caddy validate` + `systemctl reload caddy`。

### 4B.4 部署 / 冒烟 / 清理

```bash
# 部署（同步代码/静态 → 内测目录 → 迁移 → 重启），流程见 docs/DEVELOPMENT_FLOW.md §⑥
scripts/stage.ps1 -Env beta -Mode all          # 或手工 tgz+scp（同 §8 流程，目标改 beta 目录）
systemctl restart qbao-api-beta

# 冒烟：可写 E2E 走内测库（scripts/qa/smoke-stage.ps1 -Env beta）+ 只读健康检查
curl -s https://{BETA_HOST}/api/v1/health

# 内测库清理重建（允许随时执行，不影响生产；重建后需重开 AUTO_ADMIN 测试账号）
sudo -u postgres dropdb qbao_beta
sudo -u postgres createdb -O <db_user> qbao_beta
#   再按 4B.2 第 4 步重新做 schema-only 克隆 + run_migration.js，然后 restart qbao-api-beta + 冒烟
```

### 4B.5 内存预案（单机小内存共用时）

1. 内测实例不开 AI 任务（服务端预留 `SKIP_AI_WORKER=1` 环境变量支持）；AI Key 留空自然不消费额度。
2. 观察 RSS：`systemctl status qbao-api-beta` / `ps -o rss,cmd -p <pid>`。
3. 最坏回退：内测仅保留静态目录（页面/UI 可测），API 暂共享生产 :3000 —— 放弃「先于生产测新代码」能力，恢复即移除。

### 4B.6 纪律要点（与 DEVELOPMENT_FLOW §7 红线一致）

- 迁移与发布顺序固定：**L1 先、L2 后**；两库 schema_migrations 各自记账，任意一边失败可单独重试（迁移幂等）。
- 测试账号只建在 qbao_beta；生产保持金丝雀账号只读巡检。
- 游戏页 `?qa=1` 钩子仅 {BETA_HOST}/localhost 生效（代码门禁，见 docs/GAMES.md §六）。

## 5. 上传目录

**所有上传统一在 `<仓库根>/uploads/`**（T16 已收敛，AI 临时文件与其余通道同根）：

| 目录 | 用途 |
|------|------|
| `uploads/pool/` | 共享文件池（AI 出题资料，生产数据，**必须备份**） |
| `uploads/chat/` | 聊天附件 |
| `uploads/issues/` | 反馈图片 |
| `uploads/avatars/` | 头像 |

非 root 运行（推荐，见 §3.5）时，用 `server/deploy/prepare_dirs.sh` 初始化属主：
```bash
sudo bash server/deploy/prepare_dirs.sh {PROD_ROOT}
```

## 6. HTTPS

线上链路：TLS 由服务器上的 **Caddy 就地终结**并自动续期（Let's Encrypt / ACME HTTP-01，`{DOMAIN}` 与 `{BETA_HOST}` 各一张）；
`{DOMAIN}` 另经 Cloudflare 代理（用户侧先经 CF 边缘证书，CF ↔ 服务器回源使用 Caddy 的正式证书）。
80 端口仅用于 ACME 校验与跳转。改 Caddyfile 后 `caddy validate` + `systemctl reload caddy`。

自托管用户若要换用 nginx/certbot，按常规签发即可：
```bash
sudo certbot --nginx -d your.domain.com
```

## 7. 备份

服务器以 cron 每日 04:00 自动备份双库（保留 30 天）：
```bash
# /etc/cron.d/qbao-backup —— 生产 + 内测两本账一并 dump
pg_dump -U qbao qbao      | gzip > {BACKUP_DIR}/qbao_$(date +\%F).sql.gz
pg_dump -U qbao qbao_beta | gzip > {BACKUP_DIR}/qbao_beta_$(date +\%F).sql.gz
# 上传文件（可另行每日）
rsync -a {PROD_ROOT}/uploads/ {BACKUP_DIR}/uploads/
```

> **恢复没有"回滚到源站"这条路**：大陆源站已于 2026-09-10 退役清理（Qbao 零残留），
> 恢复只能走 HK 的每日 dump，或本机 gitignored 的 `local/backups/`（迁港时点快照 + 源站退役归档）。

## 8. 升级流程

1. `git pull`（首次从旧历史切换必须先重新克隆）。
2. 执行迁移：`cd server && node scripts/run_migration.js`（schema_migrations 自动跳过已应用项；旧库手工迁移过可先 `--mark-applied`）。
3. `cd server && npm ci --omit=dev`（依赖有变化时）。
4. `sudo bash server/deploy/prepare_dirs.sh {PROD_ROOT}`（目录属主修正）后重启服务。
5. 前端为 Vue+Vite 构建产物：`cd app && npm ci && npm run build` 后，用 `app/dist/` 覆盖式发布到 Caddy 静态根（{PROD_ROOT}/app），必要时刷新浏览器缓存。

## 8.5 服务器重建（灾难恢复）

香港主机若需重建（服务与数据库同机，这是唯一线上主机）：

1. 重装基础环境：Node.js ≥ 18、PostgreSQL ≥ 13、**Caddy 2**、swap（小内存主机建议 1G）。
2. 按 §3–4 完成建库与部署（init.sql + `run_migration.js`）。
3. **恢复数据库**：取最近一份 `{BACKUP_DIR}/qbao_*.sql.gz`（或本机 `local/backups/pre-hk-migration/`）导入；内测库同理。
4. 还原上传文件与 `downloads/` 分发储藏室（manifest.json 是发布事实源，务必一并恢复）。
5. 重建 Caddyfile（两个 site 块，见 §4/§4B.3）并 `systemctl enable --now caddy`。
6. 拉起 systemd：`systemctl enable --now qbao-api qbao-api-beta qbao-werewolf`；ufw 规则重放（放行 22/80/443，deny 3000/3100/3011）。
7. 验证：`https://{DOMAIN}/api/v1/health` 与 `https://{BETA_HOST}/api/v1/health` 均返回 ok，且 DB 连接正常。

### 桌面版分发（v3.35 · 自托管更新源 + 统一下载站）

桌面端更新、下载完全由本站服务器提供（**不依赖 GitHub**；GitHub 仅作 CI 与发布归档，服务器永不直连 GitHub）。

1. **储藏室目录结构**（QBAO_DESKTOP_DIR，默认 `<repo>/downloads`，位于 server/ 之外，发布清理脚本不触碰）：

```
downloads/
  manifest.json            # 唯一事实源（scripts/publish-installer.js 生成，服务器只读）
  manifest.json.bak        # 每次发布前的滚动备份（回滚依据）
  stable/latest.yml  Qbao-Setup-<v>.exe  Qbao-Setup-<v>.exe.blockmap
  beta/latest.yml   ...
```

2. **公开端点**（全部无鉴权、支持断点续传 / GET 自动支持 HEAD）：
   - `/api/v1/desktop/manifest?channel=stable|beta` — 版本清单（latest 在前，含 required/retracted/stopped）
   - `/api/v1/desktop/latest` — 最新稳定版元信息（旧版兼容，字段不变）
   - `/api/v1/desktop/download?file=<fileName>` — 任意留存版本精确下载（缺省=最新稳定版；retracted → 410）
   - `/api/v1/desktop/update/<channel>/latest.yml` 与 `<file>` — 桌面端 electron-updater generic feed（exe/blockmap）
   - `/api/v1/desktop/stats` — 下载统计（版本×日聚合，无 PII）
   - `/dl` — 公开下载落地页（中国大陆镜像站点，服务端动态渲染）
   - `/download` — 短链 302 → /api/v1/desktop/download

3. **Caddy 侧**（`/api` 反代已覆盖全部 API 端点，只需短链）：

```caddyfile
route /download { redir * /api/v1/desktop/download 302 }
```

   > 大文件下载（85MB+ 安装包）在 Caddy 的 `reverse_proxy` 下按流式转发，无 nginx 那样的
   > `proxy_read_timeout` 默认 60s 限制；若前面另加了 CDN/代理，注意放宽其读超时。

4. **数据库迁移**：`013_desktop_download_stats.sql`（下载统计表；`run_migration.js` 自动应用）。
5. **发布安装包**：见 `docs/PUBLISHING.md`（scripts/publish-installer.js：add/promote/retract/verify/ls）。

### 防火墙端口矩阵（线上实例现状）

| 端口 | 协议 | 用途 | 开放范围 |
|------|------|------|----------|
| 22 | TCP | SSH 管理 | 公网（密钥登录，密码登录已禁用） |
| 80 | TCP | Caddy：ACME 校验 + HTTPS 跳转 | 公网 |
| 443 | TCP | Caddy：HTTPS 主入口 | 公网 |
| 443 | UDP | Caddy：HTTP/3（QUIC） | 公网 |
| 3000 | TCP | Node 后端（生产） | **永不对外**（ufw 显式 deny，仅 127.0.0.1） |
| 3100 | TCP | Node 后端（内测） | **永不对外**（ufw 显式 deny，仅 127.0.0.1） |
| 3011 | TCP | 狼人杀房间服务 | **永不对外**（ufw 显式 deny，仅 127.0.0.1） |
| 5432 | TCP | PostgreSQL | **永不对外**（仅 localhost） |

> 自托管若走「内网 VPN 模式」，可只对 VPN 网段开放 80/443，后端与数据库端口规则不变。

## 9. 安全清单

- 修改数据库默认口令；`.env` 权限 600，JWT_SECRET 使用强随机值。
- 防火墙仅开放 22/80/443（含 443/udp），并显式 deny 3000/3100/3011；数据库仅 localhost。
- SSH：禁用密码登录，仅密钥；如需更严可把 `PermitRootLogin` 从 `yes` 改为 `prohibit-password`。
- AI API Key 由用户在前端自行配置，服务端不留存（`x-ai-api-key` 请求头透传）。
- 管理员引导：首个注册用户且用户名在 `ADMIN_USERNAMES` 环境变量中时自动成为 admin（server/.env.example 有说明）。
- 双环境权限模型：内测可开 `AUTO_ADMIN=1`（注册即管理员，仅内测）；生产严禁开启。管理员不可被其他管理员封禁/改密/改角色（服务端强制 403，客户端界面同步收敛），角色变更仅后台脚本（见 docs/ARCHITECTURE.md §4.2）。
- 备份互导只含业务数据，不携带账号属性（封禁/角色），见 docs/ARCHITECTURE.md §4.2 与 docs/ENVIRONMENTS.md §5.
- 已知技术债：API 进程以 root 运行，改进方向见 docs/ARCHITECTURE.md §9（降权为专用低权用户）。
- 定期 `npm audit` 检查依赖漏洞；CI 已含 gitleaks 密钥扫描与产物冒烟。