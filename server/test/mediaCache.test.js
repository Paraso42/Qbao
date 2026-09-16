'use strict';

// v3.37.5：受保护媒体端点必须显式下发长缓存，否则：
//   ① 退回 send 默认的 "public, max-age=0" → 每次打开聊天都全量回源；
//   ② 被按扩展名匹配的中间层（Caddy @assets '*.png'）改写成一周，把 401/404 一起缓存。
// 这里锁死「两个端点都走 sendMediaFile」以及缓存头常量本身。
// 说明：本仓库 vitest 以 globals:true 运行（见 vitest.config.js），
// CJS 下 require('vitest') 会直接报错，故只能用全局 describe/it/expect。
const { MEDIA_CACHE_CONTROL, sendMediaFile } = require('../src/lib/mediaCache');

function mkRes(sent) {
  const headers = {};
  return {
    headers,
    setHeader: (k, v) => { headers[k] = v; },
    sendFile: (p, o) => { sent.push({ path: p, options: o }); return 'sent'; },
  };
}

describe('mediaCache', () => {
  it('缓存头为 private + 一年 + immutable', () => {
    expect(MEDIA_CACHE_CONTROL).toBe('private, max-age=31536000, immutable');
    expect(MEDIA_CACHE_CONTROL).toContain('private');
  });

  it('sendMediaFile 显式设头，并关闭 send 自带的 max-age=0', () => {
    const sent = [];
    const res = mkRes(sent);
    const ret = sendMediaFile(res, '/tmp/a.png');
    expect(res.headers['Cache-Control']).toBe(MEDIA_CACHE_CONTROL);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(sent[0].options.cacheControl).toBe(false);
    expect(ret).toBe('sent');
  });

  it('调用方传入的 options 不会覆盖 cacheControl（保持关闭）', () => {
    const sent = [];
    sendMediaFile(mkRes(sent), '/tmp/a.png', { cacheControl: true, maxAge: '1d' });
    expect(sent[0].options.cacheControl).toBe(false);
  });

  it('chat 与 issues 两个端点都改用了 sendMediaFile（防回退）', () => {
    const fs = require('fs');
    const path = require('path');
    const files = [
      path.join(__dirname, '..', 'src', 'routes', 'chat.routes.v2.js'),
      path.join(__dirname, '..', 'src', 'routes', 'issues.routes.v2.js'),
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).toContain("require('../lib/mediaCache')");
      expect(src).toContain('sendMediaFile(res, filePath)');
    }
  });
});
