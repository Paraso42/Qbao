'use strict';

const fs = require('fs');
const { installFakePool } = require('./helpers');
const { getCachedOrExtractFileText } = require('../src/services/aiMaterialCache');

describe('AI 资料提取缓存', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('缓存有效时直接复用 extracted_text，不重新解析', async () => {
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 123, mtimeMs: 456 });
    installFakePool([]);

    const extractText = vi.fn();
    const row = {
      id: 1,
      original_name: 'a.pdf',
      extract_status: 'ok',
      extracted_text: '缓存内容',
      source_size: 123,
      source_mtime_ms: 456,
    };

    const result = await getCachedOrExtractFileText(row, '/tmp/a.pdf', 'pdf', extractText);

    expect(result.cached).toBe(true);
    expect(result.content).toBe('缓存内容');
    expect(extractText).not.toHaveBeenCalled();
  });

  it('缓存失效时重新提取并回写数据库', async () => {
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 123, mtimeMs: 789 });
    let updatedParams = null;

    installFakePool([
      [/UPDATE user_files/, async (_sql, params) => {
        updatedParams = params;
        return { rows: [] };
      }],
    ]);

    const extractText = vi.fn(async () => ({
      type: 'text',
      content: '新提取内容',
      extracted: true,
      empty: false,
    }));
    const row = {
      id: 2,
      original_name: 'b.txt',
      extract_status: 'ok',
      extracted_text: '旧内容',
      source_size: 123,
      source_mtime_ms: 456,
    };

    const result = await getCachedOrExtractFileText(row, '/tmp/b.txt', 'txt', extractText);

    expect(extractText).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.content).toBe('新提取内容');
    expect(updatedParams[0]).toBe(2);
    expect(updatedParams[1]).toBe('ok');
    expect(updatedParams[2]).toBe('新提取内容');
    expect(updatedParams[4]).toBe(789);
  });
});
