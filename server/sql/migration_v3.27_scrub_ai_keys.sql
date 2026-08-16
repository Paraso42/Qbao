-- v3.27: 清理历史同步进 user_data.state_json 与 backups.state_json 的 AI API Key。
-- 新代码已在写入/读取时脱敏；本脚本用于修复存量数据。
-- 幂等，可重复执行；建议先 pg_dump 备份，再在事务中运行。
-- 等价 Node 版：server/scripts/scrub_ai_keys.js（带 --dry-run）。

UPDATE user_data
SET state_json = state_json
  #- '{aiConfig,apiKey}'
  #- '{aiConfig,providerKeys}'
WHERE state_json ? 'aiConfig'
  AND jsonb_typeof(state_json -> 'aiConfig') = 'object';

UPDATE backups
SET state_json = state_json
  #- '{aiConfig,apiKey}'
  #- '{aiConfig,providerKeys}'
WHERE state_json ? 'aiConfig'
  AND jsonb_typeof(state_json -> 'aiConfig') = 'object';

