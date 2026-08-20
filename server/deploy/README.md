# 服务器进程守护

当前服务器后端为裸 `nohup node server.js`，重启服务器后不会自动拉起。
推荐切换为 systemd。

## 安装步骤（服务器上执行；服务以 qbao 用户运行，T22 非 root）

> 前置：已创建部署用户 `qbao`，代码位于 `/home/qbao/qbao`（上传目录初始化见下文）。

1. 上传 service 文件：

   ```bash
   scp -i ~/.ssh/id_ed25519 \
     server/deploy/qbao-api.service \
     qbao@SERVER_IP:/etc/systemd/system/qbao-api.service
   ```

2. 初始化上传目录属主（必须早于服务启动，否则非 root 进程无写权限）：

   ```bash
   sudo bash server/deploy/prepare_dirs.sh /home/qbao/qbao
   ```

3. 停止当前 nohup 进程并启用 systemd：

   ```bash
   pkill -f 'node server.js' || true
   systemctl daemon-reload
   systemctl enable --now qbao-api
   systemctl status qbao-api
   curl -s http://127.0.0.1:3000/health
   ```

## 上传目录（T16）

服务端所有上传统一存放在部署根目录 `uploads/` 下，共 4 个子目录：

| 目录 | 用途 |
| ---- | ---- |
| `uploads/chat` | 聊天附件 |
| `uploads/issues` | 问题反馈图片 |
| `uploads/pool` | 文件池（AI 出题资料） |
| `uploads/avatars` | 用户头像 |

服务启动时若目录缺失会自动创建；但 systemd 以非 root 用户运行时需提前初始化并修正属主：

```bash
sudo bash server/deploy/prepare_dirs.sh /home/qbao/qbao
```

## 常用命令

```bash
systemctl restart qbao-api
systemctl stop qbao-api
journalctl -u qbao-api -f
```

## 注意

- `WorkingDirectory` 与 `server/.env` 路径必须保持 `/home/qbao/qbao/server`。
- 服务以 `qbao` 用户运行（非 root）：`uploads/` 目录属主必须是 `qbao`（prepare_dirs.sh 负责），
  否则上传/头像写入会失败；升级部署前同样先执行 prepare_dirs.sh。
- 该服务不读取 `EnvironmentFile`，由 `server.js` 内的 `dotenv` 加载 `.env`。
- 升级后端时：
  1. `scp` 上传新文件
  2. `systemctl restart qbao-api`
  3. `curl -s http://127.0.0.1:3000/health`