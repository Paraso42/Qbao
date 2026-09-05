-- v3.35：桌面端安装包下载统计（版本 × 文件 × 日 维度聚合）
-- 无用户维度数据，仅计数（HTTP 200 完整下载；分片续传不重复计）
CREATE TABLE IF NOT EXISTS desktop_download_stats (
  version   TEXT NOT NULL,
  file_name TEXT NOT NULL,
  day       DATE NOT NULL,
  cnt       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (version, file_name, day)
);
