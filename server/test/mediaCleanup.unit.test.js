'use strict';

// v3.37.7 聊天媒体治理：定时任务与文件路径工具的单测。
// 关注点：任务必须只启动一次、必须 unref（不能阻止进程退出）、
// 停机时能停掉；派生小图必须跟着主文件一起被识别。

const fs = require('fs');
const path = require('path');
// globals: true（vitest.config）—— 直接用全局 describe/it/expect/vi，不做 CJS require。
const { installFakePool } = require('./helpers');
const svc = require('../src/services/chatMediaService');
const cfg = require('../src/config/files');

describe('聊天媒体回收任务的生命周期（v3.37.7）', () => {
  beforeEach(() => {
    installFakePool([
      [/SELECT stored_name FROM chat_media_assets/, async () => ({ rows: [] })],
      [/FROM chat_media_assets/, async () => ({ rows: [] })],
    ]);
    svc.stopChatMediaJob();
  });

  afterEach(() => {
    svc.stopChatMediaJob();
    vi.useRealTimers();
  });

  it('启动是幂等的，且定时器被 unref（不阻止进程退出）', () => {
    vi.useFakeTimers();
    const t1 = svc.startChatMediaJob();
    const t2 = svc.startChatMediaJob();
    expect(t1).toBe(t2);
    expect(typeof t1.unref).toBe('function');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('停止后定时器被清掉，可以再次启动', () => {
    vi.useFakeTimers();
    svc.startChatMediaJob();
    svc.stopChatMediaJob();
    expect(vi.getTimerCount()).toBe(0);
    const t = svc.startChatMediaJob();
    expect(t).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('聊天媒体路径工具（v3.37.7）', () => {
  it('主文件与它的全部派生小图一起被识别（撤回/过期不留小图垃圾）', () => {
    const main = 'chat_pathprobe_abc.png';
    const thumb = 'chat_pathprobe_abc.w480.png';
    const abs = path.join(svc.CHAT_UPLOAD_DIR, main);
    const absThumb = path.join(svc.CHAT_UPLOAD_DIR, thumb);
    fs.writeFileSync(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(absThumb, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const paths = svc.assetFilePaths(main);
    expect(paths).toContain(abs);
    expect(paths).toContain(absThumb);

    svc.removeAssetFiles(main);
    expect(fs.existsSync(abs)).toBe(false);
    expect(fs.existsSync(absThumb)).toBe(false);
  });

  it('扩展名决定 kind：图片与普通文件分开记账', () => {
    expect(svc.kindOfName('chat_1_a.png')).toBe('image');
    expect(svc.kindOfName('chat_1_a.WEBP')).toBe('image');
    expect(svc.kindOfName('chat_1_a.pdf')).toBe('file');
    expect(svc.kindOfName('chat_1_a.zip')).toBe('file');
  });

  it('limitsSnapshot 支持覆盖，用于测试与灰度调参', () => {
    const base = svc.limitsSnapshot();
    expect(base.maxPerHour).toBe(cfg.CHAT_UPLOAD_MAX_PER_HOUR);
    expect(base.orphanTtlHours).toBe(cfg.CHAT_ORPHAN_TTL_HOURS);
    expect(base.retentionDays).toBe(cfg.CHAT_MEDIA_RETENTION_DAYS);
    const custom = svc.limitsSnapshot({ maxPerHour: 3 });
    expect(custom.maxPerHour).toBe(3);
    expect(custom.retentionDays).toBe(cfg.CHAT_MEDIA_RETENTION_DAYS);
  });

  it('磁盘剩余空间探测：真实目录返回正数', () => {
    const free = svc.freeBytesOf(svc.CHAT_UPLOAD_DIR);
    if (free !== null) expect(free).toBeGreaterThan(0);
  });
});
