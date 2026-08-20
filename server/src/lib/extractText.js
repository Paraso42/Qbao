'use strict';

// 文件文本提取（txt/md/pdf/docx/pptx…）
// 自 ai.routes.js 抽离为共享模块，供文件池资料加载（lib/poolText.js）与 AI 出题路由复用，
// 保证两条生成链路（流式 /ai/generate 与后台任务队列）的提取行为完全一致。

const fs = require('fs');

let pdfParseAvailable = false;
try { require('pdf-parse'); pdfParseAvailable = true; } catch (e) { }

let mammothAvailable = false;
try { require('mammoth'); mammothAvailable = true; } catch (e) { }

let unzipperAvailable = false;
try { require('unzipper'); unzipperAvailable = true; } catch (e) { }

async function extractText(filePath, ext) {
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return { type: 'text', content: '', extracted: true, empty: true };
  }
  if (['txt', 'md'].includes(ext)) {
    var txtContent = fs.readFileSync(filePath, 'utf-8');
    return { type: 'text', content: txtContent, extracted: true, empty: !txtContent.trim() };
  }
  if (ext === 'pdf') {
    if (!pdfParseAvailable) {
      return { type: 'text', content: '', extracted: false, error: 'pdf-parse 包未安装' };
    }
    try {
      const pdf = require('pdf-parse');
      const raw = fs.readFileSync(filePath);
      const data = await pdf(raw);
      if (!data.text || data.text.trim().length === 0) {
        return { type: 'text', content: '', extracted: true, empty: true, warning: '未提取到文字内容' };
      }
      return { type: 'text', content: data.text, extracted: true, empty: false };
    } catch (e) {
      return { type: 'text', content: '', extracted: false, error: 'PDF解析失败: ' + e.message };
    }
  }
  if (['docx'].includes(ext)) {
    if (!mammothAvailable) {
      return { type: 'text', content: '', extracted: false, error: 'mammoth 包未安装' };
    }
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      var dEmpty = !result.value || !result.value.trim();
      return {
        type: 'text', content: result.value || '', extracted: true, empty: dEmpty,
        warning: dEmpty ? 'DOCX文件未提取到文字内容' : undefined,
      };
    } catch (e) {
      return { type: 'text', content: '', extracted: false, error: 'DOCX解析失败: ' + e.message };
    }
  }
  if (ext === 'doc') {
    return { type: 'text', content: '', extracted: false, error: '旧版.doc格式不支持，请转换为.docx后重新上传' };
  }
  if (['pptx'].includes(ext)) {
    if (!unzipperAvailable) {
      return { type: 'text', content: '', extracted: false, error: 'unzipper 包未安装' };
    }
    try {
      const unzip = require('unzipper');
      const extracted = await unzip.Open.file(filePath);
      let text = '';
      for (const entry of extracted.files) {
        if (entry.path.match(/^ppt\/slides\/slideshow\d+\.xml$/)) {
          const xml = await entry.buffer().then((b) => b.toString('utf-8'));
          const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
          if (matches) {
            matches.forEach((m) => { text += m.replace(/<a:t[^>]*>|<\/a:t>/g, '') + '\n'; });
          }
        }
      }
      var pEmpty = !text.trim();
      return {
        type: 'text', content: text || '', extracted: true, empty: pEmpty,
        warning: pEmpty ? 'PPTX文件未提取到文字内容' : undefined,
      };
    } catch (e) {
      return { type: 'text', content: '', extracted: false, error: 'PPTX解析失败: ' + e.message };
    }
  }
  return { type: 'unknown', extracted: false, error: '不支持的文件类型: .' + ext };
}

module.exports = { extractText };
