'use strict';

// v3.27 存量数据清洗：移除 user_data.state_json 与 backups.state_json 中的 AI API Key。
// 背景：旧版前端曾把 state.aiConfig.apiKey / providerKeys 同步到服务端。
// 用法：
//   node scripts/scrub_ai_keys.js --dry-run   # 只统计，不修改
//   node scripts/scrub_ai_keys.js             # 实际清洗
// 该脚本幂等，可重复执行。

require('dotenv').config({ path: __dirname + '/../.env' });

const { pool } = require('../src/db');
const {
  sanitizeStateJson,
  hasSensitiveAiConfig,
} = require('../src/lib/aiStateSanitizer');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  let client;
    try {
      client = await pool.connect();
    } catch (e) {
      console.error('[scrub-ai-keys] 无法连接 PostgreSQL：' + e.message);
      console.error('[scrub-ai-keys] 请确认 PostgreSQL 已启动，并检查 server/.env 中 PGHOST/PGPORT/PGUSER/PGPASSWORD 是否指向目标数据库。');
      try { await pool.end(); } catch (_) {}
      return 2;
    }
  let touched = 0;
  let failed = 0;

  try {
    // 先用 JSONB 包含 aiConfig 过滤，减少扫描量；真正的密钥判断在 JS 侧完成。
    const result = await client.query(
      "SELECT id, state_json FROM user_data WHERE state_json ? 'aiConfig' ORDER BY id"
    );

    console.log(
      `[scrub-ai-keys] mode=${dryRun ? 'dry-run' : 'write'}, candidateRows=${result.rows.length}`
    );

    if (!dryRun) await client.query('BEGIN');

    for (const row of result.rows) {
      try {
        if (!hasSensitiveAiConfig(row.state_json)) continue;

        const cleanState = sanitizeStateJson(row.state_json);
        if (!dryRun) {
          await client.query('UPDATE user_data SET state_json = $2 WHERE id = $1', [
            row.id,
            cleanState,
          ]);
        }
        touched++;
        if (touched <= 20 || touched % 100 === 0) {
          console.log(`[scrub-ai-keys] row id=${row.id} cleaned`);
        }
      } catch (e) {
        failed++;
        console.error(`[scrub-ai-keys] row id=${row.id} failed:`, e.message);
      }
    }

      // backups 表也保存过 state_json，需要一并清洗。
      const backupResult = await client.query(
        "SELECT id, state_json FROM backups WHERE state_json ? 'aiConfig' ORDER BY id"
      );
      console.log(`[scrub-ai-keys] backupCandidateRows=${backupResult.rows.length}`);

      for (const row of backupResult.rows) {
        try {
          if (!hasSensitiveAiConfig(row.state_json)) continue;

          const cleanState = sanitizeStateJson(row.state_json);
          if (!dryRun) {
            await client.query('UPDATE backups SET state_json = $2 WHERE id = $1', [
              row.id,
              cleanState,
            ]);
          }
          touched++;
          if (touched <= 20 || touched % 100 === 0) {
            console.log(`[scrub-ai-keys] backup row id=${row.id} cleaned`);
          }
        } catch (e) {
          failed++;
          console.error(`[scrub-ai-keys] backup row id=${row.id} failed:`, e.message);
        }
      }


    if (!dryRun) {
      if (failed > 0) {
        await client.query('ROLLBACK');
        console.error(`[scrub-ai-keys] aborted: ${failed} rows failed, transaction rolled back`);
      } else {
        await client.query('COMMIT');
      }
    }

    console.log(`[scrub-ai-keys] done touched=${touched} failed=${failed}`);
    return failed === 0 ? 0 : 1;
  } catch (e) {
    if (!dryRun) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    console.error('[scrub-ai-keys] fatal:', e.message);
    return 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code || 0;
  })
  .catch((e) => {
    console.error('[scrub-ai-keys] unexpected:', e);
    process.exitCode = 1;
  });
