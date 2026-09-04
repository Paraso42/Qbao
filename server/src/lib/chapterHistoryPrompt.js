'use strict';

// 已有学习进度段落（v3.34.0 提取）：
// /api/v1/ai/generate 与后台任务队列（aiTaskService）共用同一提示词上下文，
// 保证两条出题路径对"已出题/薄弱知识点"的感知一致。

// 生成"已有学习进度"段落（无 tagStats 时返回空串）
function buildChapterHistoryPrompt(chapterHistory) {
  if (!chapterHistory || !chapterHistory.tagStats) return '';
  const tagEntries = Object.entries(chapterHistory.tagStats);
  if (tagEntries.length === 0) return '';

  const lines = ['\n---\n', '【已有学习进度】已完成 ' + (chapterHistory.totalQuestions || 0) + ' 道题。'];
  lines.push('各知识点标签及考察情况：');
  tagEntries.forEach(function (e) {
    const ts = e[1];
    lines.push('- ' + e[0] + ': 出过' + ts.total + '题，对' + ts.correct + '错' + ts.wrong);
  });
  if (chapterHistory.topWrongTags && chapterHistory.topWrongTags.length > 0) {
    lines.push('');
    lines.push('薄弱知识点（错题最多）：' + chapterHistory.topWrongTags.slice(0, 5).join('、'));
  }
  lines.push('');
  lines.push('要求：');
  lines.push('- 对于已有知识点标签，请出同知识点但不同问法、不同场景的变式题');
  lines.push('- 对于已有标签中已掌握的内容（错题少），出少量巩固题即可');
  lines.push('- 对于已有标签中出题少的（少于3题），请补充出题');
  lines.push('- 对于资料中未覆盖的新知识点，请创建新标签并出题');
  lines.push('- 为每道题标注 tag 时，如果知识点与已有标签相似，请归入已有标签；如果是全新知识点，请创建新标签');
  lines.push('- 不得输出与资料示例或此前已出题目雷同的题，同知识点请变换问法、场景或数值');
  lines.push('- 输出顺序必须严格按照：单选题(single) → 判断题(judge) → 名词解释(term) → 简答题(short)。同题型内部按知识点分组排列');
  return lines.join('\n');
}

module.exports = { buildChapterHistoryPrompt };
