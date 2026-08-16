-- 精确验证：只检查 aiConfig 对象里是否还有 providerKeys / apiKey 这两个键。
-- 两行都必须返回 0；如果非 0，说明旧客户端在迁移后又把 Key 同步了上来。

SELECT count(*) AS user_data_ai_key_fields
FROM user_data
WHERE state_json -> 'aiConfig' ? 'providerKeys'
   OR state_json -> 'aiConfig' ? 'apiKey';

SELECT count(*) AS backup_ai_key_fields
FROM backups
WHERE state_json -> 'aiConfig' ? 'providerKeys'
   OR state_json -> 'aiConfig' ? 'apiKey';
