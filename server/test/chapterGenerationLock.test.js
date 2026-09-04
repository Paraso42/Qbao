'use strict';

const { installFakePool } = require('./helpers');
const {
  acquireChapterGenerationLock,
  releaseChapterGenerationLock,
} = require('../src/services/chapterGenerationLock');

describe('chapterGenerationLock 同章节生成互斥锁 (round6)', () => {
  it('抢锁成功：先清理孤儿锁 → 插入唯一锁，返回幂等 release', async () => {
    const calls = [];
    installFakePool([
      [/DELETE FROM ai_generation_locks WHERE user_id = \$1 AND chapter_id = \$2 AND created_at < /, async (sql, params) => {
        calls.push(['staleClean', params.slice()]);
        return { rowCount: 0 };
      }],
      [/INSERT INTO ai_generation_locks/, async (sql, params) => {
        calls.push(['insert', params.slice()]);
        return { rows: [{ id: 1 }] };
      }],
      [/^DELETE FROM ai_generation_locks WHERE user_id = \$1 AND chapter_id = \$2$/, async (sql, params) => {
        calls.push(['release', params.slice()]);
        return { rowCount: 1 };
      }],
    ]);

    const release = await acquireChapterGenerationLock(61, 'ch1', 'direct');
    expect(typeof release).toBe('function');
    expect(calls.map((c) => c[0])).toEqual(['staleClean', 'insert']);

    await release();
    await release(); // 幂等，可重复释放
    expect(calls.map((c) => c[0])).toEqual(['staleClean', 'insert', 'release', 'release']);
    expect(calls[1][1]).toEqual([61, 'ch1', 'direct']);
    expect(calls[2][1]).toEqual([61, 'ch1']);
  });

  it('锁被占用 → 409（直连生成中/任务生成中，同一章节只允许一轮）', async () => {
    installFakePool([
      [/DELETE FROM ai_generation_locks WHERE user_id = \$1 AND chapter_id = \$2 AND created_at < /, async () => ({ rowCount: 0 })],
      [/INSERT INTO ai_generation_locks/, async () => ({ rows: [] })],
    ]);

    await expect(acquireChapterGenerationLock(61, 'ch1', 'direct')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('正在生成中'),
    });
  });

  it('无 chapterId（大考卷等）不参与章节互斥，直接返回 null', async () => {
    let queries = 0;
    installFakePool([[/./, async () => { queries++; return { rows: [] }; }]]);
    const r = await acquireChapterGenerationLock(61, null, 'direct');
    expect(r).toBeNull();
    expect(queries).toBe(0);
  });

  it('releaseChapterGenerationLock 直接释放（任务终态、取消路径）', async () => {
    const calls = [];
    installFakePool([[/^DELETE FROM ai_generation_locks WHERE user_id = \$1 AND chapter_id = \$2$/, async (sql, params) => {
      calls.push(params.slice());
      return { rowCount: 1 };
    }]]);
    await releaseChapterGenerationLock(61, 'ch1');
    expect(calls).toEqual([[61, 'ch1']]);
    await releaseChapterGenerationLock(61, null); // 空章节安全无操作
    expect(calls).toHaveLength(1);
  });
});