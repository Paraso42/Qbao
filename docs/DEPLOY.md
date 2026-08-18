# 部署指南

> 面向运维与自托管用户。**本文所有地址一律使用占位符**（`your.domain.com`、`/srv/qbao`），请勿将真实服务器信息写入本仓库。

## 1. 拓扑

```
用户 ──HTTPS──> Nginx ──静态文件──> app/（前端）
                  └──/api, /uploads──> server/（Express :3000）──> PostgreSQL
```

## 2. 环境要求

- Node.js ≥ 18，PostgreSQL ≥ 13，nginx（生产），域名 + TLS 证书。

## 3. 后端部署

```bash
# 1) 获取代码（注意：2026-07 历史已重写，需全新克隆）
git clone git@github.com:Paraso42/Qbao.git /srv/qbao

# 2) 初始化数据库
sudo -u postgres psql -c "CREATE DATABASE qbao"
sudo -u postgres psql -d qbao -f /srv/qbao/server/init.sql
# 历史版本迁移（幂等，按顺序执行）
for f in /srv/qbao/server/sql/migration_v*.sql; do sudo -u postgres psql -d qbao -f "$f"; done

# 3) 配置环境变量
cd /srv/qbao/server
cp .env.example .env   # 必填：PGPASSWORD、JWT_SECRET；按需填各 AI Key
chmod 600 .env
openssl rand -hex 32   # 生成 JWT_SECRET

# 4) 安装并启动
npm ci --omit=dev
npm start              # 或 PM2 守护（见下）
```

PM2（参考 `server/ecosystem.config.js`，**按实际路径修改 script**）：

```bash
pm2 start server/ecosystem.config.js
pm2 save && pm2 startup
```

## 4. 前端部署（nginx）

前端是 `app/` 下的纯静态文件。nginx 配置示例：

```nginx
server {
    listen 80;
    server_name your.domain.com;
    root /srv/qbao/app;          # 注意：静态根目录是 app/
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ^~ /uploads/ {
        proxy_pass http://127.0.0.1:3000;
    }
    location ^~ /avatars/ {
        proxy_pass http://127.0.0.1:3000;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 注意：静态资源正则 location 优先级高于普通前缀 location。
    # 上传/头像目录（/uploads/、/avatars/）必须写成 ^~ 前缀，否则会被此规则
    # try_files 拦截（在静态根目录找不到图片 → 404）。
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files $uri =404;
    }
}
```

## 5. 上传目录

后端运行时需要以下目录存在且可写（multer 会自动创建大部分）：

| 目录 | 用途 |
|------|------|
| `<仓库根>/uploads/` | 共享文件池、聊天图片、头像（生产数据，**必须备份**） |
| `<仓库根>/server/uploads/` | AI 出题临时文件 |

> 两处目录不一致是已知技术债，计划统一为 `server/uploads/`（见 docs/ARCHITECTURE.md §5-6）。迁移前请勿改动。

## 6. HTTPS

```bash
sudo certbot --nginx -d your.domain.com
```

## 7. 备份

```bash
# 数据库（每日）
pg_dump -U qbao qbao | gzip > /backup/qbao_$(date +%F).sql.gz
# 上传文件（每日）
rsync -a /srv/qbao/uploads/ /backup/uploads/
```

## 8. 升级流程

1. `git pull`（首次从旧历史切换必须先重新克隆）。
2. 执行 `server/sql/` 中新增的迁移脚本。
3. `cd server && npm ci --omit=dev`（依赖有变化时）。
4. `pm2 restart qbao-api`。
5. 前端为 Vue+Vite 构建产物：`cd app && npm ci && npm run build` 后，用 `app/dist/`（含 index.html + vendor/katex/）覆盖式发布到 nginx 静态目录，必要时刷新浏览器缓存。

## 8.5 服务器恢复（2026-07 归档下线后重建）

服务器曾于 2026-07-06 完整卸载运行环境（Node/PM2/PostgreSQL/Nginx 均 purge，社交类数据表已删除、uploads 已清空）。重新上线流程：

1. 重装基础环境：Node.js ≥ 18、PostgreSQL ≥ 13、Nginx、certbot（如需公网 HTTPS）、**WireGuard**（内网访问模式）。
2. 按 §3-4 完成建库与部署（init.sql + migration_v*.sql 顺序执行）。
3. **恢复数据库**：将本地存档 `local/Version/server_archive_20260706/qbao_full_20260706.sql` 导入（含用户账号与题库数据；聊天等已删除表不可恢复，以空库开始）。
4. 执行新增迁移（如 migration_v3.25.sql 乐观锁 rev 列）。
5. 验证四用户凭原账号密码登录、数据完整。

### 桌面版发布与自动更新

桌面端（desktop/）通过 GitHub Releases 自动更新，不依赖服务器：

1. 更新版本号（desktop/package.json → version，与前端版本一致）。
2. 打 tag 并推送：`git tag v3.25.0 && git push origin v3.25.0`。
3. CI（.github/workflows/release.yml）自动构建 NSIS 安装包并发布到 GitHub Release（含 latest.yml 与 blockmap）。
4. 桌面端启动后自动检测新版本，提示下载并重启安装（electron-updater）。

> 更新源国内下载慢时，用户可在桌面设置里切换镜像源（Phase 6）。安装包默认不含服务器地址，用户首次使用时在 desktop/config.local.json 或应用设置里填写。

### 防火墙端口矩阵（内网 VPN 模式，推荐）

| 端口 | 协议 | 用途 | 开放范围 |
|------|------|------|----------|
| 22 | TCP | SSH 管理 | 仅管理员固定 IP |
| 51820 | UDP | WireGuard 入口 | 公网 |
| 9178 | TCP | nginx HTTP 生产入口 | 仅 VPN 网段（10.0.0.0/24） |
| 8080 | TCP | nginx 测试入口（可选） | 仅 VPN 网段 |
| 3000 | TCP | Node 后端 | **永不对外**（仅 127.0.0.1） |
| 5432 | TCP | PostgreSQL | **永不对外**（仅 localhost） |

> 公网开放模式（无 VPN）时另需 80/443，且强烈建议 HTTPS（certbot 免费签发）；后端与数据库端口规则不变。

## 9. 安全清单

- 修改数据库默认口令；`.env` 权限 600，JWT_SECRET 使用强随机值。
- 防火墙仅开放 80/443；后端 3000 端口不对外。
- AI API Key 由用户在前端自行配置，服务端不留存（`x-ai-api-key` 请求头透传）。
- 定期 `npm audit` 检查依赖漏洞。
