'use strict';

// 一次性清理脚本（v3.27）：
// 删除 ai.routes.js 中三个旧解析函数（normalizeQuestions/repairJson/tryExtractCompletedObjects）
// 在 return aiQuestionParser.* 之后遗留的不可达代码。
// 运行：node scripts/cleanup_ai_routes.js
// 运行后请执行 node --check src/routes/ai.routes.js 和 npm test。

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'src', 'routes', 'ai.routes.js');
let source = fs.readFileSync(target, 'utf8');
const originalLength = source.length;

function replaceDeadBody(functionRegex, nextMarkerRegex) {
  const startMatch = functionRegex.exec(source);
  if (!startMatch) {
    throw new Error('未找到函数起点: ' + functionRegex);
  }

  const bodyStart = startMatch.index + startMatch[0].length;
  const nextMatch = nextMarkerRegex.exec(source.slice(bodyStart));
  if (!nextMatch) {
    throw new Error('未找到下一个标记: ' + nextMarkerRegex);
  }

  const bodyEnd = bodyStart + nextMatch.index;
  source = source.slice(0, bodyStart) + '\n}\n' + source.slice(bodyEnd);
}

function replaceDeadBodyToEnd(functionRegex) {
  const startMatch = functionRegex.exec(source);
  if (!startMatch) {
    throw new Error('未找到函数起点: ' + functionRegex);
  }

  const bodyStart = startMatch.index + startMatch[0].length;
  source = source.slice(0, bodyStart) + '\n}\n';
}

replaceDeadBody(
  /function normalizeQuestions\(raw\) \{\s*return aiQuestionParser\.normalizeQuestions\(raw\);/,
  /\/\/ Helper: repair common DeepSeek JSON syntax errors before parse/
);

replaceDeadBody(
  /function repairJson\(text\) \{\s*return aiQuestionParser\.repairJson\(text\);/,
  /\/\/ Helper: extract completed JSON objects from streaming accumulated text/
);

replaceDeadBodyToEnd(
  /function tryExtractCompletedObjects\(text, knownCount\) \{\s*return aiQuestionParser\.tryExtractCompletedObjects\(text, knownCount\);/
);

fs.writeFileSync(target, source, 'utf8');
console.log(
  '[cleanup] ai.routes.js 已瘦身:',
  originalLength,
  '→',
  source.length,
  '字符'
);
