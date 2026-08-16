-- 验证 v3.27 AI Key 清洗结果。
-- 两条查询都应返回 0。

SELECT count(*) AS user_data_secret_rows
FROM user_data
WHERE state_json::text LIKE '%providerKeys%'
   OR state_json::text LIKE '%apiKey%';

SELECT count(*) AS backup_secret_rows
FROM backups
WHERE state_json::text LIKE '%providerKeys%'
   OR state_json::text LIKE '%apiKey%';
