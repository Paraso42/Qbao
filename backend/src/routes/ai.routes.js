const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getProvider, getProviderByModel, getAllProviders } = require('../providers');

const uploadDir = path.join(__dirname, '../../uploads');
const POOL_BASE = path.join(__dirname, '../../../uploads'); // shared file pool root
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

// Pre-check document parsing dependencies
var mammothAvailable = false;
try { require('mammoth'); mammothAvailable = true; } catch(e) {
  console.error('CRITICAL: mammoth package not installed. DOCX files will fail to extract.');
}
var pdfParseAvailable = false;
try { require('pdf-parse'); pdfParseAvailable = true; } catch(e) {
  console.error('CRITICAL: pdf-parse package not installed. PDF files will fail to extract.');
}
var unzipperAvailable = false;
try { require('unzipper'); unzipperAvailable = true; } catch(e) {
  console.error('CRITICAL: unzipper package not installed. PPTX files will fail to extract.');
}

async function extractText(filePath, ext) {
  // Image files — return empty with diagnostic info
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return { type: 'text', content: '', extracted: true, empty: true };
  }
  // Plain text files
  if (['txt', 'md'].includes(ext)) {
    var txtContent = fs.readFileSync(filePath, 'utf-8');
    return { type: 'text', content: txtContent, extracted: true, empty: !txtContent.trim() };
  }
  // PDF
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
  // DOCX
  if (['docx'].includes(ext)) {
    if (!mammothAvailable) {
      return { type: 'text', content: '', extracted: false, error: 'mammoth 包未安装' };
    }
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      var dEmpty = !result.value || !result.value.trim();
      return { type: 'text', content: result.value || '', extracted: true, empty: dEmpty,
        warning: dEmpty ? 'DOCX文件未提取到文字内容' : undefined };
    } catch (e) {
      return { type: 'text', content: '', extracted: false, error: 'DOCX解析失败: ' + e.message };
    }
  }
  // DOC (old format, not supported)
  if (ext === 'doc') {
    return { type: 'text', content: '', extracted: false, error: '旧版.doc格式不支持，请转换为.docx后重新上传' };
  }
  // PPTX
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
          const xml = await entry.buffer().then(b => b.toString('utf-8'));
          const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
          if (matches) {
            matches.forEach(m => { text += m.replace(/<a:t[^>]*>|<\/a:t>/g, '') + '\n'; });
          }
        }
      }
      var pEmpty = !text.trim();
      return { type: 'text', content: text || '', extracted: true, empty: pEmpty,
        warning: pEmpty ? 'PPTX文件未提取到文字内容' : undefined };
    } catch (e) {
      return { type: 'text', content: '', extracted: false, error: 'PPTX解析失败: ' + e.message };
    }
  }
  // Unknown type
  return { type: 'unknown', extracted: false, error: '不支持的文件类型: .' + ext };
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
      const { textContent, typeCounts, prompt, chapterHistory, chapterId } = req.body;
      const useStream = req.headers['x-ai-stream'] === 'true';

      const provider = getProvider(providerName);
      console.log('AI generate: provider=' + providerName + ', model=' + model +
        ', apiKey=' + ((apiKey || '').substring(0, 10) + '...') +
        ', textContentLen=' + (textContent ? textContent.length : 0) +
        ', stream=' + useStream +
        ', typeCounts=', JSON.stringify(typeCounts) + ', chapterId=' + (chapterId || 'none'));

      if (!apiKey || apiKey.length < 10) {
        return res.status(401).json({ error: '缺少 AI API Key，请在设置中配置' });
      }

      const tc = typeCounts || { single: 10, judge: 5, term: 2, short: 1 };
      const safeTc = tc;
      if ((safeTc.single || 0) + (safeTc.judge || 0) + (safeTc.term || 0) + (safeTc.short || 0) === 0) {
        safeTc.single = 1;
      }
      const systemPrompt = prompt || '你是一个出题助手。请根据提供的资料生成考试题目。\n\n重要规则：\n1. 只输出纯JSON数组，不要包含任何其他文字、代码块标记或解释\n2. 每道题必须包含字段：type(值为single/judge/term/short)、question、options(数组)、answer(数字索引)、tag、strategy(值为error/review/new)、explanation\n3. 单选题(single)：options为4个选项的数组，answer为0-3的索引\n4. 判断题(judge)：options为["正确","错误"]，answer为0或1\n5. 名词解释(term)和简答题(short)：不需要options和answer\n6. 输出顺序：单选题→判断题→名词解释→简答题';
      let userText = textContent || '';

      // If chapterId provided, read assigned pool files from disk
      var poolTexts = [];
      var poolFilesStatus = [];
      if (chapterId) {
        try {
          var fileResult = await pool.query(
            'SELECT * FROM user_files WHERE user_id = $1 AND chapter_id = $2',
            [req.userId, chapterId]
          );
          for (var fi = 0; fi < fileResult.rows.length; fi++) {
            var frow = fileResult.rows[fi];
            var statusEntry = { name: frow.original_name, found: false, extracted: false, empty: false, error: null, warning: null };
            var absPath = path.join(POOL_BASE, frow.file_path);
            if (fs.existsSync(absPath)) {
              statusEntry.found = true;
              try {
                var ext = path.extname(frow.original_name).slice(1).toLowerCase();
                var extracted = await extractText(absPath, ext);
                statusEntry.extracted = extracted.extracted;
                statusEntry.empty = extracted.empty;
                statusEntry.error = extracted.error || null;
                statusEntry.warning = extracted.warning || null;
                if (extracted && extracted.type === 'text' && extracted.content && extracted.content.trim()) {
                  poolTexts.push('--- 文件：' + frow.original_name + ' ---\n' + extracted.content);
                  statusEntry.contentLength = extracted.content.length;
                } else if (extracted.warning) {
                  console.warn('Pool file extraction warning: ' + frow.original_name + ' — ' + extracted.warning);
                }
              } catch (ex) {
                statusEntry.extracted = false;
                statusEntry.error = ex.message;
                console.warn('Failed to extract pool file: ' + frow.original_name + ' — ' + ex.message);
              }
            } else {
              statusEntry.error = 'File not found on disk';
              console.warn('Pool file not found: ' + frow.original_name + ' at ' + absPath);
            }
            poolFilesStatus.push(statusEntry);
          }
          if (poolTexts.length > 0) {
            userText = poolTexts.join('\n\n') + (userText ? '\n\n' + userText : '');
            console.log('AI generate: merged ' + poolTexts.length + ' pool files, total textLen=' + userText.length);
          } else if (poolFilesStatus.length > 0) {
            var failReasons = poolFilesStatus.map(function(s) {
              return s.name + ': ' + (s.error || (s.found ? 'empty content' : 'file missing'));
            }).join('; ');
            console.error('AI generate: ALL ' + poolFilesStatus.length + ' pool files failed extraction — ' + failReasons);
          }
        } catch (e2) {
          console.warn('Pool file reading failed:', e2.message);
        }
      }
      if (!userText) userText = '请生成一些通用练习题';

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
          progressLines.push('- 对于已有知识点标签，请出同知识点但不同问法、不同场景的变式题');
          progressLines.push('- 对于已有标签中已掌握的内容（错题少），出少量巩固题即可');
          progressLines.push('- 对于已有标签中出题少的（少于3题），请补充出题');
          progressLines.push('- 对于资料中未覆盖的新知识点，请创建新标签并出题');
          progressLines.push('- 为每道题标注 tag 时，如果知识点与已有标签相似，请归入已有标签；如果是全新知识点，请创建新标签');
          progressLines.push('- 输出顺序必须严格按照：单选题(single) → 判断题(judge) → 名词解释(term) → 简答题(short)。同题型内部按知识点分组排列');
          userText += progressLines.join('\n');
        }
      }

      const totalQ = safeTc.single + safeTc.judge + safeTc.term + safeTc.short;
      let content = userText;
      if (content.length > 128000) {
        content = content.substring(0, 128000);
        console.log('Content truncated to 128000 chars for model=' + model);
      }
      const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content }];
      const jsonSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['single', 'judge', 'term', 'short'] },
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answer: { type: 'integer' },
            tag: { type: 'string' },
            strategy: { type: 'string', enum: ['error', 'review', 'new'] },
            explanation: { type: 'string' }
          },
          required: ['type', 'question', 'tag', 'strategy', 'explanation']
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

        // Auto-select response_format based on provider capability
        var streamOpts = { temperature: 0.7, max_tokens: maxTokens };
        if (provider.supportsJsonSchema && provider.supportsJsonSchema(model)) {
          // ECNU/OpenAI: native json_schema in streaming
          streamOpts.response_format = { type: 'json_schema', json_schema: { name: 'questions', schema: jsonSchema } };
        } else if (providerName === 'deepseek') {
          // DeepSeek: json_object in streaming (streaming + json_object works well)
          streamOpts.response_format = { type: 'json_object' };
          messages[0].content += '\nRespond in JSON format.';
        }
        // Gemini: no response_format — prompt-only JSON enforcement

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
                  console.log('[stream] early abort: parsed=' + lastParsedLength + ' >= totalQ=' + totalQ + ', model=' + model);
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

        if (streamDone) {
          var typeDist = {};
          (accumulatedQuestions.slice(0, totalQ) || []).forEach(function(q) {
            typeDist[q.type || '?'] = (typeDist[q.type || '?'] || 0) + 1;
          });
          console.log('[stream] early done: model=' + model + ', questions=' + accumulatedQuestions.slice(0, totalQ).length + ', types=' + JSON.stringify(typeDist));
          try {
            res.write('data: ' + JSON.stringify({ done: true, questions: normalizeQuestions(accumulatedQuestions.slice(0, totalQ)), usage: {}, poolFilesStatus: poolFilesStatus }) + '\n\n');
            res.end();
          } catch(e) { /* connection already closed */ }
          return;
        }

        // Parse final output
        var finalClean = finalFullContent.trim();
        finalClean = finalClean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        var jsonMatch = finalClean.match(/\[[\s\S]*\]/);
        if (jsonMatch) finalClean = jsonMatch[0];
        while (finalClean.trimEnd().endsWith(',')) finalClean = finalClean.trimEnd().slice(0, -1);

        try {
          var questions = normalizeQuestions(JSON.parse(finalClean));
          var typeDist3 = {};
          (questions || []).forEach(function(q) { typeDist3[q.type || '?'] = (typeDist3[q.type || '?'] || 0) + 1; });
          console.log('[stream] final parse: model=' + model + ', questions=' + questions.length + ', types=' + JSON.stringify(typeDist3));
          res.write('data: ' + JSON.stringify({ done: true, questions: questions, usage: {}, poolFilesStatus: poolFilesStatus }) + '\n\n');
          res.end();
        } catch (e) {
          if (!finalClean.endsWith(']')) finalClean += ']';
          try {
            questions = normalizeQuestions(JSON.parse(finalClean));
            if (questions.length > 0) {
              res.write('data: ' + JSON.stringify({ done: true, questions: questions, usage: {}, poolFilesStatus: poolFilesStatus }) + '\n\n');
              res.end();
            } else throw new Error();
          } catch (e2) {
            res.write('data: ' + JSON.stringify({ done: true, error: 'JSON解析失败', raw: finalFullContent, poolFilesStatus: poolFilesStatus }) + '\n\n');
            res.end();
          }
        }
      } else {
        // Non-streaming path — auto-select response_format by provider capability
        const opts = { temperature: 0.7, max_tokens: maxTokens };
        if (provider.supportsJsonSchema && provider.supportsJsonSchema(model)) {
          // ECNU/OpenAI: native json_schema
          opts.response_format = { type: 'json_schema', json_schema: { name: 'questions', schema: jsonSchema } };
        } else if (providerName === 'deepseek') {
          // DeepSeek: json_object (requires "json" keyword in prompt)
          opts.response_format = { type: 'json_object' };
          messages[0].content += '\nRespond in JSON format.';
        }
        // Gemini: no response_format — prompt-only JSON enforcement

        const completion = await provider.chatCompletions(apiKey, model, messages, opts);
        const output = completion.choices[0].message.content;
        let questions;
        try { questions = JSON.parse(output); } catch (e) { questions = [output]; }
        questions = normalizeQuestions(questions);

        await pool.query(
          'INSERT INTO ai_request_log (user_id, model, status) VALUES ($1, $2, $3)',
          [req.userId, model, 'ok']
        );
        res.json({ questions: questions, usage: completion.usage, poolFilesStatus: poolFilesStatus });
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


// Helper: normalize questions from providers that don't support json_schema (e.g. DeepSeek)
// Handles various output formats: nested {multipleChoice: [...], trueFalse: [...]}
// options as object {A:..., B:...} → array [...], answer letter A/B → index 0/1
function normalizeQuestions(raw) {
  if (!raw) return [];
  // If plain object (not array), wrap for uniform processing
  var items = Array.isArray(raw) ? raw : [raw];
  // Flatten: if any item is a wrapper object with nested question arrays, extract them
  var flat = [];
  items.forEach(function(item) {
    if (item && typeof item === 'object' && !item.question) {
      var found = false;
      // Check for wrapper objects — handles camelCase, snake_case, and other variants
      ['multipleChoice', 'multiple_choice', 'multiplechoice', 'singleChoice', 'single_choice',
       'trueFalse', 'true_false', 'truefalse', 'questions', 'topics', 'items', 'results'].forEach(function(k) {
        if (Array.isArray(item[k])) {
          // For 'topics'/'items'/'results', check if contents look like questions (have 'question' field)
          var arr = item[k];
          if (arr.length > 0 && arr[0].question) {
            flat = flat.concat(arr); found = true;
          }
          // Only add if items have question field
        }
      });
      if (!found) flat.push(item); // Not a recognizable wrapper, keep as-is
    } else {
      flat.push(item);
    }
  });
  raw = flat;

  raw = raw.map(function(q) {
    if (!q || typeof q !== 'object') return null;
    // Must have a question field
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 3) return null;

    // Normalize options: object {A: "opt1", B: "opt2"} → array ["opt1", "opt2"]
    // Also strip "A: ", "B: " etc. prefix from array options if present
    if (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) {
      var keys = Object.keys(q.options).sort();
      q.options = keys.map(function(k) { return q.options[k]; });
    }
    if (!q.options || !Array.isArray(q.options)) {
      q.options = [];
    }
    // Strip "A: ", "B: " prefix from option strings
    q.options = q.options.map(function(opt) {
      if (typeof opt === 'string') return opt.replace(/^[A-D]:\s*/, '');
      return opt;
    });

    // Normalize answer: letter "A"/"B"/"C"/"D" → index 0/1/2/3
    if (typeof q.answer === 'string' && q.answer.length === 1) {
      var code = q.answer.toUpperCase().charCodeAt(0);
      if (code >= 65 && code <= 90) {
        q.answer = code - 65;
      } else if (q.answer === '对' || q.answer === '√' || q.answer.toLowerCase() === 'true') {
        q.answer = 0; q.type = q.type || 'judge';
      } else if (q.answer === '错' || q.answer === '×' || q.answer.toLowerCase() === 'false') {
        q.answer = 1; q.type = q.type || 'judge';
      }
    }
    if (typeof q.answer === 'boolean') {
      q.answer = q.answer ? 0 : 1;
      q.type = q.type || 'judge';
    }

    // Normalize type variants
    if (q.type) {
      var t = q.type.toLowerCase().replace(/[-_\s]/g, '');
      if (t === 'singlechoice' || t === 'multiplechoice' || t === 'choice' || t === 'multichoice') q.type = 'single';
      else if (t === 'truefalse' || t === 'bool' || t === 'boolean') q.type = 'judge';
      else if (t === 'term' || t === 'definition' || t === 'explain') q.type = 'term';
      else if (t === 'short' || t === 'shortanswer' || t === 'essay') q.type = 'short';
      if (['single', 'judge', 'term', 'short'].indexOf(q.type) === -1) {
        q.type = (q.options && q.options.length >= 2) ? 'single' : 'short';
      }
    } else {
      q.type = (q.options && q.options.length >= 2) ? 'single' : 'short';
    }

    // Ensure required fields
    if (!q.tag) q.tag = 'default';
    if (!q.strategy) q.strategy = 'new';
    if (!q.explanation) q.explanation = '';

    return q;
  }).filter(Boolean); // Remove null entries (invalid questions)

  if (flat.length > 0 && raw.length === 0) {
    console.log('[normalize] All ' + flat.length + ' items filtered out — no valid question objects found');
  }
  return raw;
}

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
