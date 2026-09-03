const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getProvider, getProviderByModel, getAllProviders } = require('../providers');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const { aiGenerateBodySchema, aiTestBodySchema, aiExplainBodySchema } = require('../schemas/ai.schema');
const { parseAiHeaders, resolveAiTarget, normalizeTypeCounts, calculateMaxTokens } = require('../lib/aiRequest');
const { getCachedOrExtractFileText } = require('../services/aiMaterialCache');
const { validateQuestionSet } = require('../services/aiQuestionValidator');
const { finalizeAiQuestions } = require('../services/aiQuestionFinalizer');
const { assertChapterCanGenerate } = require('../services/chapterSessionGuard');
const { cleanupExpiredFiles } = require('../services/filePoolService');
const { loadPoolTextForChapter } = require('../lib/poolText');
const pointsService = require('../services/pointsService');
const { aiQuestionSchema } = require('../lib/aiQuestionSchema');
const aiQuestionParser = require('../services/aiQuestionParser');

// T6：AI 出题「成功计费」——仅当一次生成真正产出题目并返回成功时才扣费。
// 失败/取消/解析失败路径不扣费；扣费 DB 瞬时错误仅记日志，不阻塞结果返回
//（每日低峰 reconcileAll 以台账为准兜底）。
async function chargeGenerateSuccess(userId) {
  try {
    await pointsService.checkAndChargeAiQuota(pool, userId, 'generate');
  } catch (e) {
    console.warn('[points] charge on success failed:', e.message);
  }
}

// AI 请求审计：所有路径都记录 status，失败也不影响主流程。
async function logAiRequest(userId, model, status) {
  try {
    await pool.query(
      'INSERT INTO ai_request_log (user_id, model, status) VALUES ($1, $2, $3)',
      [userId, model, status]
    );
  } catch (e) {
    console.warn('[ai-audit] log failed:', e.message);
  }
}

// T16: 上传根目录统一为仓库级 uploads/（与 chat/issues/pool/avatars 一致）
const uploadDir = path.join(__dirname, '../../../uploads');
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
  // T15: 统一错误层（原裸 try/catch 回显 e.message，泄露内部细节）
  app.get('/api/v1/ai/providers', asyncHandler(async (req, res) => {
    const providers = getAllProviders();
    // Also add backward-compatible model listing
    const allModels = [];
    providers.forEach(function (p) {
      p.models.forEach(function (m) { allModels.push(m.id); });
    });
    res.json({ providers, models: allModels });
  }));

  // T15: 统一错误层 — 积分不足→400、multer 类型白名单→422、其余→通用 500（不泄内部细节）
  app.post('/api/v1/ai/upload', requireAuth, upload.array('files', 10), asyncHandler(async (req, res) => {
    // 积分配额：每日免费解析次数内不扣分；超出后按次预扣（失败不阻塞上传主流程）
    let quotaError = null;
    try {
      await pointsService.checkAndChargeAiQuota(pool, req.userId, 'upload').catch((e) => {
        if (e instanceof ApiError) throw e;
        console.warn('[points] ai upload quota check failed:', e.message);
      });
    } catch (e) {
      quotaError = e;
    }
    if (quotaError) {
      // P0.8：配额/校验抛错时清理 multer 已落盘文件，防磁盘残留（此前会遗留文件）
      if (req.files && req.files.length) {
        for (const f of req.files) {
          try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) { /* 忽略单个清理失败 */ }
        }
      }
      throw quotaError;
    }

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
    // 配额计数（model='upload' 计入 ai_request_log，供每日免费额度核算）
    logAiRequest(req.userId, 'upload', 'ok').catch(() => {});
    res.json({ text, images: [], fileCount: results.length, items: results.map(r => ({ name: r.name, type: r.type })) });
  }));

  app.post('/api/v1/ai/generate', validate({ body: aiGenerateBodySchema }), requireAuth, async (req, res) => {
    try {
      const parsed = parseAiHeaders(req); const target = resolveAiTarget(parsed.providerName, parsed.model); const apiKey = parsed.apiKey;
      const model = target.model;
        req.aiModel = model;
      const providerName = target.providerConfig.id;
      const { textContent, typeCounts, prompt, chapterHistory, chapterId, selfCheck } = req.body;
      const useStream = parsed.useStream;

      // T6：积分配额改为「成功计费」——生成成功出口（本文件各 'ok' 路径）统一调用
      // chargeGenerateSuccess()；失败/取消/解析失败不扣费。
      // 章节未完成规则校验（与任务队列一致）：仍有未做完的题目不允许继续出题（409）
      await assertChapterCanGenerate(req.userId, chapterId || null);

      const provider = target.provider;
        await logAiRequest(req.userId, model, 'started');
      console.log('AI generate: provider=' + providerName + ', model=' + model +
        '' +
        ', textContentLen=' + (textContent ? textContent.length : 0) +
        ', stream=' + useStream +
        ', typeCounts=', JSON.stringify(typeCounts) + ', chapterId=' + (chapterId || 'none'));

      if (!apiKey || apiKey.length < 10) {
        return res.status(401).json({ error: '缺少 AI API Key，请在设置中配置' });
      }

      const tcSpec = normalizeTypeCounts(typeCounts);
      const safeTc = tcSpec.counts;
      if ((safeTc.single || 0) + (safeTc.judge || 0) + (safeTc.term || 0) + (safeTc.short || 0) === 0) {
        safeTc.single = 1;
      }
      const systemPrompt = prompt || '你是一个出题助手。请根据提供的资料生成考试题目。\n\n重要规则：\n1. 只输出纯JSON数组，不要包含任何其他文字、代码块标记或解释\n2. 每道题必须包含字段：type(值为single/judge/term/short)、question、options(数组)、answer(数字索引)、tag、strategy(值为error/review/new)、explanation\n3. 单选题(single)：options为4个选项的数组，answer为0-3的索引\n4. 判断题(judge)：options为["正确","错误"]，answer为0或1\n5. 名词解释(term)和简答题(short)：不需要options和answer\n6. 输出顺序：单选题→判断题→名词解释→简答题\n7. LaTeX公式格式：题目中含有数学符号、上下标、分式、根号、积分、求和等内容时，必须使用\$...\$包裹行内公式（如\$x_1\$、\$E=mc^2\$），使用\$\$...\$\$包裹独立公式块（如\$\$\\sum_{i=1}^{n} x_i\$\$）';
let userText = textContent || '';

      // 章节分配的文件池资料：与后台任务队列共用同一读取逻辑（多章节关联表）
      const poolRes = await loadPoolTextForChapter(req.userId, chapterId || null, userText);
      userText = poolRes.text;
      const poolFilesStatus = poolRes.poolFilesStatus;
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
      const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content }];

      // DeepSeek json_object mode: concise format instruction
      if (providerName === 'deepseek') {
        messages[0].content += '\n\n输出格式：必须输出一个合法的JSON对象 {\"questions\": [...]}，不要输出纯数组或其他格式。';
      }

      const jsonSchema = aiQuestionSchema;

      // Dynamic max_tokens calculation
      var baseTokens = Math.max(4096, Math.ceil((typeof userText === 'string' ? userText.length : 0) / 2) * 3);
      var perQuestionTokens = 300;
      var neededTokens = baseTokens + totalQ * perQuestionTokens;
      var maxTokens = Math.min(16384, Math.max(4096, neededTokens));
        // v3.27: max_tokens 以 provider/model 目录的 maxOutput 为上限，防止过量消耗。
        maxTokens = calculateMaxTokens(
          typeof userText === 'string' ? userText.length : 0,
          totalQ,
          target.providerConfig,
          target.modelConfig
        );

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
        }
        // Gemini: no response_format — prompt-only JSON enforcement

        // Set up SSE response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // 客户端断连检测：连接关闭且在正常结束前 → 中止上游流，避免继续消耗
        // （修复"短线/退出后服务端仍生成 10~18s"问题；正常 res.end() 后由 writableEnded 守卫忽略）
        var clientClosed = false;
        var onResClose = function () {
          if (res.writableEnded || streamDone) return;
          clientClosed = true;
          streamAborter.abort();
        };
        res.on('close', onResClose);

        try {
          // 流式提前终止条件：每种题型配额均已满足时即可停止；否则最多流式到安全上限，
          // 避免单/判断题的过量产出把名词解释、简答题截断（修复"5:5:3:2 实际 9:6:0:0"）。
          var safetyCap = Math.max(totalQ * 2, 40);
          var result = await provider.streamChatCompletions(apiKey, model, messages, streamOpts, function(evt) {
            finalFullContent = evt.full;
            if (evt.deltaCount % 2 === 0) {
              var cleaned = evt.full.trim();
              var newQs = tryExtractCompletedObjects(cleaned, lastParsedLength);
              if (newQs && newQs.length > 0) {
                lastParsedLength += newQs.length;
                accumulatedQuestions = accumulatedQuestions.concat(newQs);
                if (lastParsedLength >= safetyCap || typeQuotaSatisfied(accumulatedQuestions, safeTc)) {
                  console.log('[stream] early abort: parsed=' + lastParsedLength + ' totalQ=' + totalQ + ' safetyCap=' + safetyCap + ', types=' + JSON.stringify(countTypes(accumulatedQuestions)) + ', model=' + model);
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
          if (clientClosed) {
            // 客户端已断开：立即停止，不再解析/落库，审计记为 cancelled
            await logAiRequest(req.userId, model, 'cancelled');
            console.log('[stream] client disconnected, stream aborted: model=' + model);
            res.removeListener('close', onResClose);
            return;
          }
          console.error('Stream error:', e.message);
        }

        if (streamDone) {
          var typeDist = countTypes(accumulatedQuestions);
          console.log('[stream] early done: model=' + model + ', questions=' + accumulatedQuestions.length + ', types=' + JSON.stringify(typeDist));
            await logAiRequest(req.userId, model, 'ok');
          try {
            const finalized = await finalizeAiQuestions({ selfCheck, provider, apiKey, model, modelConfig: target.modelConfig, sourceText: userText, rawQuestions: accumulatedQuestions, typeCounts: safeTc, signal: streamAborter.signal });
              res.write('data: ' + JSON.stringify({ done: true, questions: finalized.questions, validation: finalized.baseValidation, selfCheck: finalized.selfCheck, topUp: finalized.topUp, typeShortfall: finalized.typeShortfall, usage: {}, poolFilesStatus: poolFilesStatus }) + '\n\n');
            res.end();
          } catch(e) { /* connection already closed */ }
          res.removeListener('close', onResClose);
          return;
        }

        // Parse final output
        var finalClean = finalFullContent.trim();
        finalClean = finalClean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        var jsonMatch = finalClean.match(/\[[\s\S]*\]/);
        if (jsonMatch) finalClean = jsonMatch[0];
        while (finalClean.trimEnd().endsWith(',')) finalClean = finalClean.trimEnd().slice(0, -1);

        try {
          var questions = normalizeQuestions(JSON.parse(repairJson(finalClean)));
            var finalizedFinal = await finalizeAiQuestions({ selfCheck, provider, apiKey, model, modelConfig: target.modelConfig, sourceText: userText, rawQuestions: questions, typeCounts: safeTc, signal: streamAborter.signal }); questions = finalizedFinal.questions; var streamValidation = finalizedFinal.baseValidation; var streamShortfall = finalizedFinal.typeShortfall;
          var typeDist3 = {};
          (questions || []).forEach(function(q) { typeDist3[q.type || '?'] = (typeDist3[q.type || '?'] || 0) + 1; });
          console.log('[stream] final parse: model=' + model + ', questions=' + questions.length + ', types=' + JSON.stringify(typeDist3));
            await logAiRequest(req.userId, model, 'ok');
        await chargeGenerateSuccess(req.userId);
            res.write('data: ' + JSON.stringify({ done: true, questions: questions, validation: streamValidation, selfCheck: finalizedFinal.selfCheck, topUp: finalizedFinal.topUp, typeShortfall: streamShortfall, usage: {}, poolFilesStatus: poolFilesStatus }) + '\n\n');
            res.end();
            res.removeListener('close', onResClose);
            return;
        } catch (e) {
          if (!finalClean.endsWith(']')) finalClean += ']';
          try {
            questions = normalizeQuestions(JSON.parse(repairJson(finalClean)));
            if (questions.length > 0) {
              res.write('data: ' + JSON.stringify({ done: true, questions: questions, usage: {}, poolFilesStatus: poolFilesStatus }) + '\n\n');
              res.end();
              res.removeListener('close', onResClose);
            } else throw new Error();
          } catch (e2) {
            // Fallback: extract individual complete objects from partially malformed JSON
            var extracted = tryExtractCompletedObjects(finalFullContent, 0);
            if (extracted && extracted.length > 0) {
              var finalizedFallback = await finalizeAiQuestions({ selfCheck, provider, apiKey, model, modelConfig: target.modelConfig, sourceText: userText, rawQuestions: extracted, typeCounts: safeTc, signal: streamAborter.signal }); questions = finalizedFallback.questions; var fallbackValidation = finalizedFallback.baseValidation; var fallbackShortfall = finalizedFallback.typeShortfall;
              console.log('[stream] fallback extract: model=' + model + ', questions=' + questions.length);
                await logAiRequest(req.userId, model, 'ok');
                res.write('data: ' + JSON.stringify({ done: true, questions: questions, validation: fallbackValidation, selfCheck: finalizedFallback.selfCheck, typeShortfall: fallbackShortfall, usage: {}, poolFilesStatus: poolFilesStatus }) + '\n\n');
                res.end();
                res.removeListener('close', onResClose);
                return;
            } else {
              // JSON 解析失败/0 题 → 纠正性重试（≤2 次非流式），仍失败才报错（发现 A 兜底）
              var retried = await retryNonStreamJson({
                provider, apiKey, model, providerName, systemPrompt, userText,
                typeCounts: safeTc, jsonSchema, maxTokens,
                signal: streamAborter.signal, lastRaw: finalFullContent,
              });
              if (retried && retried.length > 0) {
                var finalizedRetry = await finalizeAiQuestions({ selfCheck, provider, apiKey, model, modelConfig: target.modelConfig, sourceText: userText, rawQuestions: retried, typeCounts: safeTc, signal: streamAborter.signal });
                console.log('[stream] json retry ok: model=' + model + ', questions=' + finalizedRetry.questions.length);
                await logAiRequest(req.userId, model, 'ok');
                res.write('data: ' + JSON.stringify({ done: true, questions: finalizedRetry.questions, validation: finalizedRetry.baseValidation, selfCheck: finalizedRetry.selfCheck, typeShortfall: finalizedRetry.typeShortfall, usage: {}, poolFilesStatus: poolFilesStatus }) + '\n\n');
                res.end();
                res.removeListener('close', onResClose);
                return;
              }
              await logAiRequest(req.userId, model, 'parse_error');
              res.write('data: ' + JSON.stringify({ done: true, error: 'JSON解析失败', raw: finalFullContent, poolFilesStatus: poolFilesStatus }) + '\n\n');
              res.end();
              res.removeListener('close', onResClose);
            }
          }
        }
      } else {
        // Non-streaming path — auto-select response_format by provider capability
        const opts = { temperature: 0.7, max_tokens: maxTokens };
        if (provider.supportsJsonSchema && provider.supportsJsonSchema(model)) {
          // ECNU/OpenAI: native json_schema
          opts.response_format = { type: 'json_schema', json_schema: { name: 'questions', schema: jsonSchema } };
        } else if (providerName === 'deepseek') {
          // DeepSeek: json_object
          opts.response_format = { type: 'json_object' };
        }
        // Gemini: no response_format — prompt-only JSON enforcement

        const completion = await provider.chatCompletions(apiKey, model, messages, opts);
        const output = completion.choices[0].message.content;
        let parsedRaw = null;
        try { parsedRaw = normalizeQuestions(JSON.parse(output)); } catch (e) { parsedRaw = []; }
        let questions;
        if (parsedRaw.length > 0) {
          questions = parsedRaw;
        } else {
          // 0 题/非 JSON → 纠正性重试（≤2 次），仍失败则原样走 finalize 兜底
          const retried = await retryNonStreamJson({
            provider, apiKey, model, providerName, systemPrompt, userText,
            typeCounts: safeTc, jsonSchema, maxTokens,
            signal: undefined, lastRaw: output,
          });
          questions = (retried && retried.length > 0) ? retried : parsedRaw;
        }
        const finalized = await finalizeAiQuestions({ selfCheck, provider, apiKey, model, modelConfig: target.modelConfig, sourceText: userText, rawQuestions: questions, typeCounts: safeTc }); questions = finalized.questions; const validation = finalized.baseValidation;

        await pool.query(
          'INSERT INTO ai_request_log (user_id, model, status) VALUES ($1, $2, $3)',
          [req.userId, model, 'ok']
        );
        await chargeGenerateSuccess(req.userId);
        res.json({ questions: questions, usage: completion.usage, poolFilesStatus: poolFilesStatus, validation: validation, selfCheck: finalized.selfCheck, typeShortfall: finalized.typeShortfall });
      }
    } catch (e) {
        if (req.aiModel) { await logAiRequest(req.userId, req.aiModel, 'error'); }
        if (e instanceof ApiError) {
          if (!res.headersSent) return res.status(e.status).json({ error: e.message });
          console.error('AI generate ApiError after headers sent:', e.status, e.message);
          return;
        }
        console.error('AI generate error:', e.message, 'statusCode:', e ? e.status : undefined, 'code:', e ? e.code : undefined);
        if (!res.headersSent) return res.status(500).json({ error: '服务器内部错误' });
        console.error('AI generate error after headers sent:', e.message);
        return;
    }
  });

    // POST /api/v1/ai/test — 最小化连接测试，不生成题目、不污染业务日志语义。
    app.post('/api/v1/ai/test', validate({ body: aiTestBodySchema }), requireAuth, asyncHandler(async (req, res) => {
      const parsed = parseAiHeaders(req);
      const target = resolveAiTarget(parsed.providerName, parsed.model);

      const startedAt = Date.now();
      const testMessages = [
        { role: 'system', content: 'You are a connectivity test assistant. Reply with exactly: OK' },
        { role: 'user', content: (req.body && req.body.message) || 'ping' },
      ];

      let completion;
        try {
          completion = await target.provider.chatCompletions(
        parsed.apiKey,
        target.model,
        testMessages,
        { temperature: 0, max_tokens: Math.min(16, Number(target.modelConfig.maxOutput) || 16) }
      );
        } catch (e) {
          throw new ApiError(502, 'AI 连接测试失败：' + (e && e.message ? e.message : '未知错误'));
        }

      const content = completion && completion.choices && completion.choices[0]
        ? completion.choices[0].message && completion.choices[0].message.content
        : '';

      await pool.query(
        'INSERT INTO ai_request_log (user_id, model, status) VALUES ($1, $2, $3)',
        [req.userId, target.model, 'test_ok']
      );

      res.json({
        ok: true,
        provider: target.providerConfig.id,
        model: target.model,
        latencyMs: Date.now() - startedAt,
        content: typeof content === 'string' ? content.slice(0, 200) : '',
      });
    }));

  // —— P3.1 错题 AI 讲解（非流式；成功才计费；额度沿用 AI 生成机制） ——
  app.post('/api/v1/ai/explain', validate({ body: aiExplainBodySchema }), requireAuth, asyncHandler(async (req, res) => {
    const parsed = parseAiHeaders(req);
    const target = resolveAiTarget(parsed.providerName, parsed.model);
    const model = target.model;
    const { question, userAnswer, context } = req.body;

    const typeLabel = ({ single: '单选题', judge: '判断题', term: '名词解释', short: '简答题' })[question.type] || question.type || '题目';
    const stdAnswer = (() => {
      if ((question.type === 'single' || question.type === 'judge') && typeof question.answer === 'number' && Array.isArray(question.options) && question.options[question.answer] !== undefined) {
        return String.fromCharCode(65 + question.answer) + '. ' + question.options[question.answer];
      }
      return String(question.answer == null ? '' : question.answer);
    })();
    const qText = '题目：' + question.question
      + (Array.isArray(question.options) && question.options.length ? '\n选项：\n' + question.options.map((o, i) => '  ' + String.fromCharCode(65 + i) + '. ' + o).join('\n') : '')
      + '\n标准答案：' + stdAnswer
      + (question.explanation ? '\n题干自带解析：' + question.explanation : '');
    const answered = (userAnswer === null || userAnswer === undefined || userAnswer === '');
    const userLine = answered
      ? '（用户未作答）'
      : ('用户的作答：' + ((typeof userAnswer === 'number' && Array.isArray(question.options) && question.options[userAnswer] !== undefined)
          ? String.fromCharCode(65 + userAnswer) + '. ' + question.options[userAnswer] : String(userAnswer)));

    const systemPrompt =
      '你是一名经验丰富的' + typeLabel + '讲解老师。请用简体中文讲解下面这道' + typeLabel + '，要求：\n'
      + '1. 先判断用户答案是否正确（用户未作答则跳过判断）；\n'
      + '2. 分步骤讲解解题思路与关键知识点，重点说明为什么标准答案是对的；\n'
      + '3. 若用户答错，明确指出错在哪一步、常见误区是什么；\n'
      + '4. 结尾给一句同类题型的易错提醒。\n'
      + '输出为 Markdown 文本（公式可用 $...$ 或 $$...$$），不要输出 JSON。';
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: qText + '\n' + userLine + (context ? '\n背景资料（可选参考）：' + String(context).slice(0, 2000) : '') },
    ];

    await logAiRequest(req.userId, model, 'started');
    let completion;
    try {
      completion = await target.provider.chatCompletions(
        parsed.apiKey,
        model,
        messages,
        { temperature: 0.3, max_tokens: Math.min(2000, Number(target.modelConfig.maxOutput) || 2000) }
      );
    } catch (e) {
      await logAiRequest(req.userId, model, 'failed');
      throw new ApiError(502, '讲解生成失败：' + (e && e.message ? e.message : '未知错误'));
    }
    const content = completion && completion.choices && completion.choices[0]
      ? (completion.choices[0].message && completion.choices[0].message.content) || ''
      : '';
    if (!content || !content.trim()) {
      await logAiRequest(req.userId, model, 'failed');
      throw new ApiError(502, 'AI 未返回讲解内容，请重试');
    }
    // 成功计费（与生成共享 AI 免费额度/超额扣分语义）
    await logAiRequest(req.userId, model, 'ok');
    await chargeGenerateSuccess(req.userId);
    res.json({ explanation: content.trim(), provider: target.providerConfig.id, model });
  }));
};


// Helper: normalize questions from providers that don't support json_schema (e.g. DeepSeek)
// Handles various output formats: nested {multipleChoice: [...], trueFalse: [...]}
// options as object {A:..., B:...} → array [...], answer letter A/B → index 0/1
function normalizeQuestions(raw) {
  return aiQuestionParser.normalizeQuestions(raw);
}
// Helper: repair common DeepSeek JSON syntax errors before parse
function repairJson(text) {
  return aiQuestionParser.repairJson(text);
}
// Helper: extract completed JSON objects from streaming accumulated text
// JSON state machine — tracks both {} and [] nesting, handles json_object wrapper
function tryExtractCompletedObjects(text, knownCount) {
  return aiQuestionParser.tryExtractCompletedObjects(text, knownCount);
}

// 纠正性重试（发现 A 兜底）：流式/非流式 JSON 解析失败或 0 题时，
// 携带上次无效输出用非流式方式重试 ≤2 次；成功返回题目数组，失败返回 null。
const JSON_RETRY_MAX = 2;
async function retryNonStreamJson({ provider, apiKey, model, providerName, systemPrompt, userText, typeCounts, jsonSchema, maxTokens, signal, lastRaw }) {
  for (let attempt = 1; attempt <= JSON_RETRY_MAX; attempt++) {
    if (signal && signal.aborted) return null;
    const correction =
      '\n\n重要：你上次返回了无效JSON，错误是：' + String(lastRaw || '').slice(0, 500) +
      '。请修正后重新输出纯JSON数组，不要包含任何其他文字、代码块标记或解释。';
    const retryMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText + correction },
    ];
    const retryOpts = { temperature: 0.7, max_tokens: maxTokens, signal };
    if (provider.supportsJsonSchema && provider.supportsJsonSchema(model)) {
      retryOpts.response_format = { type: 'json_schema', json_schema: { name: 'questions', schema: jsonSchema } };
    } else if (providerName === 'deepseek') {
      retryOpts.response_format = { type: 'json_object' };
    }
    try {
      const completion = await provider.chatCompletions(apiKey, model, retryMessages, retryOpts);
      const out = completion.choices[0].message.content;
      let cleaned = String(out || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) cleaned = jsonMatch[0];
      const parsed = normalizeQuestions(JSON.parse(repairJson(cleaned)));
      if (parsed.length > 0) {
        console.log('[stream] json retry ok (attempt=' + attempt + '), questions=' + parsed.length);
        return parsed;
      }
      lastRaw = out;
    } catch (retryErr) {
      if (signal && signal.aborted) return null;
      console.warn('[stream] json retry failed (attempt=' + attempt + '): ' + retryErr.message);
      lastRaw = retryErr.message;
    }
  }
  return null;
}

// Helper: count produced questions by type (for logging / early-abort decisions)
function countTypes(questions) {
  const dist = {};
  (questions || []).forEach((q) => {
    dist[q && q.type ? q.type : '?'] = (dist[q && q.type ? q.type : '?'] || 0) + 1;
  });
  return dist;
}

// Helper: 每种题型的配额是否都已满足（用于流式提前终止判断）
function typeQuotaSatisfied(questions, safeTc) {
  const need = {
    single: (safeTc && safeTc.single) || 0,
    judge: (safeTc && safeTc.judge) || 0,
    term: (safeTc && safeTc.term) || 0,
    short: (safeTc && safeTc.short) || 0,
  };
  const have = { single: 0, judge: 0, term: 0, short: 0 };
  (questions || []).forEach((q) => {
    if (q && q.type && have[q.type] !== undefined) have[q.type]++;
  });
  if (need.single > 0 && have.single < need.single) return false;
  if (need.judge > 0 && have.judge < need.judge) return false;
  if (need.term > 0 && have.term < need.term) return false;
  if (need.short > 0 && have.short < need.short) return false;
  return true;
}