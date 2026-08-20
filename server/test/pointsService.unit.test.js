'use strict';

// pointsService 单元测试：不依赖真实数据库，用可控 fake db 断言 SQL 序列与返回。
// 覆盖：发分/幂等补偿/扣分/调整/答题增量与每日上限/分享封顶/AI 配额/清零日计算。

const { describe, it, expect, beforeEach, afterEach } = globalThis;
const { pool } = require('../src/db');
const P = require('../src/config/points');
const svc = require('../src/services/pointsService');
const { ApiError } = require('../src/lib/errorHandler');

// 记录型 fake db
function makeDb() {
  const calls = [];
  const db = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      // —— award/spend 相关 ——
      if (/UPDATE users SET storage_points = storage_points \+/.test(sql)) return { rows: [{ storage_points: 42 }] };
      if (/UPDATE users SET storage_points = storage_points -/.test(sql)) {
        // 扣分：条件更新（含 >= 与 RETURNING）→ 32；补偿回滚（无 RETURNING）→ 22
        if (sql.indexOf('RETURNING') !== -1) return { rows: [{ storage_points: 32 }] };
        return { rows: [{ storage_points: 22 }] };
      }
      if (/INSERT INTO points_ledger/.test(sql)) {
        if (db._conflict) { const e = new Error('dup'); e.code = '23505'; throw e; }
        return { rows: [{ id: 1 }] };
      }
      if (/SELECT storage_points FROM users/.test(sql)) return { rows: [{ storage_points: 22 }] };
      if (/^SELECT COALESCE\(SUM\(delta\), 0\)::int AS s FROM points_ledger WHERE user_id = \$1 AND reason = \$2/.test(sql)) {
        return { rows: [{ s: db._sumSince || 0 }] };
      }
      if (/SELECT points_awarded_stats FROM answer_sessions/.test(sql)) {
        return { rows: [{ points_awarded_stats: db._snapshot || null }] };
      }
      if (/UPDATE answer_sessions SET points_awarded_stats/.test(sql)) return { rows: [{ id: 1 }] };
      if (/SELECT COUNT\(\*\)::int AS c FROM ai_request_log/.test(sql)) {
        if (/model = 'upload'/.test(sql)) return { rows: [{ c: db._uploads || 0 }] };
        return { rows: [{ c: db._genLogs || 0 }] };
      }
      if (/SELECT COUNT\(\*\)::int AS c FROM ai_tasks/.test(sql)) return { rows: [{ c: db._tasks || 0 }] };
      if (/SELECT COUNT\(\*\)::int AS c FROM points_ledger/.test(sql)) return { rows: [{ c: 1 }] };
      if (/FROM points_ledger\)? WHERE/.test(sql)) return { rows: [{ s: db._sumSince || 0 }] };
      // 分享封顶 SUM（ref_id LIKE）
      if (/ref_id LIKE/.test(sql)) return { rows: [{ s: db._shareEarned || 0 }] };
      if (/SELECT id, delta, balance_after/.test(sql)) return { rows: [{ id: 1, delta: 10, balance_after: 42, reason: 'signup', ref_type: 'signup', ref_id: 'user:1', note: '', created_at: new Date() }] };
      return { rows: [], rowCount: 0 };
    },
  };
  return db;
}

describe('pointsService 基础', () => {
  it('awardPoints 发分 + 写台账', async () => {
    const db = makeDb();
    const r = await svc.awardPoints(db, 1, 20, { reason: 'signup', refType: 'signup', refId: 'user:1' });
    expect(r.awarded).toBe(true);
    expect(r.balance).toBe(42);
    const insert = db.calls.find((c) => /INSERT INTO points_ledger/.test(c.sql));
    expect(insert.params[0]).toBe(1);
    expect(insert.params[1]).toBe(20);
    expect(insert.params[3]).toBe('signup');
  });

  it('awardPoints 唯一约束冲突 → 补偿回滚且 awarded=false', async () => {
    const db = makeDb();
    db._conflict = true;
    const r = await svc.awardPoints(db, 1, 20, { reason: 'daily_login', refType: 'daily_login', refId: '2026-07-01' });
    expect(r.awarded).toBe(false);
    expect(r.balance).toBe(22); // 补偿回滚后返回补偿后余额（fake 语义：补偿 UPDATE 与随后 SELECT 均返回 22）
  });

  it('spendPoints 扣分成功并记台账', async () => {
    const db = makeDb();
    const r = await svc.spendPoints(db, 1, 10, { reason: 'file_extend', note: '续期' });
    expect(r.balance).toBe(32);
    expect(r.spent).toBe(10);
    const insert = db.calls.find((c) => /INSERT INTO points_ledger/.test(c.sql));
    expect(insert.params[1]).toBe(-10);
  });

  it('spendPoints 余额不足 → 400', async () => {
    const db = makeDb();
    db.query = async (sql) => {
      if (/UPDATE users SET storage_points = storage_points -/.test(sql)) return { rows: [] };
      if (/SELECT storage_points FROM users/.test(sql)) return { rows: [{ storage_points: 3 }] };
      return { rows: [] };
    };
    await expect(svc.spendPoints(db, 1, 10, { reason: 'file_extend' })).rejects.toMatchObject({ status: 400 });
  });

  it('adjustPoints 校验：delta 0 → 422；缺 note → 422', async () => {
    await expect(svc.adjustPoints(1, 0, '原因')).rejects.toMatchObject({ status: 422 });
    await expect(svc.adjustPoints(1, 5, '  ')).rejects.toMatchObject({ status: 422 });
  });

  it('adjustPoints 成功走事务（pool.connect mock）', async () => {
    const txn = { calls: [], release: () => {} };
    txn.query = async (sql) => {
      txn.calls.push(sql);
      if (/^BEGIN/.test(sql) || /advisory/.test(sql)) return {};
      if (/UPDATE users SET storage_points = storage_points \+/.test(sql)) return { rows: [{ storage_points: 60 }] };
      if (/INSERT INTO points_ledger/.test(sql)) return { rows: [{ id: 1 }] };
      if (/COMMIT/.test(sql)) return {};
      return { rows: [] };
    };
    const origConnect = pool.connect;
    pool.connect = async () => txn;
    try {
      const r = await svc.adjustPoints(1, 10, '测试调整');
      expect(r.balance).toBe(60);
      expect(txn.calls.join('\n')).toContain('BEGIN');
      expect(txn.calls.join('\n')).toContain('COMMIT');
    } finally {
      pool.connect = origConnect;
    }
  });
});

describe('pointsService 赚取事件', () => {
  it('awardDailyLoginIfNewDay 使用当天日期作 refId', async () => {
    const db = makeDb();
    await svc.awardDailyLoginIfNewDay(db, 1);
    const insert = db.calls.find((c) => /INSERT INTO points_ledger/.test(c.sql));
    expect(insert.params[4]).toBe('daily_login');
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    expect(insert.params[5]).toBe(key);
  });

  it('awardQuizCompletion 只发增量（快照 5 → 8 发 3 分）', async () => {
    const db = makeDb();
    db._snapshot = { correct: 5 };
    const r = await svc.awardQuizCompletion(db, 1, 'ch1', { objCorrect: 8 });
    expect(r.points).toBe(3);
    expect(r.awarded).toBe(true);
  });

  it('awardQuizCompletion 无增量 → 不发', async () => {
    const db = makeDb();
    db._snapshot = { correct: 8 };
    const r = await svc.awardQuizCompletion(db, 1, 'ch1', { objCorrect: 8 });
    expect(r.awarded).toBe(false);
  });

  it('awardQuizCompletion 每日上限截断（已用 29 → 只发 1）', async () => {
    const db = makeDb();
    db._snapshot = { correct: 0 };
    db._sumSince = 29; // 已发 29
    const r = await svc.awardQuizCompletion(db, 1, 'ch1', { objCorrect: 5 });
    expect(r.points).toBe(1);
  });

  it('awardQuizCompletion T5 并发防重：真实 pool（带 connect）走事务行锁，后提交者读到已更新快照不再发分', async () => {
    const db = makeDb();
    db._snapshot = { correct: 5 };
    db.connect = async () => db; // 模拟 pool.connect 返回同一 client
    db.release = () => {}; // pool client 的 release
    const calls = db.calls;
    // 第一次结算：快照 correct=5 → 8，发 3 分
    const first = await svc.awardQuizCompletion(db, 1, 'ch1', { objCorrect: 8 });
    expect(first.points).toBe(3);
    expect(first.awarded).toBe(true);
    // 行锁 SQL 应带 FOR UPDATE
    expect(calls.some((c) => /FOR UPDATE/.test(c.sql))).toBe(true);
    // 模拟并发第二请求：此时快照已被第一请求推进到 8
    db._snapshot = { correct: 8 };
    const second = await svc.awardQuizCompletion(db, 1, 'ch1', { objCorrect: 8 });
    expect(second.awarded).toBe(false);
    expect(second.points).toBe(0);
    // 事务边界
    expect(calls.map((c) => c.sql).join('\n')).toContain('BEGIN');
    expect(calls.map((c) => c.sql).join('\n')).toContain('COMMIT');
  });

  it('awardShareDownload 单库封顶', async () => {
    const db = makeDb();
    db._shareEarned = 20; // 已满
    const r = await svc.awardShareDownload(db, 1, 99, 11);
    expect(r.awarded).toBe(false);
    expect(r.reason).toBe('capped');
  });

  it('awardShareDownload 未满发 2 分且幂等键含下载序数', async () => {
    const db = makeDb();
    db._shareEarned = 10;
    const r = await svc.awardShareDownload(db, 1, 99, 6);
    expect(r.awarded).toBe(true);
    const insert = db.calls.find((c) => /INSERT INTO points_ledger/.test(c.sql));
    expect(insert.params[5]).toBe('bank:99:6');
  });
});

describe('pointsService AI 配额', () => {
  it('generate 免费额度内不扣分', async () => {
    const db = makeDb();
    db._genLogs = 5; db._tasks = 2;
    const r = await svc.checkAndChargeAiQuota(db, 1, 'generate');
    expect(r.charged).toBe(false);
    expect(r.used).toBe(7);
  });

  it('generate 超出免费额度 → 扣 2 分', async () => {
    const db = makeDb();
    db._genLogs = 10; db._tasks = 1;
    const r = await svc.checkAndChargeAiQuota(db, 1, 'generate');
    expect(r.charged).toBe(true);
    expect(r.balance).toBe(32); // fake spend 返回 32
  });

  it('upload 免费额度内不扣分，超出扣 1 分', async () => {
    const db = makeDb();
    db._uploads = 9;
    expect((await svc.checkAndChargeAiQuota(db, 1, 'upload')).charged).toBe(false);
    db._uploads = 11;
    expect((await svc.checkAndChargeAiQuota(db, 1, 'upload')).charged).toBe(true);
  });
});

describe('pointsService 清零与规则', () => {
  it('computeNextExpiry：8月1日前 → 8月1日；之后 → 次年2月1日', () => {
    const before = svc.computeNextExpiry(new Date(2026, 6, 15)); // 7月15日
    expect(before.date).toBe('2026-08-01');
    expect(before.label).toBe('暑假积分清零');
    const after = svc.computeNextExpiry(new Date(2026, 9, 15)); // 10月15日
    expect(after.date).toBe('2027-02-01');
    expect(after.daysLeft).toBeGreaterThan(0);
  });

  it('getRules 返回规则与清零信息', () => {
    const rules = svc.getRules();
    expect(rules.earn.length).toBeGreaterThan(0);
    expect(rules.spend.length).toBeGreaterThan(0);
    expect(rules.nextExpiry.date).toBeTruthy();
    expect(rules.expiry.dates.length).toBe(2);
  });

  it('runExpiryCheck 非清零日不执行', async () => {
    const r = await svc.runExpiryCheck(new Date(2026, 6, 15));
    expect(r.reset).toBe(false);
  });

  it('startExpiryJob 幂等、unref 且可停止（T8）', () => {
    const origConnect = pool.connect;
    pool.connect = async () => { throw new Error('no db in test'); };
    try {
      const t1 = svc.startExpiryJob();
      const t2 = svc.startExpiryJob();
      expect(t2).toBe(t1); // 幂等：重复启动返回同一 timer
      expect(t1).toBeTruthy();
      expect(typeof t1.unref).toBe('function'); // Node 定时器带 unref
      svc.stopExpiryJob();
      const t3 = svc.startExpiryJob(); // 停止后可重启
      expect(t3).not.toBe(t1);
      svc.stopExpiryJob();
      expect(svc.stopExpiryJob).toBeTypeOf('function');
    } finally {
      pool.connect = origConnect;
    }
  });
});