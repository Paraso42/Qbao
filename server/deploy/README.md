# 服务器进程守护

当前服务器后端为裸 `nohup node server.js`，重启服务器后不会自动拉起。
推荐切换为 systemd。

## 安装步骤（服务器 root 下执行）

1. 上传 service 文件：

   ```bash
   scp -i ~/.ssh/ai_qbao_key01.pem \
     D:/Qbao/server/deploy/qbao-api.service \
     root@114.55.210.82:/etc/systemd/system/qbao-api.service
   ```

2. 停止当前 nohup 进程并启用 systemd：

   ```bash
   pkill -f 'node server.js' || true
   systemctl daemon-reload
   systemctl enable --now qbao-api
   systemctl status qbao-api
   curl -s http://127.0.0.1:3000/health
   ```

## 常用命令

```bash
systemctl restart qbao-api
systemctl stop qbao-api
journalctl -u qbao-api -f
```

## 注意

- `WorkingDirectory` 与 `server/.env` 路径必须保持 `/home/qbao/qbao/server`。
- 该服务不读取 `EnvironmentFile`，由 `server.js` 内的 `dotenv` 加载 `.env`。
- 升级后端时：
  1. `scp` 上传新文件
  2. `systemctl restart qbao-api`
  3. `curl -s http://127.0.0.1:3000/health`
