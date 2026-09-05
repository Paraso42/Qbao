'use strict';

const statsService = require('../src/services/desktopStats');

// 测试隔离：统计走内存路径，不触 DB（stats 服务运行时读取该变量）
process.env.QBAO_DESKTOP_STATS = 'off';

describe('desktopStats 下载统计（QBAO_DESKTOP_STATS=off 内存路径）', () => {
  beforeEach(() => {
    statsService._resetForTests();
  });

  it('recordDownload 计数并可按版本/近 30 天聚合', async () => {
    statsService.recordDownload('3.36.0', 'Qbao-Setup-3.36.0.exe');
    statsService.recordDownload('3.36.0', 'Qbao-Setup-3.36.0.exe');
    statsService.recordDownload('3.34.2', 'Qbao-Setup-3.34.2.exe');
    const s = await statsService.getStats();
    const row = s.perVersion.find((x) => x.version === '3.36.0');
    expect(row.downloads).toBe(2);
    expect(s.perVersion.find((x) => x.version === '3.34.2').downloads).toBe(1);
    expect(s.last30d.length).toBeGreaterThanOrEqual(1);
    expect(s.last30d[s.last30d.length - 1]).toMatchObject({ day: expect.any(String), total: expect.any(Number) });
  });

  it('空参数不计数；reset 后清空', async () => {
    statsService.recordDownload('', '');
    statsService.recordDownload(null, null);
    let s = await statsService.getStats();
    expect(s.perVersion.length).toBe(0);
    statsService.recordDownload('3.36.0', 'Qbao-Setup-3.36.0.exe');
    statsService._resetForTests();
    s = await statsService.getStats();
    expect(s.perVersion.length).toBe(0);
  });
});