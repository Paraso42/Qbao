'use strict';

// 服务端 AI 任务队列 v1（v3.27）
// - 任务创建后先落库，再由进程内 worker 串行领取执行。
// - 用户 API Key 不落库，仅保存在当前进程内存；服务重启后未执行的旧任务会标记 failed。
// - v1 只处理非流式生成；流式生成仍使用 /api/v1/ai/generate SSE。

const { pool } = require('../db');
const {
  resolveAiTarget,
  normalizeTypeCounts,
} = require('../lib/aiRequest');
const { finalizeAiQuestions } = require('./aiQuestionFinalizer');

const TASK_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

// taskId -> { apiKey, providerName, model }
const taskSecrets = new Map();
const WORKER_INTERVAL_MS = 3000;
let workerTimer = null;
let workerRunning = false;

const DEFAULT_SYSTEM_PROMPT = [
  '你是一个出题助手。请根据提供的资料生成考试题目。',
  '只输出纯 JSON 数组，不要包含代码块标记或解释。',
  '每道题包含：type(single/judge/term/short)、question、options(数组)、answer(数字下标)、tag、strategy(error/review/new)、explanation。',
  '单选题 4 个选项且 answer 为 0-3；判断题 options 为 ["正确","错误"] 且 answer 为 0 或 1；名词解释和简答题不需要 options/answer。',
  '数学公式使用 $...$ 或 $$...$$ 包裹。',
].join('\n');

function formatTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    chapterId: row.chapter_id,
    status: row.status,
    request: row.request_json || {},
    result: row.result_json || null,
    error: row.error || null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

async function createAiTask(userId, { providerName, model, apiKey, body }) {
  const target = resolveAiTarget(providerName, model);
  const request = {
    provider: target.providerConfig.id,
    model: target.model,
    body,
  };

  const result = await pool.query(
    `INSERT INTO ai_tasks (user_id, chapter_id, status, request_json)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING *`,
    [userId, body.chapterId || null, TASK_STATUS.QUEUED, JSON.stringify(request)]
  );

  const task = result.rows[0];
  taskSecrets.set(task.id, { apiKey, providerName: target.providerConfig.id, model: target.model });
  return formatTask(task);
}

async function listAiTasks(userId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const result = await pool.query(
    `SELECT * FROM ai_tasks
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );
  return result.rows.map(formatTask);
}

async function getAiTask(userId, taskId) {
  const result = await pool.query(
    'SELECT * FROM ai_tasks WHERE id = $1 AND user_id = $2',
    [taskId, userId]
  );
  return formatTask(result.rows[0]);
}

async function cancelAiTask(userId, taskId) {
  const result = await pool.query(
    `UPDATE ai_tasks
     SET status = $3, finished_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'queued'
     RETURNING *`,
    [taskId, userId, TASK_STATUS.CANCELED]
  );
  if (result.rows[0]) taskSecrets.delete(taskId);
  return formatTask(result.rows[0]);
}

function parseProviderContent(content) {
  const cleaned = String(content || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

async function runTaskGeneration(task, secret) {
  const request = task.request_json || {};
  const body = request.body || {};
  const target = resolveAiTarget(request.provider, request.model);
  const { counts } = normalizeTypeCounts(body.typeCounts);
  const totalQuestions = counts.single + counts.judge + counts.term + counts.short;
  const textContent = body.textContent || '';
  const systemPrompt = body.prompt || DEFAULT_SYSTEM_PROMPT;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: textContent || '请生成一些通用练习题' },
  ];

  const completion = await target.provider.chatCompletions(secret.apiKey, target.model, messages, {
    temperature: 0.7,
    max_tokens: Math.min(Number(target.modelConfig.maxOutput) || 4096, Math.max(1024, totalQuestions * 300 + 4096)),
  });

  const output = completion.choices[0].message.content;
  const rawQuestions = parseProviderContent(output);
  const finalized = await finalizeAiQuestions({
    selfCheck: body.selfCheck === true,
    provider: target.provider,
    apiKey: secret.apiKey,
    model: target.model,
    modelConfig: target.modelConfig,
    sourceText: textContent,
    rawQuestions,
  });

  return {
    questions: finalized.questions,
    validation: finalized.baseValidation,
    selfCheck: finalized.selfCheck,
    usage: completion.usage || null,
    poolFilesStatus: [],
  };
}

async function finishTask(taskId, result) {
  await pool.query(
    `UPDATE ai_tasks
     SET status = $2, result_json = $3::jsonb, finished_at = NOW()
     WHERE id = $1`,
    [taskId, TASK_STATUS.COMPLETED, JSON.stringify(result || {})]
  );
  taskSecrets.delete(taskId);
}

async function failTask(taskId, error) {
  await pool.query(
    `UPDATE ai_tasks
     SET status = $2, error = $3, finished_at = NOW()
     WHERE id = $1`,
    [taskId, TASK_STATUS.FAILED, String(error || '任务失败').slice(0, 2000)]
  );
  taskSecrets.delete(taskId);
}

async function processNextAiTask() {
  if (workerRunning) return false;
  workerRunning = true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query(
      `SELECT id FROM ai_tasks
       WHERE status = 'queued'
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );
    if (selected.rows.length === 0) {
      await client.query('COMMIT');
      return false;
    }

    const claim = await client.query(
      `UPDATE ai_tasks
       SET status = $2, started_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [selected.rows[0].id, TASK_STATUS.RUNNING]
    );
    await client.query('COMMIT');

    const task = claim.rows[0];
    if (!task) return false;

    const secret = taskSecrets.get(task.id);
    if (!secret) {
      await failTask(task.id, '服务重启后 API Key 不再可用，请重新创建任务');
      return true;
    }

    try {
      const result = await runTaskGeneration(task, secret);
      await finishTask(task.id, result);
    } catch (e) {
      console.error('[ai-task] generation failed:', e.message);
      await failTask(task.id, e.message);
    }
    return true;
  } catch (e) {
    console.error('[ai-task] worker error:', e.message);
    try { await client.query('ROLLBACK'); } catch (_) {}
    return false;
  } finally {
    client.release();
    workerRunning = false;
  }
}

function startAiTaskWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    processNextAiTask().catch((e) => {
      console.error('[ai-task] worker loop error:', e.message);
    });
  }, WORKER_INTERVAL_MS);
  // 不阻止进程退出；HTTP server 本身会维持事件循环。
  if (typeof workerTimer.unref === 'function') workerTimer.unref();
}

function stopAiTaskWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

module.exports = {
  TASK_STATUS,
  createAiTask,
  listAiTasks,
  getAiTask,
  cancelAiTask,
  processNextAiTask,
  startAiTaskWorker,
  stopAiTaskWorker,
};
