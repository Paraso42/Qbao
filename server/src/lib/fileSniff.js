'use strict';

// ============================================================
// fileSniff.js — 上传文件 magic bytes 校验（T2 整改）
// 扩展名/客户端 mimetype 可伪造；用文件头字节二次确认真实类型，
// 防「改扩展名的 HTML/SVG」绕过白名单造成同源存储型 XSS。
// ============================================================

const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  gif: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
  gif2: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
};

function startsWith(buf, bytes) {
  if (!buf || buf.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[i] !== bytes[i]) return false;
  }
  return true;
}

function sniffJpeg(buf) {
  return !!buf && buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function sniffWebp(buf) {
  // RIFF .... WEBP
  if (!buf || buf.length < 12) return false;
  return (
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  );
}

// 返回扩展名对应的真实类型；不匹配返回 null。ext 形如 ".png"（小写）。
function sniffFileType(buf, ext) {
  if (!buf || buf.length === 0) return null;
  switch (ext) {
    case '.png': return startsWith(buf, MAGIC.png) ? 'png' : null;
    case '.jpg':
    case '.jpeg': return sniffJpeg(buf) ? 'jpeg' : null;
    case '.gif':
      return (startsWith(buf, MAGIC.gif) || startsWith(buf, MAGIC.gif2)) ? 'gif' : null;
    case '.webp': return sniffWebp(buf) ? 'webp' : null;
    case '.pdf': return startsWith(buf, MAGIC.pdf) ? 'pdf' : null;
    default: return null;
  }
}

// 便捷包装：multer fileFilter 内使用。图片/pdf 要求 magic bytes 匹配；
// 其余文档/压缩包类型仅扩展名把关（由调用方 fileFilter 负责）。
function isTrustedUpload(buf, ext) {
  if (!ext) return false;
  const e = String(ext).toLowerCase();
  if (e === '.png' || e === '.jpg' || e === '.jpeg' || e === '.gif' || e === '.webp' || e === '.pdf') {
    return sniffFileType(buf, e) !== null;
  }
  return true;
}

module.exports = { sniffFileType, isTrustedUpload };