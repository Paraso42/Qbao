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
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
    }
    location / {
        try_files $uri $uri/ /index.html;
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
5. 前端静态文件为覆盖式发布，必要时刷新浏览器缓存。

## 9. 安全清单

- 修改数据库默认口令；`.env` 权限 600，JWT_SECRET 使用强随机值。
- 防火墙仅开放 80/443；后端 3000 端口不对外。
- AI API Key 由用户在前端自行配置，服务端不留存（`x-ai-api-key` 请求头透传）。
- 定期 `npm audit` 检查依赖漏洞。
