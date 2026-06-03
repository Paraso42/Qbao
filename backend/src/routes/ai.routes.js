const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

const ECNU_BASE = 'https://chat.ecnu.edu.cn/open/api/v1';

function getEcnuClient(apiKey) {
  const key = apiKey || process.env.ECNU_API_KEY || 'your-key';
  const opts = { apiKey: key, baseURL: ECNU_BASE };
  if (typeof opts.skipUpdateCheck === 'undefined') opts.httpAgent = undefined;
  return new OpenAI(opts);
}

async function callEcnuApi(apiKey, model, messages, options) {
  const key = apiKey || process.env.ECNU_API_KEY || 'your-key';
  const body = { model, messages, ...options };
  const contentLen = (body.messages[1] && body.messages[1].content && typeof body.messages[1].content === 'string') ? body.messages[1].content.length : 0;
  console.log('callEcnuApi: posting to', ECNU_BASE + '/chat/completions', 'model=' + model, 'contentLen=' + contentLen, 'max_tokens=' + (options.max_tokens || 'default'));
  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, 300000);
  const start = Date.now();
  try {
    const res = await fetch(ECNU_BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const ms = Date.now() - start;
    console.log('callEcnuApi: response status=' + res.status + ' time=' + ms + 'ms');
    const text = await res.text();
    if (!res.ok) {
      console.log('callEcnuApi: error body=' + text.substring(0, 500));
      throw new Error(`${res.status} ${res.statusText}: ${text.substring(0, 200)}`);
    }
    return JSON.parse(text);
  } catch (e) {
    clearTimeout(timeout);
    const ms = Date.now() - start;
    if (e.name === 'AbortError') {
      console.log('callEcnuApi: TIMEOUT after ' + ms + 'ms');
      throw new Error('AI响应超时（超过5分钟），可能是内容过长或网络慢。请减少资料后重试。');
    }
    console.log('callEcnuApi: fetch error after ' + ms + 'ms - ' + e.message);
    throw e;
  }
}

async function extractText(filePath, ext) {
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return { type: 'text', content: '' };
  }
  if (['txt', 'md'].includes(ext)) {
    return { type: 'text', content: fs.readFileSync(filePath, 'utf-8') };
  }
  if (ext === 'pdf') {
    try {
      const pdf = require('pdf-parse');
      const raw = fs.readFileSync(filePath);
      const data = await pdf(raw);
      console.log('PDF parse: pages=' + data.numpages + ', textLen=' + (data.text ? data.text.length : 0));
      if (!data.text || data.text.trim().length === 0) {
        console.log('PDF parse warning: extracted text is empty (scanned PDF), skipping');
        return { type: 'text', content: '' };
      }
      return { type: 'text', content: data.text };
    } catch (e) {
      console.error('PDF parse error:', e.message);
      throw new Error('PDF解析失败: ' + e.message + '。请尝试转换为文字PDF后重新上传。');
    }
  }
  if (['docx'].includes(ext)) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return { type: 'text', content: result.value };
  }
  if (ext === 'doc') {
    return { type: 'text', content: '(旧版 .doc 格式不支持直接解析。请用 Word 另存为 .docx 格式后重新上传。)' };
  }
  if (['pptx'].includes(ext)) {
    try {
      const unzip = require('unzipper');
      const extracted = await unzip.Open.file(filePath);
      let text = '';
      for (const entry of extracted.files) {
        if (entry.path.match(/^ppt\/slides\/slideshow\d+\.xml$/)) {
          const xml = await entry.buffer().then(b => b.toString('utf-8'));
          const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
          if (matches) {
            matches.forEach(m => { text += m.replace(/<a:t[^>]*>|<\/a:t>/g, '') + '\n'; });
          }
        }
      }
      console.log('PPTX parse: textLen=' + text.length);
      return { type: 'text', content: text || '(PPTX文件中未提取到文字内容)' };
    } catch (e) {
      console.error('PPTX parse error:', e.message);
      return { type: 'text', content: '(PPTX解析失败: ' + e.message + ')' };
    }
  }
  return { type: 'unknown' };
}

module.exports = function (app) {
  app.post('/api/v1/ai/upload', requireAuth, upload.array('files', 10), async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) return res.status(422).json({ error: '未上传文件' });
      const results = [];
      for (const file of req.files) {
        try {
          const ext = path.extname(file.originalname).slice(1).toLowerCase();
          const extracted = await extractText(file.path, ext);
          results.push({ name: file.originalname, ...extracted });
        } finally {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }
      }
      const text = results.filter(r => r.type === 'text').map(r => r.content).join('\n\n');
      res.json({ text, images: [], fileCount: results.length, items: results.map(r => ({ name: r.name, type: r.type })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/v1/ai/generate', requireAuth, async (req, res) => {
    try {
      const apiKey = req.headers['x-ai-api-key'];
      const model = req.headers['x-ai-model'] || 'ecnu-plus';
      const { textContent, typeCounts, prompt, chapterHistory } = req.body;
      const useStream = req.headers['x-ai-stream'] === 'true';
      const useStrictFormat = req.headers['x-ai-strict-format'] !== 'false';
      console.log('AI generate: model='+model+', apiKey='+((apiKey||'').substring(0,10)+'...'), 'textContentLen='+(textContent?.length||0), 'stream='+useStream, 'strictFormat='+useStrictFormat, 'typeCounts=', JSON.stringify(typeCounts));
      if (!apiKey || apiKey.length < 10) {
        return res.status(401).json({ error: '缺少 AI API Key，请在设置中配置' });
      }
      const tc = typeCounts || { single: 10, judge: 5, term: 2, short: 1 };
      const safeTc = tc;
      if ((safeTc.single || 0) + (safeTc.judge || 0) + (safeTc.term || 0) + (safeTc.short || 0) === 0) {
        safeTc.single = 1;
      }
      const systemPrompt = prompt || '你是一个出题助手。请根据提供的资料生成题目。\n重要：只输出JSON数组，不要包含任何其他文字、代码块标记或解释。';
      let userText = textContent || '请生成一些通用练习题';
      if (chapterHistory && chapterHistory.tagStats) {
        var tagEntries = Object.entries(chapterHistory.tagStats);
        if (tagEntries.length > 0) {
          var chTotalQ = chapterHistory.totalQuestions || 0;
          var progressLines = ['\n---\n【已有学习进度】已完成 ' + chTotalQ + ' 道题。'];
          progressLines.push('各知识点标签及考察情况：');
          tagEntries.forEach(function(e) {
            var ts = e[1];
            progressLines.push('- ' + e[0] + ': 出过' + ts.total + '题，对' + ts.correct + '错' + ts.wrong);
          });
          if (chapterHistory.topWrongTags && chapterHistory.topWrongTags.length > 0) {
            progressLines.push('');
            progressLines.push('薄弱知识点（错题最多）：' + chapterHistory.topWrongTags.slice(0, 5).join('、'));
          }
          progressLines.push('');
          progressLines.push('要求：');
          progressLines.push('1. 对于已有知识点标签，请出同知识点但不同问法、不同场景的变式题');
          progressLines.push('2. 对于已有标签中已掌握的内容（错题少），出少量巩固题即可');
          progressLines.push('3. 对于已有标签中出题少的（少于3题），请补充出题');
          progressLines.push('4. 对于资料中未覆盖的新知识点，请创建新标签并出题');
          progressLines.push('5. 为每道题标注 tag 时，如果知识点与已有标签相似，请归入已有标签；如果是全新知识点，请创建新标签');
          userText += progressLines.join('\n');
        }
      }
      let content = userText;
      const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content }];
      const totalQ = safeTc.single + safeTc.judge + safeTc.term + safeTc.short;
      const jsonSchema = { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' }, tag: { type: 'string' }, explanation: { type: 'string' } }, required: ['type', 'question', 'explanation'] } };

      // 动态计算 max_tokens
      var baseTokens = Math.max(4096, Math.ceil((typeof content === 'string' ? content.length : 0) / 2) * 3);
      var perQuestionTokens = 300;
      var neededTokens = baseTokens + totalQ * perQuestionTokens;
      var maxTokens = Math.min(16384, Math.max(4096, neededTokens));

      if (useStream) {
        const start = Date.now();
        console.log('callEcnuApi: streaming to', ECNU_BASE + '/chat/completions', 'model=' + model, 'contentLen=' + (typeof content === 'string' ? content.length : 0));
        var streamBody = { model, messages, stream: true, temperature: 0.7, max_tokens: maxTokens };
        // 流式输出不使用 json_schema（会阻止 token 逐步释放），靠 prompt 约束输出格式
        const streamAborter = new AbortController();
        var accumulatedQuestions = [];
        const streamRes = await fetch(ECNU_BASE + '/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify(streamBody),
          signal: streamAborter.signal
        });
        console.log('callEcnuApi: stream response status=' + streamRes.status);
        if (!streamRes.ok) {
          const errText = await streamRes.text();
          return res.status(500).json({ error: streamRes.status + ' ' + errText.substring(0, 200) });
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        let fullContent = '';
        let deltaCount = 0;
        let lastParsedLength = 0;
        const decoder = new TextDecoder();
        const reader = streamRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  fullContent += delta;
                  deltaCount++;
                  // 每收到 5 个 delta 就尝试提取已闭合的完整对象
                  // 用正则逐层截取 + JSON.parse 验证，不要求整体 JSON 有效
                  if (deltaCount % 5 === 0) {
                    const cleaned = fullContent.trim();
                    const newQs = tryExtractCompletedObjects(cleaned, lastParsedLength);
                    if (newQs && newQs.length > 0) {
                      lastParsedLength += newQs.length;
                      accumulatedQuestions = accumulatedQuestions.concat(newQs);
                      if (lastParsedLength >= totalQ) {
                        streamAborter.abort();
                        var doneQs = accumulatedQuestions.slice(0, totalQ);
                        res.write('data: ' + JSON.stringify({ done: true, questions: doneQs, usage: {} }) + "\n\n");
                        res.end();
                        return;
                      }
                      res.write('data: ' + JSON.stringify({ content: delta, newParsed: newQs, parsedCount: lastParsedLength }) + '\n\n');
                      continue;
                    }
                  }
                  res.write('data: ' + JSON.stringify({ content: delta, full: fullContent }) + '\n\n');
                }
              } catch {}
            }
          }
        }
        const elapsed = Date.now() - start;
        var finalClean = fullContent.trim();
        finalClean = finalClean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        // 提取 JSON 数组 [...]，忽略 AI 末尾可能添加的解释文字
        var jsonMatch = finalClean.match(/\[[\s\S]*\]/);
        if (jsonMatch) finalClean = jsonMatch[0];
        while (finalClean.trimEnd().endsWith(',')) finalClean = finalClean.trimEnd().slice(0, -1);
        try {
          var questions = JSON.parse(finalClean);
          if (!Array.isArray(questions)) questions = [questions];
          res.write('data: ' + JSON.stringify({ done: true, questions, usage: {} }) + '\n\n');
          res.end();
        } catch {
          if (!finalClean.endsWith(']')) finalClean += ']';
          try {
            questions = JSON.parse(finalClean);
            if (Array.isArray(questions)) {
              res.write('data: ' + JSON.stringify({ done: true, questions, usage: {} }) + '\n\n');
              res.end();
            } else throw new Error();
          } catch {
            res.write('data: ' + JSON.stringify({ done: true, error: 'JSON\u89e3\u6790\u5931\u8d25', raw: fullContent }) + '\n\n');
            res.end();
          }
        }
      } else {
        const opts = { temperature: 0.7, max_tokens: maxTokens };
        // json_schema 仅 ecnu-plus 和 ecnu-turbo 支持，ecnu-max 不支持
        if (useStrictFormat && (model === 'ecnu-plus' || model === 'ecnu-turbo')) {
          opts.response_format = { type: 'json_schema', json_schema: { name: 'questions', schema: jsonSchema } };
        }
        const completion = await callEcnuApi(apiKey, model, messages, opts);
        const output = completion.choices[0].message.content;
        let questions;
        try { questions = JSON.parse(output); } catch { questions = [output]; }
        await pool.query('INSERT INTO ai_request_log (user_id, model, status) VALUES ($1, $2, $3)', [req.userId, model, 'ok']);
        res.json({ questions, usage: completion.usage });
      }
    } catch (e) {
      console.error('AI generate error:', e.message, 'statusCode:', e?.status, 'code:', e?.code);
      if (!res.headersSent) res.status(500).json({ error: e.message, status: e?.status });
      else console.error('AI generate error after headers sent:', e.message);
    }
  });

  app.post('/api/v1/ai/analyze', requireAuth, async (req, res) => {
    res.status(501).json({ error: '功能开发中' });
  });
};


// 辅助函数：从流式累积文本中提取已闭合的完整题目对象
// 不要求整体 JSON 有效，逐个提取 {完整闭合对象} 并校验
function tryExtractCompletedObjects(text, knownCount) {
  var cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // 逐字符扫描，找到完整闭合的 {...} 并尝试解析
  var result = [];
  var depth = 0;
  var start = -1;
  for (var i = 0; i < cleaned.length; i++) {
    var ch = cleaned[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        var candidate = cleaned.substring(start, i + 1);
        try {
          var obj = JSON.parse(candidate);
          if (obj && obj.question && typeof obj.question === 'string') {
            // 去重（基于 question 文本避免重复计数）
            var isDup = result.some(function(r) { return r.question === obj.question; });
            if (!isDup) result.push(obj);
          }
        } catch(e) {}
        start = -1;
      }
    }
  }
  if (result.length > knownCount) return result.slice(knownCount);
  return null;
}
