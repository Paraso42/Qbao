const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getProvider, getProviderByModel, getAllProviders } = require('../providers');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

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
  // List available providers and models
  app.get('/api/v1/ai/providers', function(req, res) {
    try {
      var providers = getAllProviders();
      // Also add backward-compatible model listing
      var allModels = [];
      providers.forEach(function(p) {
        p.models.forEach(function(m) {
          allModels.push(m.id);
        });
      });
      res.json({ providers: providers, models: allModels });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

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
      const providerName = req.headers['x-ai-provider'] || getProviderByModel(model);
      const { textContent, typeCounts, prompt, chapterHistory } = req.body;
      const useStream = req.headers['x-ai-stream'] === 'true';
      const useStrictFormat = req.headers['x-ai-strict-format'] !== 'false';

      const provider = getProvider(providerName);
      console.log('AI generate: provider=' + providerName + ', model=' + model +
        ', apiKey=' + ((apiKey || '').substring(0, 10) + '...') +
        ', textContentLen=' + (textContent ? textContent.length : 0) +
        ', stream=' + useStream + ', strictFormat=' + useStrictFormat +
        ', typeCounts=', JSON.stringify(typeCounts));

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
      const jsonSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answer: { type: 'integer' },
            tag: { type: 'string' },
            explanation: { type: 'string' }
          },
          required: ['type', 'question', 'explanation']
        }
      };

      // Dynamic max_tokens calculation
      var baseTokens = Math.max(4096, Math.ceil((typeof content === 'string' ? content.length : 0) / 2) * 3);
      var perQuestionTokens = 300;
      var neededTokens = baseTokens + totalQ * perQuestionTokens;
      var maxTokens = Math.min(16384, Math.max(4096, neededTokens));

      if (useStream) {
        const streamAborter = new AbortController();
        var accumulatedQuestions = [];
        var lastParsedLength = 0;
        var finalFullContent = '';
        var streamDone = false;
        var streamError = null;

        // Build options: only use response_format when provider supports streaming + structured output
        var streamOpts = { temperature: 0.7, max_tokens: maxTokens };
        if (useStrictFormat) {
          if (provider.supportsStreamWithJsonSchema && provider.supportsStreamWithJsonSchema(model)) {
            if (provider.supportsJsonSchema && provider.supportsJsonSchema(model)) {
              streamOpts.response_format = { type: 'json_schema', json_schema: { name: 'questions', schema: jsonSchema } };
            } else {
              streamOpts.response_format = { type: 'json_object' };
            }
          }
        }

        // Set up SSE response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        try {
          var result = await provider.streamChatCompletions(apiKey, model, messages, streamOpts, function(evt) {
            finalFullContent = evt.full;
            if (evt.deltaCount % 5 === 0) {
              var cleaned = evt.full.trim();
              var newQs = tryExtractCompletedObjects(cleaned, lastParsedLength);
              if (newQs && newQs.length > 0) {
                lastParsedLength += newQs.length;
                accumulatedQuestions = accumulatedQuestions.concat(newQs);
                if (lastParsedLength >= totalQ) {
                  streamAborter.abort();
                  streamDone = true;
                }
                try {
                  res.write('data: ' + JSON.stringify({ content: evt.content, newParsed: newQs, parsedCount: lastParsedLength }) + '\n\n');
                } catch (e) { /* connection closed */ }
                return;
              }
            }
            try {
              res.write('data: ' + JSON.stringify({ content: evt.content, full: evt.full }) + '\n\n');
            } catch (e) { /* connection closed */ }
          }, streamAborter.signal);

          finalFullContent = result.content || finalFullContent;
        } catch (e) {
          streamError = e;
          if (!res.headersSent) {
            return res.status(500).json({ error: e.message });
          }
          console.error('Stream error:', e.message);
        }

        if (streamDone) return;

        // Parse final output
        var finalClean = finalFullContent.trim();
        finalClean = finalClean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        var jsonMatch = finalClean.match(/\[[\s\S]*\]/);
        if (jsonMatch) finalClean = jsonMatch[0];
        while (finalClean.trimEnd().endsWith(',')) finalClean = finalClean.trimEnd().slice(0, -1);

        try {
          var questions = JSON.parse(finalClean);
          if (!Array.isArray(questions)) questions = [questions];
          res.write('data: ' + JSON.stringify({ done: true, questions: questions, usage: {} }) + '\n\n');
          res.end();
        } catch (e) {
          if (!finalClean.endsWith(']')) finalClean += ']';
          try {
            questions = JSON.parse(finalClean);
            if (Array.isArray(questions)) {
              res.write('data: ' + JSON.stringify({ done: true, questions: questions, usage: {} }) + '\n\n');
              res.end();
            } else throw new Error();
          } catch (e2) {
            res.write('data: ' + JSON.stringify({ done: true, error: 'JSON解析失败', raw: finalFullContent }) + '\n\n');
            res.end();
          }
        }
      } else {
        // Non-streaming path
        const opts = { temperature: 0.7, max_tokens: maxTokens };
        if (useStrictFormat) {
          if (provider.supportsJsonSchema && provider.supportsJsonSchema(model)) {
            opts.response_format = { type: 'json_schema', json_schema: { name: 'questions', schema: jsonSchema } };
          } else {
            // Fallback: use json_object if provider supports it but not json_schema
            // For Gemini, no response_format at all — rely on prompt
            if (providerName !== 'gemini') {
              opts.response_format = { type: 'json_object' };
            }
          }
        }

        const completion = await provider.chatCompletions(apiKey, model, messages, opts);
        const output = completion.choices[0].message.content;
        let questions;
        try { questions = JSON.parse(output); } catch (e) { questions = [output]; }

        await pool.query(
          'INSERT INTO ai_request_log (user_id, model, status) VALUES ($1, $2, $3)',
          [req.userId, model, 'ok']
        );
        res.json({ questions: questions, usage: completion.usage });
      }
    } catch (e) {
      console.error('AI generate error:', e.message, 'statusCode:', e ? e.status : undefined, 'code:', e ? e.code : undefined);
      if (!res.headersSent) res.status(500).json({ error: e.message, status: e ? e.status : undefined });
      else console.error('AI generate error after headers sent:', e.message);
    }
  });

  app.post('/api/v1/ai/analyze', requireAuth, async (req, res) => {
    res.status(501).json({ error: '功能开发中' });
  });
};


// Helper: extract completed JSON objects from streaming accumulated text
// Does not require valid overall JSON — extracts individual {complete objects} and validates
function tryExtractCompletedObjects(text, knownCount) {
  var cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
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
            var isDup = result.some(function(r) { return r.question === obj.question; });
            if (!isDup) result.push(obj);
          }
        } catch (e) { /* skip malformed object */ }
        start = -1;
      }
    }
  }
  if (result.length > knownCount) return result.slice(knownCount);
  return null;
}
