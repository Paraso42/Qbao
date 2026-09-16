'use strict';

// ============================================================
// mediaCache.js — 受保护媒体（聊天附件 / 工单图片）的响应缓存与传输头（v3.37.5）
//
// 真实事故：手机原图数 MB，发出后自己和对方打开聊天都要把整包重新拉一遍。
// 根因有两条，这里修服务端那条：
//   ① res.sendFile 默认下发 "Cache-Control: public, max-age=0"，等于「每次都用，
//      但每次都回源校验」；而 Caddy 的 @assets（按 *.png/*.jpg 扩展名匹配）会把
//      它覆写成 "public, max-age=604800"（一周）——连 401/404 一起缓存一周，
//      图片一旦裂就再也回不来；
//   ② 文件名由服务端随机生成、内容不可变、且下载本身需要 Bearer 或 1 小时有效的
//      签名 ticket，因此**内容可以长期缓存**，短缓存对客户端毫无收益。
//
// 结论：由业务端点显式接管缓存头（private + 一年 + immutable），并关掉 send 库
// 自带的 max-age=0，避免两个 Cache-Control 同时出现。
// private：媒体内容属于用户私有数据，不允许中间共享缓存保存。
// ============================================================

const MEDIA_CACHE_CONTROL = 'private, max-age=31536000, immutable';

// 在 res.sendFile 之前调用：显式声明缓存策略并关掉 send 的默认 setHeaders。
function sendMediaFile(res, filePath, options) {
  res.setHeader('Cache-Control', MEDIA_CACHE_CONTROL);
  // 浏览器对带 nosniff 的图片按声明的 Content-Type 处理，避免嗅探
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // cacheControl 放在最后合并：调用方无法把它打开（否则 send 会再追加一个 max-age=0）
  return res.sendFile(filePath, Object.assign({}, options || {}, { cacheControl: false }));
}

module.exports = { MEDIA_CACHE_CONTROL, sendMediaFile };
