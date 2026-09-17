'use strict';

// v3.37.7 聊天媒体加固回归：
//   目标一：用户不能靠聊天消息堵住服务器带宽（下载侧字节预算 + 媒体限流）；
//   目标二：图片/文件不能长期占用硬盘（孤儿 24h、保留期 180d、撤回即释放）；
//   目标三：不能拿这套系统存超大文件（单文件 20MB / 图片 8MB / 按账号配额）。
//
// 这里既有纯函数用例（配额判定、URL 解析、字节预算），也有真实 HTTP 用例
// （supertest + 假连接池 + 真实磁盘文件），确保「被拒的请求不会落盘」。

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');
const svc = require('../src/services/chatMediaService');
const { createByteBudget, isMediaRequest } = require('../src/lib/mediaLimits');
const cfg = require('../src/config/files');

const CHAT_DIR = svc.CHAT_UPLOAD_DIR;

const PNG_HEAD = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
];
function png(bytes) {
  return Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(Math.max(0, bytes - PNG_HEAD.length), 0xaa)]);
}
const SMALL_PNG = png(80);

function listing() {
  try { return fs.readdirSync(CHAT_DIR).sort(); } catch (_) { return []; }
}

function cleanup(files) {
  for (const f of files) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) { /* 忽略 */ }
  }
}

describe('聊天媒体加固：配额与水位（v3.37.7）', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);
  });

  it('配额判定：三类超限分别给出 429/429/413，未超限则放行', () => {
    const L = svc.limitsSnapshot();
    expect(svc.evaluateQuota({ hourCount: 0, dayBytes: 0, totalBytes: 0 }, L).ok).toBe(true);

    const hourly = svc.evaluateQuota({ hourCount: L.maxPerHour, dayBytes: 0, totalBytes: 0 }, L);
    expect(hourly.ok).toBe(false);
    expect(hourly.status).toBe(429);
    expect(hourly.error).toContain('上传过于频繁');

    const daily = svc.evaluateQuota({ hourCount: 0, dayBytes: L.dailyBytes, totalBytes: 0 }, L);
    expect(daily.status).toBe(429);
    expect(daily.error).toContain('今日上传流量已用完');

    const total = svc.evaluateQuota({ hourCount: 0, dayBytes: 0, totalBytes: L.totalBytes }, L);
    expect(total.status).toBe(413);
    expect(total.error).toContain('聊天文件存储已满');
  });

  it('上限口径自洽：图片严于文件、小图严于图片、每日严于总量', () => {
    expect(cfg.CHAT_MAX_IMAGE_BYTES).toBeLessThan(cfg.CHAT_MAX_FILE_BYTES);
    expect(cfg.CHAT_MAX_THUMB_BYTES).toBeLessThan(cfg.CHAT_MAX_IMAGE_BYTES);
    expect(cfg.CHAT_USER_DAILY_UPLOAD_BYTES).toBeLessThan(cfg.CHAT_USER_TOTAL_BYTES);
    expect(cfg.CHAT_MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
  });

  it('磁盘水位：低于阈值拒绝上传（503），够用则放行，探测不可用时不拦', () => {
    const L = svc.limitsSnapshot();
    const low = function () { return { bavail: 100, bsize: 4096 }; };
    const plenty = function () { return { bavail: 10 * 1024 * 1024, bsize: 4096 }; };
    const broken = function () { throw new Error('statfs unsupported'); };

    expect(() => svc.assertDiskHeadroom(L, { statfs: low })).toThrow(/存储空间不足/);
    expect(svc.assertDiskHeadroom(L, { statfs: plenty })).toBe(10 * 1024 * 1024 * 4096);
    expect(svc.assertDiskHeadroom(L, { statfs: broken })).toBe(null);
  });

  it('uploadGate：配额超限时 next(错误)，且不进入后续中间件', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/FROM chat_media_assets WHERE user_id/, async () => ({ rows: [{ day_bytes: 0, total_bytes: 0, hour_count: 999 }] })],
    ]);
    const gate = svc.uploadGate({ limits: { maxPerHour: 5 } });
    let passed = false;
    const err = await new Promise((resolve) => {
      gate({ userId: 1 }, {}, (e) => { passed = !e; resolve(e); });
    });
    expect(passed).toBe(false);
    expect(err.status).toBe(429);
  });

  it('上传超配额 → 429，且磁盘上一个字节都没写', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/FROM chat_media_assets WHERE user_id/, async () => ({ rows: [{ day_bytes: 0, total_bytes: 0, hour_count: cfg.CHAT_UPLOAD_MAX_PER_HOUR }] })],
    ]);
    const before = listing();
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', SMALL_PNG, 'a.png');
    expect(res.status).toBe(429);
    expect(listing()).toEqual(before);
  });

  it('正常上传 → 200 且入台账（小图字节一并计入）', async () => {
    const inserts = [];
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/INSERT INTO chat_media_assets/, async (sql, params) => { inserts.push(params); return { rows: [] }; }],
    ]);
    const thumbBuf = png(2048);
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', SMALL_PNG, 'a.png')
      .attach('thumb', thumbBuf, 'thumb.png');

    expect(res.status).toBe(200);
    expect(inserts.length).toBe(1);
    expect(inserts[0][0]).toBe(1);                     // userId
    expect(inserts[0][1]).toMatch(/^chat_\d+_[a-z0-9]+\.png$/);
    expect(inserts[0][2]).toBe('image');
    expect(inserts[0][3]).toBe(SMALL_PNG.length + thumbBuf.length);

    const name = inserts[0][1];
    cleanup(svc.assetFilePaths(name));
  });

  it('台账表还没迁移（020 未执行）时，上传仍能成功：降级而不是 500', async () => {
    svc.resetLedgerWarning();
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/INSERT INTO chat_media_assets/, async () => { throw new Error('relation "chat_media_assets" does not exist'); }],
    ]);
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', SMALL_PNG, 'a.png');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/api/v1/chat/files/');
    cleanup(svc.assetFilePaths(res.body.url.split('/').pop().split('?')[0]));
  });

  it('声明体积超上限 → 在解析 multipart 之前就 413（一个字节都不读）', async () => {
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);
    const gate = svc.uploadGate();
    const run = (contentLength) => new Promise((resolve) => {
      gate({ userId: 1, headers: { 'content-length': String(contentLength) } }, {}, (e) => resolve(e));
    });

    const err = await run(cfg.CHAT_MAX_FILE_BYTES + 10 * 1024 * 1024);
    expect(err.status).toBe(413);
    expect(err.message).toContain('请求体积超过上限');
    // 上限内的声明体积照常放行（不能误伤正常上传）
    expect(await run(SMALL_PNG.length)).toBeUndefined();
  });

  it('图片超过 8MB → 413，且文件被立刻删除（不留痕）', async () => {
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);
    const before = listing();
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', png(cfg.CHAT_MAX_IMAGE_BYTES + 1024), 'huge.png');

    expect(res.status).toBe(413);
    expect(res.body.error).toContain('图片超过');
    expect(listing()).toEqual(before);
  });
});

describe('聊天媒体加固：归属与回收（v3.37.7）', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
  });

  it('附件地址解析：只认本站 /chat/files/，去掉票据，拒绝穿越', () => {
    expect(svc.mediaNameOf('/api/v1/chat/files/chat_1_ab.png?t=123.abc')).toBe('chat_1_ab.png');
    expect(svc.mediaNameOf('https://beta.questionbox.cn/api/v1/chat/files/chat_9_zz.webp')).toBe('chat_9_zz.webp');
    expect(svc.mediaNameOf('https://evil.example.com/x.png')).toBe(null);
    expect(svc.mediaNameOf('/api/v1/chat/files/../../etc/passwd')).toBe(null);
    expect(svc.mediaNameOf('')).toBe(null);
  });

  it('媒体路径判定：聊天附件与工单图片命中，普通接口不命中', () => {
    expect(isMediaRequest({ originalUrl: '/api/v1/chat/files/a.png?t=1' })).toBe(true);
    expect(isMediaRequest({ originalUrl: '/api/v1/issues/images/b.png' })).toBe(true);
    expect(isMediaRequest({ originalUrl: '/api/v1/chat/rooms/1/messages' })).toBe(false);
    expect(isMediaRequest({ originalUrl: '/api/v1/chat/files' })).toBe(false);
  });

  it('字节预算：累计到上限即拒绝，窗口滑过后恢复，被拒的请求不记账', () => {
    const b = createByteBudget({ windowMs: 1000, maxBytes: 100 });
    expect(b.allows('ip', 60, 0)).toBe(true);
    b.consume('ip', 60, 0);
    expect(b.allows('ip', 40, 100)).toBe(true);
    expect(b.allows('ip', 41, 100)).toBe(false);   // 已用 60，再加 41 超 100
    expect(b.used('ip', 100)).toBe(60);            // 被拒的请求没有记账
    expect(b.allows('ip', 100, 1001)).toBe(true);  // 窗口滑过，额度恢复
    // 不同 IP 互不影响
    expect(b.used('other', 100)).toBe(0);
  });

  it('引用他人上传的文件 → 403；引用不存在的文件 → 422', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT 1 FROM chat_room_members/, async () => ({ rows: [{ '?column?': 1 }] })],
      [/SELECT stored_name, user_id FROM chat_media_assets/, async () => ({ rows: [{ stored_name: 'chat_1_x.png', user_id: 2 }] })],
    ]);
    const res = await request(app)
      .post('/api/v1/chat/rooms/1/messages')
      .set('Authorization', 'Bearer ' + token)
      .send({ msg_type: 'image', images: ['/api/v1/chat/files/chat_1_x.png'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('他人');

    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT 1 FROM chat_room_members/, async () => ({ rows: [{ '?column?': 1 }] })],
    ]);
    const res2 = await request(app)
      .post('/api/v1/chat/rooms/1/messages')
      .set('Authorization', 'Bearer ' + token)
      .send({ msg_type: 'image', images: ['/api/v1/chat/files/chat_404_none.png'] });
    expect(res2.status).toBe(422);
  });

  it('把外部链接当附件发 → 422（不能借聊天分发站外文件）', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT 1 FROM chat_room_members/, async () => ({ rows: [{ '?column?': 1 }] })],
    ]);
    const res = await request(app)
      .post('/api/v1/chat/rooms/1/messages')
      .set('Authorization', 'Bearer ' + token)
      .send({ msg_type: 'image', images: ['https://evil.example.com/a.png'] });
    expect(res.status).toBe(422);
  });

  it('撤回消息 → 主图与派生小图一起从磁盘消失，台账销账', async () => {
    const main = 'chat_test_revoke.png';
    const thumb = 'chat_test_revoke.w480.webp';
    fs.writeFileSync(path.join(CHAT_DIR, main), SMALL_PNG);
    fs.writeFileSync(path.join(CHAT_DIR, thumb), SMALL_PNG);

    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT \* FROM chat_messages WHERE id = \$1/, async () => ({
        rows: [{ id: 5, user_id: 1, images: [], file_info: null, created_at: new Date() }],
      })],
      [/SELECT id, stored_name FROM chat_media_assets/, async () => ({ rows: [{ id: 1, stored_name: main }] })],
    ]);

    const res = await request(app)
      .post('/api/v1/chat/messages/5/revoke')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.releasedMedia).toBe(1);
    expect(fs.existsSync(path.join(CHAT_DIR, main))).toBe(false);
    expect(fs.existsSync(path.join(CHAT_DIR, thumb))).toBe(false);
  });

  it('回收任务：孤儿删除台账行，过期只释放字节（保留台账），残留文件按保留期清', async () => {
    const orphan = 'chat_test_orphan.png';
    const expired = 'chat_test_expired.png';
    const stale = 'chat_test_stale_1999.png';
    for (const f of [orphan, expired, stale]) fs.writeFileSync(path.join(CHAT_DIR, f), SMALL_PNG);
    // 让「无台账残留」用例的文件足够老（保留期之外）
    const old = new Date(Date.now() - (cfg.CHAT_MEDIA_RETENTION_DAYS + 10) * 24 * 3600 * 1000);
    fs.utimesSync(path.join(CHAT_DIR, stale), old, old);

    const statements = [];
    installFakePool([
      [/SELECT stored_name FROM chat_media_assets/, async () => ({ rows: [] })],
      [/FROM chat_media_assets\s+WHERE message_id IS NULL/, async () => ({
        rows: [{ id: 11, stored_name: orphan, file_size: 80 }],
      })],
      [/FROM chat_media_assets\s+WHERE purged_at IS NULL AND created_at/, async () => ({
        rows: [{ id: 12, stored_name: expired, file_size: 80 }],
      })],
      [/DELETE FROM chat_media_assets WHERE id = ANY/, async (sql) => { statements.push(sql); return { rows: [] }; }],
      [/UPDATE chat_media_assets SET purged_at/, async (sql) => { statements.push(sql); return { rows: [] }; }],
    ]);

    const result = await svc.sweepOnce();
    expect(result.orphans).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.untracked).toBe(1);
    expect(result.freedBytes).toBe(160);
    expect(fs.existsSync(path.join(CHAT_DIR, orphan))).toBe(false);
    expect(fs.existsSync(path.join(CHAT_DIR, expired))).toBe(false);
    expect(fs.existsSync(path.join(CHAT_DIR, stale))).toBe(false);
    expect(statements.some((s) => /DELETE FROM chat_media_assets/.test(s))).toBe(true);
    expect(statements.some((s) => /UPDATE chat_media_assets SET purged_at/.test(s))).toBe(true);
  });

  it('历史文件回填：被消息引用的认回归属，未引用的记为孤儿', async () => {
    const referenced = 'chat_test_backfill_ref.png';
    const orphan = 'chat_test_backfill_orphan.png';
    const derivative = 'chat_test_backfill_ref.w480.webp';
    for (const f of [referenced, orphan, derivative]) fs.writeFileSync(path.join(CHAT_DIR, f), SMALL_PNG);

    const inserts = [];
    installFakePool([
      [/SELECT stored_name FROM chat_media_assets/, async () => ({ rows: [] })],
      [/SELECT id, user_id, images, file_info FROM chat_messages/, async () => ({
        rows: [{ id: 77, user_id: 9, images: ['/api/v1/chat/files/' + referenced], file_info: null }],
      })],
      [/INSERT INTO chat_media_assets/, async (sql, params) => { inserts.push(params); return { rows: [] }; }],
    ]);

    const n = await svc.backfillUntracked();
    expect(n).toBeGreaterThanOrEqual(2); // 目录里可能还有别的历史残留，只断言本次这三个
    expect(inserts.some((p) => p[1] === derivative)).toBe(false); // 派生小图不单独建账
    const refRow = inserts.find((p) => p[1] === referenced);
    const orphanRow = inserts.find((p) => p[1] === orphan);
    expect(refRow[0]).toBe(9);      // 归属回溯到发送者
    expect(refRow[4]).toBe(77);     // 绑定到引用它的消息
    expect(orphanRow[0]).toBe(null);
    expect(orphanRow[4]).toBe(null);

    cleanup([referenced, orphan, derivative].map((f) => path.join(CHAT_DIR, f)));
  });
});

describe('聊天媒体加固：下载侧字节预算（v3.37.7）', () => {
  const app = createApp();
  let token;
  const created = [];

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([]);
    require('../src/lib/mediaLimits').mediaDownloadBudget.reset();
  });

  afterEach(() => {
    cleanup(created.splice(0));
    require('../src/lib/mediaLimits').mediaDownloadBudget.reset();
  });

  it('下载超预算 → 429；未超时正常返回', async () => {
    const name = 'chat_test_budget.png';
    const abs = path.join(CHAT_DIR, name);
    fs.writeFileSync(abs, SMALL_PNG);
    created.push(abs);

    const budget = require('../src/lib/mediaLimits').mediaDownloadBudget;
    const ok = await request(app)
      .get('/api/v1/chat/files/' + name)
      .set('Authorization', 'Bearer ' + token);
    expect(ok.status).toBe(200);
    expect(budget.used('::ffff:127.0.0.1') + budget.used('127.0.0.1')).toBeGreaterThan(0);

    // 直接把预算吃满，再请求同一个文件
    budget.consume('127.0.0.1', budget.maxBytes);
    budget.consume('::ffff:127.0.0.1', budget.maxBytes);
    const blocked = await request(app)
      .get('/api/v1/chat/files/' + name)
      .set('Authorization', 'Bearer ' + token);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('下载流量');
  });
});
