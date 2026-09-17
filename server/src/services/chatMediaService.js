'use strict';

// ============================================================
// chatMediaService.js — 聊天媒体治理（v3.37.7）
// ============================================================
//
// 一句话：聊天只做「学习资料级别」的传递，不做网盘、不做长期存储、
// 不做无限流量出口。四道闸门都收敛在本文件，路由只负责调用：
//
//   (1) 配额闸门（上传前，在 multer 之前）：按账号统计「每小时次数 /
//       每日字节 / 留存总量」，超限直接 429/413 —— 被拒的请求不会把
//       字节写进磁盘，这是防刷盘最省带宽的一道；
//   (2) 磁盘水位闸门：整机剩余空间低于阈值时拒绝一切上传（配额是「每人」，
//       水位是「整机」，两者互补）；
//   (3) 归属闸门（发送消息时）：附件必须是自己上传且真实存在的文件，
//       不能引用别人的文件名，也不能把外部 URL 当附件发出去；
//   (4) 回收闸门（每小时后台任务）：孤儿（上传了却从没发出去）24 小时删除；
//       已引用媒体 180 天释放字节；撤回消息立即释放磁盘。
//
// 台账表 chat_media_assets 见 sql/020_v3.43_chat_media_guard.sql。
// 常量口径见 config/files.js（唯一来源）。
//
// 单实例部署（docs/DEPLOY.md）：本文件用进程内定时器，不需要分布式锁。
// ============================================================

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { ApiError } = require('../lib/errorHandler');
const limits = require('../config/files');

// 与 chat.routes.v2.js 共用同一目录（路由从这里 import，避免两处各写一遍路径）
const CHAT_UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'chat');

const MEDIA_URL_PREFIX = '/api/v1/chat/files/';

function limitsSnapshot(overrides) {
  return Object.assign({
    maxPerHour: limits.CHAT_UPLOAD_MAX_PER_HOUR,
    dailyBytes: limits.CHAT_USER_DAILY_UPLOAD_BYTES,
    totalBytes: limits.CHAT_USER_TOTAL_BYTES,
    orphanTtlHours: limits.CHAT_ORPHAN_TTL_HOURS,
    retentionDays: limits.CHAT_MEDIA_RETENTION_DAYS,
    minFreeBytes: limits.CHAT_UPLOAD_MIN_FREE_BYTES,
    maxFileBytes: limits.CHAT_MAX_FILE_BYTES,
    maxThumbBytes: limits.CHAT_MAX_THUMB_BYTES,
  }, overrides || {});
}

function formatMB(bytes) {
  return Math.round((Number(bytes) || 0) / (1024 * 1024)) + 'MB';
}

// 从 URL 取出磁盘文件名。签名 ticket 在前端是查询串，这里只认 /chat/files/ 这一段。
// 返回 null 表示「不是聊天附件地址」（外部链接 / 非法串），由调用方决定怎么处理。
function mediaNameOf(url) {
  if (typeof url !== 'string' || !url) return null;
  const clean = url.split('?')[0].split('#')[0];
  const idx = clean.indexOf(MEDIA_URL_PREFIX);
  if (idx === -1) return null;
  const name = clean.slice(idx + MEDIA_URL_PREFIX.length);
  if (!name || name.indexOf('/') !== -1 || name.indexOf('..') !== -1) return null;
  return name;
}

const IMAGE_EXTS = limits.IMAGE_ALLOWED_EXTS;
function kindOfName(name) {
  return IMAGE_EXTS.indexOf(path.extname(String(name || '')).toLowerCase()) !== -1 ? 'image' : 'file';
}

// 主文件 + 它的全部派生图（<主名>.w480.<ext>）。派生图不单独建账，
// 但必须跟着主文件一起删，否则保留期/撤回都会在盘上留下小图垃圾。
function assetFilePaths(storedName) {
  const own = path.extname(storedName);
  const base = own ? storedName.slice(0, storedName.length - own.length) : storedName;
  const out = [path.join(CHAT_UPLOAD_DIR, storedName)];
  let names = [];
  try { names = fs.readdirSync(CHAT_UPLOAD_DIR); } catch (err) { void err; return out; }
  const prefix = base + '.w';
  for (const n of names) {
    if (n.indexOf(prefix) === 0) out.push(path.join(CHAT_UPLOAD_DIR, n));
  }
  return out;
}

function removeAssetFiles(storedName) {
  for (const p of assetFilePaths(storedName)) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (err) { void err; /* 清理失败不该阻断主流程 */ }
  }
}

// —— 纯函数：配额判定（单测直接打这里，不需要数据库）——
function evaluateQuota(usage, L) {
  const u = usage || {};
  if ((u.hourCount || 0) >= L.maxPerHour) {
    return {
      ok: false,
      status: 429,
      error: '上传过于频繁（每小时最多 ' + L.maxPerHour + ' 次），请稍后再试',
    };
  }
  if ((u.dayBytes || 0) >= L.dailyBytes) {
    return {
      ok: false,
      status: 429,
      error: '今日上传流量已用完（每天上限 ' + formatMB(L.dailyBytes) + '），请明天再试',
    };
  }
  if ((u.totalBytes || 0) >= L.totalBytes) {
    return {
      ok: false,
      status: 413,
      error: '聊天文件存储已满（上限 ' + formatMB(L.totalBytes) +
        '）。聊天只用于学习资料传递，超过 ' + L.retentionDays + ' 天的历史附件会自动释放，请删除最近的大文件后重试',
    };
  }
  return { ok: true };
}

// —— 磁盘水位 ——
function freeBytesOf(dir, statfs) {
  const fn = statfs || (typeof fs.statfsSync === 'function' ? fs.statfsSync : null);
  if (!fn) return null; // 运行环境不支持则不做水位判断（不因探测失败而拒绝正常上传）
  try {
    const st = fn(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch (err) {
    void err;
    return null;
  }
}

function assertDiskHeadroom(L, deps) {
  const free = freeBytesOf(CHAT_UPLOAD_DIR, deps && deps.statfs);
  if (free === null) return free;
  if (free < L.minFreeBytes) {
    console.error('[chat-media] 磁盘水位告警：剩余 ' + formatMB(free) + ' < 阈值 ' + formatMB(L.minFreeBytes) + '，已拒绝新上传');
    throw new ApiError(503, '服务器存储空间不足，暂时无法上传，请稍后再试');
  }
  return free;
}

// —— 台账不可用时的降级 ——
// 部署顺序无法保证「先迁移再重启」（scripts/stage.ps1 -Mode server 只换代码）。
// 若台账表还不存在：上传/发消息必须照常工作（退化为 v3.37.6 的行为），
// 只打一次告警，不把整个聊天功能拖死。
let ledgerWarned = false;
function ledgerDegraded(e) {
  if (ledgerWarned) return;
  ledgerWarned = true;
  console.warn('[chat-media] 台账表不可用（可能尚未执行 020 迁移），本次降级运行：' + (e && e.message));
}
function resetLedgerWarning() { ledgerWarned = false; }

// —— 台账写入 ——
async function recordAsset(opts) {
  const o = opts || {};
  try {
    await recordAssetStrict(o);
  } catch (e) {
    ledgerDegraded(e);
  }
}

async function recordAssetStrict(o) {
  await pool.query(
    `INSERT INTO chat_media_assets (user_id, stored_name, kind, file_size)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stored_name) DO UPDATE
       SET user_id = EXCLUDED.user_id, kind = EXCLUDED.kind, file_size = EXCLUDED.file_size`,
    [o.userId, o.storedName, o.kind || kindOfName(o.storedName), o.fileSize || 0]
  );
}

// —— 配额闸门（上传前）——
async function fetchUsage(userId) {
  try {
    return await fetchUsageStrict(userId);
  } catch (e) {
    ledgerDegraded(e);
    return { dayBytes: 0, totalBytes: 0, hourCount: 0 };
  }
}

async function fetchUsageStrict(userId) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(file_size) FILTER (WHERE created_at > NOW() - INTERVAL '1 day' AND purged_at IS NULL), 0) AS day_bytes,
       COALESCE(SUM(file_size) FILTER (WHERE purged_at IS NULL), 0) AS total_bytes,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') AS hour_count
     FROM chat_media_assets WHERE user_id = $1`,
    [userId]
  );
  const row = (result.rows && result.rows[0]) || {};
  return {
    dayBytes: Number(row.day_bytes) || 0,
    totalBytes: Number(row.total_bytes) || 0,
    hourCount: Number(row.hour_count) || 0,
  };
}

async function assertUploadAllowed(userId, overrides) {
  const L = limitsSnapshot(overrides);
  const usage = await fetchUsage(userId);
  const verdict = evaluateQuota(usage, L);
  if (!verdict.ok) throw new ApiError(verdict.status, verdict.error);
  return usage;
}

// 组装成 express 中间件，挂在 requireAuth 之后、multer 之前 ——
// 顺序很重要：multer 一旦跑起来字节就已经落盘了。
// multipart 声明的总长上限＝主文件上限 + 小图上限 + 表单字段余量。
// 有 Content-Length 就能在**读第一个字节之前**拒掉（例如有人拿 5GB 的 body 打过来）——
// 这是最省的拒绝方式：不解析 multipart、不落盘、不出网。
const BODY_SLACK_BYTES = 64 * 1024;
function declaredBodyCap(L) {
  return L.maxFileBytes + L.maxThumbBytes + BODY_SLACK_BYTES;
}

function uploadGate(opts) {
  const deps = opts || {};
  return function (req, res, next) {
    let L;
    try {
      L = limitsSnapshot(deps.limits);
      const declared = Number(req.headers && req.headers['content-length']);
      if (declared && declared > declaredBodyCap(L)) {
        const mb = Math.round(L.maxFileBytes / (1024 * 1024));
        throw new ApiError(413, '请求体积超过上限（单个文件最大 ' + mb + 'MB），请压缩后再发送');
      }
      assertDiskHeadroom(L, deps);
    } catch (e) {
      return next(e);
    }
    assertUploadAllowed(req.userId, deps.limits).then(function () { next(); }, next);
  };
}

// —— 归属闸门（发送消息前）——
// 返回去重后的文件名数组；任何一条不合法就抛错（不创建消息，不留半个附件）。
async function resolveAttachments(userId, urls) {
  const names = [];
  for (const u of urls || []) {
    if (u === null || u === undefined || u === '') continue;
    const n = mediaNameOf(u);
    if (!n) throw new ApiError(422, '附件地址无效，请重新上传后再发送');
    names.push(n);
  }
  const unique = Array.from(new Set(names));
  if (unique.length === 0) return unique;

  const owner = new Map();
  try {
    const found = await pool.query(
      'SELECT stored_name, user_id FROM chat_media_assets WHERE stored_name = ANY($1::text[])',
      [unique]
    );
    for (const r of found.rows || []) owner.set(r.stored_name, r.user_id);
  } catch (e) {
    // 台账不可用时至少保住「文件真实存在」这条线（归属校验降级）
    ledgerDegraded(e);
  }

  for (const n of unique) {
    const tracked = owner.has(n);
    const onDisk = fs.existsSync(path.join(CHAT_UPLOAD_DIR, n));
    if (!tracked && !onDisk) throw new ApiError(422, '附件不存在或已过期，请重新上传后再发送');
    const o = owner.get(n);
    if (tracked && o !== null && o !== undefined && Number(o) !== Number(userId)) {
      throw new ApiError(403, '不能引用他人上传的文件');
    }
  }
  return unique;
}

// 消息落库后回填 message_id（上传早于发送，所以只能两段式）
async function bindAttachments(userId, messageId, names) {
  try {
    await bindAttachmentsStrict(userId, messageId, names);
  } catch (e) {
    ledgerDegraded(e);
  }
}

async function bindAttachmentsStrict(userId, messageId, names) {
  for (const n of names || []) {
    let size = 0;
    try { size = fs.statSync(path.join(CHAT_UPLOAD_DIR, n)).size; } catch (err) { void err; size = 0; }
    await pool.query(
      `INSERT INTO chat_media_assets (user_id, stored_name, kind, file_size, message_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (stored_name) DO UPDATE
         SET message_id = COALESCE(chat_media_assets.message_id, EXCLUDED.message_id)`,
      [userId, n, kindOfName(n), size, messageId]
    );
  }
}

// —— 撤回/删除消息：立即释放磁盘 ——
async function releaseMessageMedia(messageId) {
  let rows = [];
  try {
    const result = await pool.query(
      'SELECT id, stored_name FROM chat_media_assets WHERE message_id = $1',
      [messageId]
    );
    rows = result.rows || [];
  } catch (e) {
    // 退化：撤回仍会清空消息里的附件引用，只是磁盘字节留给回收任务按保留期处理
    ledgerDegraded(e);
    return 0;
  }
  for (const row of rows) removeAssetFiles(row.stored_name);
  if (rows.length > 0) {
    try {
      await pool.query('DELETE FROM chat_media_assets WHERE message_id = $1', [messageId]);
    } catch (e) {
      ledgerDegraded(e);
    }
  }
  return rows.length;
}

// —— 历史文件回填（本迁移上线前磁盘上已有的文件）——
// 不做回填的话，老文件在台账里查不到，清理任务既不会回收它们，
// 也统计不到它们占的空间。回填是幂等的（ON CONFLICT DO NOTHING）。
async function backfillUntracked() {
  let names;
  try {
    names = fs.readdirSync(CHAT_UPLOAD_DIR);
  } catch (err) {
    void err;
    return 0;
  }
  const mains = names.filter(function (n) { return n.charAt(0) !== '.' && !/\.w\d+\./.test(n); });
  if (mains.length === 0) return 0;

  const trackedRows = await pool.query('SELECT stored_name FROM chat_media_assets');
  const tracked = new Set((trackedRows.rows || []).map(function (r) { return r.stored_name; }));
  const missing = mains.filter(function (n) { return !tracked.has(n); });
  if (missing.length === 0) return 0;

  // 文件名 → 引用它的消息（取最早一条）+ 发送者，用来给老文件找回归属
  const refs = await pool.query(
    `SELECT id, user_id, images, file_info FROM chat_messages
     WHERE (images IS NOT NULL AND images <> '[]'::jsonb) OR file_info IS NOT NULL`
  );
  const byName = new Map();
  for (const row of refs.rows || []) {
    const urls = [];
    if (Array.isArray(row.images)) urls.push.apply(urls, row.images);
    if (row.file_info && row.file_info.url) urls.push(row.file_info.url);
    for (const u of urls) {
      const n = mediaNameOf(u);
      if (n && !byName.has(n)) byName.set(n, { messageId: row.id, userId: row.user_id });
    }
  }

  let inserted = 0;
  for (const n of missing) {
    let st;
    try { st = fs.statSync(path.join(CHAT_UPLOAD_DIR, n)); } catch (err) { void err; continue; }
    const ref = byName.get(n);
    await pool.query(
      `INSERT INTO chat_media_assets (user_id, stored_name, kind, file_size, message_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (stored_name) DO NOTHING`,
      [ref ? ref.userId : null, n, kindOfName(n), st.size, ref ? ref.messageId : null, st.mtime]
    );
    inserted++;
  }
  console.log('[chat-media] 回填历史文件台账 ' + inserted + ' 条（未被任何消息引用的将按孤儿清理）');
  return inserted;
}

// —— 回收任务 ——
// 盘上存在、台账里没有、且比保留期还老的文件：只可能是本迁移之前的历史残留，
// 按同一套保留策略删除（打日志，不静默）。
async function sweepUntracked(L) {
  let names;
  try {
    names = fs.readdirSync(CHAT_UPLOAD_DIR);
  } catch (err) {
    void err;
    return 0;
  }
  const trackedRows = await pool.query('SELECT stored_name FROM chat_media_assets');
  const tracked = new Set((trackedRows.rows || []).map(function (r) { return r.stored_name; }));
  const cutoff = Date.now() - L.retentionDays * 24 * 3600 * 1000;
  let removed = 0;
  for (const n of names) {
    if (n.charAt(0) === '.') continue;
    const base = n.replace(/\.w\d+(\.|$)/, '$1');
    if (tracked.has(n) || tracked.has(base)) continue;
    const abs = path.join(CHAT_UPLOAD_DIR, n);
    let st;
    try { st = fs.statSync(abs); } catch (err) { void err; continue; }
    if (st.mtimeMs >= cutoff) continue;
    try { fs.unlinkSync(abs); removed++; } catch (err) { void err; }
  }
  if (removed > 0) console.warn('[chat-media] 清理无台账的历史残留文件 ' + removed + ' 个');
  return removed;
}

async function sweepOnce(opts) {
  const o = opts || {};
  const L = limitsSnapshot(o.overrides);
  const result = { orphans: 0, expired: 0, untracked: 0, freedBytes: 0 };

  // (1) 孤儿：上传了但从未被任何消息引用
  const orphans = await pool.query(
    `SELECT id, stored_name, file_size FROM chat_media_assets
     WHERE message_id IS NULL AND purged_at IS NULL
       AND created_at < NOW() - ($1::int * INTERVAL '1 hour')`,
    [L.orphanTtlHours]
  );
  const orphanRows = orphans.rows || [];
  for (const row of orphanRows) {
    removeAssetFiles(row.stored_name);
    result.freedBytes += Number(row.file_size) || 0;
  }
  if (orphanRows.length > 0) {
    await pool.query('DELETE FROM chat_media_assets WHERE id = ANY($1::bigint[])', [orphanRows.map(function (r) { return r.id; })]);
  }
  result.orphans = orphanRows.length;

  // (2) 保留期：释放字节，保留台账行（purged_at 供审计）
  const expired = await pool.query(
    `SELECT id, stored_name, file_size FROM chat_media_assets
     WHERE purged_at IS NULL AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [L.retentionDays]
  );
  const expiredRows = expired.rows || [];
  for (const row of expiredRows) {
    removeAssetFiles(row.stored_name);
    result.freedBytes += Number(row.file_size) || 0;
  }
  if (expiredRows.length > 0) {
    await pool.query('UPDATE chat_media_assets SET purged_at = NOW() WHERE id = ANY($1::bigint[])', [expiredRows.map(function (r) { return r.id; })]);
  }
  result.expired = expiredRows.length;

  // (3) 历史残留
  result.untracked = await sweepUntracked(L);

  if (result.orphans || result.expired || result.untracked) {
    console.log('[chat-media] 回收完成：孤儿 ' + result.orphans + '，过期 ' + result.expired +
      '，残留 ' + result.untracked + '，释放 ' + formatMB(result.freedBytes));
  }
  return result;
}

const TICK_MS = 60 * 60 * 1000;
let timer = null;

function startChatMediaJob() {
  if (timer) return timer;
  const L = limitsSnapshot();
  const run = function () {
    sweepOnce().catch(function (e) { console.error('[chat-media] 回收任务失败:', e.message); });
  };
  backfillUntracked()
    .then(run)
    .catch(function (e) { console.error('[chat-media] 台账回填失败:', e.message); });
  timer = setInterval(run, TICK_MS);
  // T8: unref — 不阻止进程退出/优雅停机
  if (typeof timer.unref === 'function') timer.unref();
  // 启动即报一次「闸门已武装」：回收任务平时是静默的（只有真回收了才打日志），
  // 没有这行就无法从日志判断它到底有没有跑起来（生产首次上线时踩过这个盲区）。
  console.log('[chat-media] 回收任务已启动：每 ' + (TICK_MS / 60000) + ' 分钟一次；孤儿 ' +
    L.orphanTtlHours + ' 小时、保留 ' + L.retentionDays + ' 天；单文件 ' + formatMB(L.maxFileBytes) +
    '、图片 ' + formatMB(L.maxImageBytes) + '、每人每日 ' + formatMB(L.dailyBytes));
  return timer;
}

function stopChatMediaJob() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  CHAT_UPLOAD_DIR,
  MEDIA_URL_PREFIX,
  mediaNameOf,
  kindOfName,
  assetFilePaths,
  removeAssetFiles,
  limitsSnapshot,
  formatMB,
  evaluateQuota,
  freeBytesOf,
  assertDiskHeadroom,
  declaredBodyCap,
  recordAsset,
  fetchUsage,
  assertUploadAllowed,
  uploadGate,
  resolveAttachments,
  bindAttachments,
  releaseMessageMedia,
  backfillUntracked,
  sweepUntracked,
  sweepOnce,
  startChatMediaJob,
  stopChatMediaJob,
  resetLedgerWarning,
};
