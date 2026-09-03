// AI 出题诊断脚本 — 测试 ECNU 流式/非流式 + response_format 组合
// 用法: node server/scripts/diagnose_ai.js <api_key> [model]
//   或: ECNU_API_KEY=xxx node server/scripts/diagnose_ai.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API_KEY = process.argv[2] || process.env.ECNU_API_KEY || '';
const MODEL = process.argv[3] || 'ecnu-plus';

if (!API_KEY || API_KEY.length < 10 || API_KEY === 'your_ecnu_api_key_here') {
  console.error('用法: node diagnose_ai.js <api_key> [model]');
  console.error('  api_key: ECNU API Key (至少10字符)');
  console.error('  model: 模型ID, 默认 ecnu-plus');
  process.exit(1);
}

const ecnu = require('../src/providers/ecnu');

const SYSTEM_PROMPT = '你是一个出题助手。请根据提供的资料生成题目。重要：只输出JSON数组，不要包含任何其他文字、代码块标记或解释。';
const USER_TEXT = '请出3道关于计算机网络的单选题。要求：\n1. 每题4个选项\n2. 覆盖TCP/UDP、HTTP、DNS三个知识点\n3. 题目有难度区分';

const JSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string' },
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

const MESSAGES = [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: USER_TEXT }
];

// 复制自 ai.routes.js — 增量 JSON 提取
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
        } catch (e) { /* skip malformed */ }
        start = -1;
      }
    }
  }
  if (result.length > knownCount) return result.slice(knownCount);
  return null;
}

function tryParseQuestions(text) {
  var clean = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // 尝试1: 直接 JSON.parse
  try {
    var q = JSON.parse(clean);
    if (Array.isArray(q)) return { questions: q, method: 'JSON.parse' };
    if (q && typeof q === 'object') return { questions: [q], method: 'JSON.parse(single)' };
  } catch (e) { /* continue */ }

  // 尝试2: 正则提取 JSON 数组
  var m = clean.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      var q2 = JSON.parse(m[0]);
      if (Array.isArray(q2)) return { questions: q2, method: 'regex+JSON.parse' };
    } catch (e) { /* continue */ }
  }

  // 尝试3: tryExtractCompletedObjects
  var q3 = tryExtractCompletedObjects(clean, 0);
  if (q3 && q3.length > 0) return { questions: q3, method: 'tryExtractCompletedObjects' };

  return { questions: null, method: 'FAILED' };
}

async function runDiagnostics() {
  console.log('='.repeat(72));
  console.log('AI 出题诊断 — Provider: ECNU | Model:', MODEL);
  console.log('API Key:', API_KEY.substring(0, 12) + '...');
  console.log('Prompt:', USER_TEXT.substring(0, 60) + '...');
  console.log('='.repeat(72));

  const tests = [
    { id: 1, stream: false, format: 'json_schema', label: '非流式 + json_schema  ✅ v3.11.12 当前路径' },
    { id: 2, stream: false, format: 'json_object', label: '非流式 + json_object  (回退方案)' },
    { id: 3, stream: false, format: 'none',       label: '非流式 + 无 format   (裸调用)' },
    { id: 4, stream: true,  format: 'none',       label: '流式   + 无 format   ❌ v3.12.0 路径' },
    { id: 5, stream: true,  format: 'json_object',label: '流式   + json_object  🔧 修复方案A' },
    { id: 6, stream: true,  format: 'json_schema',label: '流式   + json_schema 🔧 修复方案B' },
  ];

  var summary = [];

  for (var t = 0; t < tests.length; t++) {
    var test = tests[t];
    console.log('\n' + '-'.repeat(72));
    console.log('[Test ' + test.id + '/6] ' + test.label);
    console.log('  配置: stream=' + test.stream + ', format=' + test.format);

    var result = { id: test.id, label: test.label, status: '?', questions: 0, timeMs: 0, method: '', error: null, firstChars: '' };

    try {
      var opts = { temperature: 0.7, max_tokens: 4096 };
      if (test.format === 'json_schema') {
        opts.response_format = { type: 'json_schema', json_schema: { name: 'questions', schema: JSON_SCHEMA } };
      } else if (test.format === 'json_object') {
        opts.response_format = { type: 'json_object' };
      }

      var start = Date.now();

      if (test.stream) {
        // ===== 流式路径 =====
        var fullContent = '';
        var lastExtracted = 0;
        var midQuestions = null;

        var streamResult = await ecnu.streamChatCompletions(
          API_KEY, MODEL, MESSAGES, opts,
          function(evt) {
            fullContent = evt.full;
            if (evt.deltaCount % 3 === 0) {
              var nq = tryExtractCompletedObjects(evt.full, lastExtracted);
              if (nq && nq.length > 0) {
                lastExtracted += nq.length;
                midQuestions = nq;
              }
            }
          }
        );

        result.timeMs = Date.now() - start;
        console.log('  HTTP 200 | 输出长度:', fullContent.length, '| 耗时:', result.timeMs + 'ms');
        console.log('  流式增量提取:', lastExtracted > 0 ? lastExtracted + ' 题' : '无');

        // 最终解析
        var parsed = tryParseQuestions(fullContent);
        if (parsed.questions && parsed.questions.length > 0) {
          result.status = 'OK';
          result.questions = parsed.questions.length;
          result.method = 'stream+' + parsed.method;
          console.log('  ✅ 最终解析成功:', parsed.questions.length, '题 (', parsed.method, ')');
          console.log('  示例:', JSON.stringify(parsed.questions[0]).substring(0, 120));
        } else {
          // 尝试用中间提取的结果
          if (midQuestions && midQuestions.length > 0) {
            result.status = 'OK (mid only)';
            result.questions = midQuestions.length;
            result.method = 'stream mid-extraction';
            console.log('  ⚠️ 最终解析失败，但流式中途提取到', midQuestions.length, '题');
          } else {
            result.status = 'ZERO';
            result.error = '最终解析0题';
            console.log('  ❌ 0 题! 输出前200字:', fullContent.substring(0, 200));
          }
        }
        result.firstChars = fullContent.substring(0, 80);

      } else {
        // ===== 非流式路径 =====
        var completion = await ecnu.chatCompletions(API_KEY, MODEL, MESSAGES, opts);
        result.timeMs = Date.now() - start;

        var output = completion.choices[0].message.content;
        console.log('  HTTP 200 | 输出长度:', output.length, '| 耗时:', result.timeMs + 'ms');

        var parsed2 = tryParseQuestions(output);
        if (parsed2.questions && parsed2.questions.length > 0) {
          result.status = 'OK';
          result.questions = parsed2.questions.length;
          result.method = parsed2.method;
          console.log('  ✅ 成功:', parsed2.questions.length, '题 (', parsed2.method, ')');
          console.log('  示例:', JSON.stringify(parsed2.questions[0]).substring(0, 120));
        } else {
          result.status = 'ZERO';
          result.error = '无法解析为JSON数组';
          console.log('  ❌ 解析失败! 输出前200字:', output.substring(0, 200));
        }
        result.firstChars = output.substring(0, 80);
      }
    } catch (e) {
      result.timeMs = 0;
      result.status = 'ERROR';
      result.error = e.message.substring(0, 150);
      console.log('  ❌ 请求异常:', result.error);
    }

    summary.push(result);
  }

  // ===== 汇总 =====
  console.log('\n\n' + '='.repeat(72));
  console.log('诊断汇总');
  console.log('='.repeat(72));
  console.log(
    pad('ID', 3) + ' ' +
    pad('状态', 14) + ' ' +
    pad('题目', 5) + ' ' +
    pad('耗时', 8) + ' ' +
    '说明'
  );
  console.log('-'.repeat(72));

  summary.forEach(function(r) {
    var statusIcon = r.status === 'OK' ? '✅' : (r.status.startsWith('OK') ? '⚠️' : '❌');
    console.log(
      pad(String(r.id), 3) + ' ' +
      pad(statusIcon + ' ' + r.status, 14) + ' ' +
      pad(String(r.questions), 5) + ' ' +
      pad(r.timeMs ? (r.timeMs + 'ms') : 'N/A', 8) + ' ' +
      (r.error || r.method || '')
    );
  });

  console.log('\n结论分析:');
  var okTests = summary.filter(function(r) { return r.status === 'OK' && r.questions >= 2; });
  var zeroTests = summary.filter(function(r) { return r.status === 'ZERO'; });
  var errTests = summary.filter(function(r) { return r.status === 'ERROR'; });

  console.log('  成功 (>=2题):', okTests.length + '/6 —', okTests.map(function(r) { return '#' + r.id; }).join(', '));
  console.log('  0题:', zeroTests.length + '/6 —', zeroTests.map(function(r) { return '#' + r.id; }).join(', '));
  console.log('  异常:', errTests.length + '/6 —', errTests.map(function(r) { return '#' + r.id; }).join(', '));

  if (zeroTests.length > 0) {
    console.log('\n💡 建议:');
    var hasStreamNone = zeroTests.some(function(r) { return r.id === 4; });
    var hasStreamJsonObj = summary.some(function(r) { return r.id === 5 && r.status === 'OK' && r.questions >= 2; });
    var hasStreamJsonSchema = summary.some(function(r) { return r.id === 6 && r.status === 'OK' && r.questions >= 2; });

    if (hasStreamNone && hasStreamJsonObj) {
      console.log('  → Test 4 (流式无format) 0题，Test 5 (流式+json_object) 成功');
      console.log('  → 修复: 前端 _aiStreamGenerate 的 x-ai-strict-format 从 false 改为 _shouldUseStrictFormat()');
    }
    if (hasStreamNone && hasStreamJsonSchema) {
      console.log('  → Test 4 (流式无format) 0题，Test 6 (流式+json_schema) 成功');
      console.log('  → 修复: 后端 ecnu.supportsStreamWithJsonSchema 改为 true，前端流式传 strict=true');
    }
    if (hasStreamNone && !hasStreamJsonObj && !hasStreamJsonSchema) {
      console.log('  → ECNU 流式完全不支持 format，需从 _shouldUseStreaming() 排除 ECNU');
    }
  }

  console.log('='.repeat(72));
}

function pad(s, len) {
  var str = String(s);
  while (str.length < len) str += ' ';
  return str;
}

runDiagnostics().catch(function(e) {
  console.error('Fatal:', e);
  process.exit(1);
});
