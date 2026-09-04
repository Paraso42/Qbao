'use strict';

// 服务端 AI 任务队列 v1（v3.27）
// - 任务创建后先落库，再由进程内 worker 串行领取执行。
// - 用户 API Key 不落库，仅保存在当前进程内存；服务重启后未执行的旧任务会标记 failed。
// - v1 只处理非流式生成；流式生成仍使用 /api/v1/ai/generate SSE。
// v3.28 变更：
// - 创建任务前校验章节未完成规则（与 /ai/generate 一致，409）。
// - running 任务支持取消：DELETE 标记 canceled 并中止上游请求。
// - JSON 解析失败/0 题时附带纠正提示词重试（≤2 次）。
// - 进程启动时将遗留 queued/running 任务标记 failed。

const { pool } = require('../db');
const {
  resolveAiTarget,
  normalizeTypeCounts,
} = require('../lib/aiRequest');
const { ApiError } = require('../lib/errorHandler');
const { finalizeAiQuestions } = require('./aiQuestionFinalizer');
const { assertChapterCanGenerate } = require('./chapterSessionGuard');
const pointsService = require('./pointsService');
const P = require('../config/points');
const { loadPoolTextForChapter } = require('../lib/poolText');
const { buildChapterHistoryPrompt } = require('../lib/chapterHistoryPrompt');

const TASK_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

// taskId -> { apiKey, providerName, model }
const taskSecrets = new Map();
// taskId -> AbortController（running 任务取消用，进程内有效）
const runningAborters = new Map();
const WORKER_INTERVAL_MS = 3000;
const JSON_RETRY_MAX = 2;
let workerTimer = null;
let workerRunning = false;

const DEFAULT_SYSTEM_PROMPT = [
  '你是一个出题助手。请根据提供的资料生成考试题目。',
  '只输出纯 JSON 数组，不要包含代码块标记或解释。',
  '每道题包含：id、type(single/judge/term/short)、question、options(数组)、answer(数字下标)、tag、strategy(error/review/new)、explanation。',
  '单选题 4 个选项且 answer 为 0-3；判断题 options 为 ["正确","错误"] 且 answer 为 0 或 1；名词解释和简答题不需要 options/answer。',
  '不得输出与资料示例或此前已出题目雷同的题，同知识点请变换问法、场景或数值。',
  '输出顺序：单选题 → 判断题 → 名词解释 → 简答题。',
  '数学公式使用 $...$ 或 $...$ 包裹。',
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
  // 章节未完成规则校验（与 /ai/generate 一致）：未做完题目不允许继续出题
  await assertChapterCanGenerate(userId, body.chapterId || null);

  // 同一章节已有进行中（queued/running）任务 → 409（round5.1：多端/多窗口并发点击时
  // 客户端执行归属是第一道防线，这里做服务端兜底，防止两个端都为同一次出题建任务）
  const activeSameChapter = await pool.query(
    "SELECT id FROM ai_tasks WHERE user_id = $1 AND chapter_id = $2 AND status IN ('queued', 'running') LIMIT 1",
    [userId, body.chapterId || null]
  );
  if (activeSameChapter.rows.length > 0) {
    throw new ApiError(409, '该章节已有任务在生成中，请等待完成后再试');
  }

  // 队列公平：每用户同时 queued+running 任务数上限（防一人占满串行 worker）
  const queueCount = await pool.query(
    "SELECT COUNT(*)::int AS c FROM ai_tasks WHERE user_id = $1 AND status IN ('queued', 'running')",
    [userId]
  );
  if ((queueCount.rows[0] && queueCount.rows[0].c) >= P.AI_TASK_USER_LIMIT) {
    throw new ApiError(429, 'AI 出题排队任务已达上限（' + P.AI_TASK_USER_LIMIT + '），请等待完成或取消旧任务');
  }

  // T6：任务创建不再预扣积分——改为 worker 成功完成时才计费（checkAndChargeAiQuota），
  // 失败/取消/重启中断不扣费；每日免费次数仍按 ai_tasks 创建记录计数（防滥用）。
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
  // 排队中 → 直接取消
  const queued = await pool.query(
    `UPDATE ai_tasks
     SET status = $3, error = $4, finished_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'queued'
     RETURNING *`,
    [taskId, userId, TASK_STATUS.CANCELED, '用户取消']
  );
  if (queued.rows[0]) {
    taskSecrets.delete(taskId);
    return formatTask(queued.rows[0]);
  }

  // 运行中 → 标记取消 + 中止上游请求（进程内 abort，worker 发现后丢弃结果）
  const running = await pool.query(
    `UPDATE ai_tasks
     SET status = $3, error = $4, finished_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'running'
     RETURNING *`,
    [taskId, userId, TASK_STATUS.CANCELED, '用户取消']
  );
  if (running.rows[0]) {
    const aborter = runningAborters.get(taskId);
    if (aborter) {
      aborter.abort();
      runningAborters.delete(taskId);
    }
    taskSecrets.delete(taskId);
    console.log('[ai-task] cancel running task id=' + taskId + ' userId=' + userId);
    return formatTask(running.rows[0]);
  }

  // 已结束（completed/failed/canceled）→ 409；不存在 → 404
  const ended = await pool.query(
    'SELECT id FROM ai_tasks WHERE id = $1 AND user_id = $2',
    [taskId, userId]
  );
  if (ended.rows.length === 0) throw new ApiError(404, '任务不存在');
  throw new ApiError(409, '任务已结束，无法取消');
}

function parseProviderContent(content) {
  const cleaned = String(content || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

async function runTaskGeneration(task, secret, signal) {
  const request = task.request_json || {};
  const body = request.body || {};
  const target = resolveAiTarget(request.provider, request.model);
  const { counts } = normalizeTypeCounts(body.typeCounts);
  const totalQuestions = counts.single + counts.judge + counts.term + counts.short;
  // 修复：后台任务与 /ai/generate 一致，自动并入章节分配的文件池资料。
  // （此前仅用客户端 textContent；客户端 prepareUploadData 会排除 _poolFile 资料，
  //   导致"文件池分配的资料 + 服务端任务队列"出题时资料为空，生成与材料无关的题目）
  const poolText = await loadPoolTextForChapter(task.user_id, body.chapterId, body.textContent || '');
  const textContent = poolText.text;
  const poolFilesStatus = poolText.poolFilesStatus;
  const systemPrompt = body.prompt || DEFAULT_SYSTEM_PROMPT;
  console.log('[ai-task] task id=' + task.id + ' chapterId=' + (body.chapterId || 'none') +
    ' textContentLen=' + textContent.length + ' poolFiles=' + poolFilesStatus.length);

  const historyPrompt = buildChapterHistoryPrompt(body.chapterHistory);
  const userContent = (textContent || '请生成一些通用练习题') + historyPrompt;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const baseOpts = {
    temperature: 0.7,
    max_tokens: Math.min(Number(target.modelConfig.maxOutput) || 4096, Math.max(1024, totalQuestions * 300 + 4096)),
    signal,
  };

  const completion = await target.provider.chatCompletions(secret.apiKey, target.model, messages, baseOpts);

  const output = completion.choices[0].message.content;
  let rawQuestions = null;
  try {
    rawQuestions = parseProviderContent(output);
  } catch (e) {
    rawQuestions = null;
  }

  // 纠正性重试：JSON 解析失败或 0 题时，携带上次输出重试（≤2 次）
  if (!rawQuestions || rawQuestions.length === 0) {
    rawQuestions = await retryProviderContent({
      target, secret, systemPrompt, textContent, body, signal, lastRaw: output, historyPrompt,
    });
  }

  const finalized = await finalizeAiQuestions({
    selfCheck: body.selfCheck === true,
    provider: target.provider,
    apiKey: secret.apiKey,
    model: target.model,
    modelConfig: target.modelConfig,
    sourceText: textContent,
    rawQuestions,
    typeCounts: body.typeCounts,
  });

  return {
    questions: finalized.questions,
    validation: finalized.baseValidation,
    selfCheck: finalized.selfCheck,
    usage: completion.usage || null,
    poolFilesStatus,
  };
}

// 纠正性重试：把上次的无效输出（或错误信息）附到用户消息里，要求模型重新输出纯 JSON 数组。
async function retryProviderContent({ target, secret, systemPrompt, textContent, body, signal, lastRaw, historyPrompt }) {
  for (let attempt = 1; attempt <= JSON_RETRY_MAX; attempt++) {
    if (signal && signal.aborted) throw new Error('任务已取消');
    const correction =
      '\n\n重要：你上次返回了无效JSON，错误是：' + String(lastRaw || '').slice(0, 500) +
      '。请修正后重新输出纯JSON数组，不要包含任何其他文字、代码块标记或解释。';
    const retryMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: (textContent || '请生成一些通用练习题') + historyPrompt + correction },
    ];
    try {
      const comp = await target.provider.chatCompletions(secret.apiKey, target.model, retryMessages, {
        temperature: 0.7,
        max_tokens: baseMaxTokens(target, body),
        signal,
      });
      const out = comp.choices[0].message.content;
      let parsed = null;
      try {
        parsed = parseProviderContent(out);
      } catch (e) {
        parsed = null;
      }
      if (parsed && parsed.length > 0) {
        console.log('[ai-task] json retry ok (attempt=' + attempt + '), questions=' + parsed.length);
        return parsed;
      }
      lastRaw = out;
    } catch (e) {
      if (signal && signal.aborted) throw new Error('任务已取消');
      console.warn('[ai-task] json retry failed (attempt=' + attempt + '): ' + e.message);
      lastRaw = e.message;
    }
  }
  return null;
}

function baseMaxTokens(target, body) {
  const { counts } = normalizeTypeCounts(body && body.typeCounts);
  const totalQuestions = counts.single + counts.judge + counts.term + counts.short;
  return Math.min(Number(target.modelConfig.maxOutput) || 4096, Math.max(1024, totalQuestions * 300 + 4096));
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

    // 注册运行中任务的 AbortController（先于任何后续 await，保证取消请求能立即中止上游）
    const controller = new AbortController();
    runningAborters.set(task.id, controller);

    const secret = taskSecrets.get(task.id);
    if (!secret) {
      runningAborters.delete(task.id);
      await failTask(task.id, '服务重启后 API Key 不再可用，请重新创建任务');
      return true;
    }

    try {
      const result = await runTaskGeneration(task, secret, controller.signal);
      // 竞态防护：生成期间可能已被取消（canceled），此时丢弃结果，不覆盖取消状态
      const statusCheck = await pool.query('SELECT status FROM ai_tasks WHERE id = $1', [task.id]);
      if (statusCheck.rows[0] && statusCheck.rows[0].status === TASK_STATUS.CANCELED) {
        console.log('[ai-task] task id=' + task.id + ' canceled during generation, result discarded');
        taskSecrets.delete(task.id);
        return true;
      }
      // T6：成功计费（与 /ai/generate 一致：成功才扣，失败/取消不扣；DB 瞬时错误仅日志）
      try {
        await pointsService.checkAndChargeAiQuota(pool, task.user_id, 'generate');
      } catch (e) {
        console.warn('[points] ai task charge on success failed:', e.message);
      }
      await finishTask(task.id, result);
    } catch (e) {
      console.error('[ai-task] generation failed:', e.message);
      const statusCheck = await pool.query('SELECT status FROM ai_tasks WHERE id = $1', [task.id]);
      const st = statusCheck.rows[0] && statusCheck.rows[0].status;
      if (st === TASK_STATUS.CANCELED) {
        // 取消引发的中止（AbortError → '已取消'）不算失败，保持 canceled 状态
        console.log('[ai-task] task id=' + task.id + ' canceled, abort ignored');
        taskSecrets.delete(task.id);
        return true;
      }
      await failTask(task.id, e.message);
    } finally {
      runningAborters.delete(task.id);
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

// 进程启动清理：把上次进程遗留的 queued/running 任务标记为 failed
// （内存中的 API Key 已丢失，且 running 任务无法继续执行）。
async function markStaleTasksFailed() {
  try {
    const result = await pool.query(
      `UPDATE ai_tasks
       SET status = 'failed', error = '服务重启，任务中断，请重新创建', finished_at = NOW()
       WHERE status IN ('queued', 'running')`
    );
    if (result.rowCount > 0) {
      console.log('[ai-task] startup cleanup: ' + result.rowCount + ' stale task(s) marked failed');
    }
  } catch (e) {
    console.error('[ai-task] startup cleanup failed:', e.message);
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
  markStaleTasksFailed,
  processNextAiTask,
  startAiTaskWorker,
  stopAiTaskWorker,
};