function loadChapterStrategyToUI() {
  const ch = getCh(); const card = document.getElementById('chapter-prompt-card');
  if (!card) return;
  if (!ch) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  document.getElementById('ch-strategy-name').textContent = escapeHtml(ch.name);
  const s = getChStrategy(ch.id); if (!s) return;
  document.getElementById('tc-single').value = s.typeCounts.single || 10;
  document.getElementById('tc-judge').value = s.typeCounts.judge || 5;
  document.getElementById('tc-term').value = s.typeCounts.term || 1;
  document.getElementById('tc-short').value = s.typeCounts.short || 1;
  document.getElementById('s-err').value = s.errPct || 0;
  document.getElementById('s-review').value = (s.errPct || 0) + (s.reviewPct || 0);
  updateChapterDualSliderUI(s.errPct || 0, s.reviewPct || 0, s.newPct || 0);
  renderChapterTags(); updateChapterPromptTemplate(); applyAiModeUi();
}
function onChapterStrategyChange() { const ch = getCh(); if (!ch) return; const s = getChStrategy(ch.id); if (!s) return; s.typeCounts.single = parseInt(document.getElementById('tc-single').value) || 0; s.typeCounts.judge = parseInt(document.getElementById('tc-judge').value) || 0; s.typeCounts.term = parseInt(document.getElementById('tc-term').value) || 0; s.typeCounts.short = parseInt(document.getElementById('tc-short').value) || 0; saveState(); updateChapterPromptTemplate(); }
function onChapterDualSlider() {
  let v1 = parseInt(document.getElementById('s-err').value) || 0; let v2 = parseInt(document.getElementById('s-review').value) || 0;
  if (v1 > v2) { if (document.activeElement === document.getElementById('s-err')) { v2 = v1; document.getElementById('s-review').value = v2; } else { v1 = v2; document.getElementById('s-err').value = v1; } }
  const rPct = v2 - v1, nPct = 100 - v2;
  const ch = getCh(); if (ch) { const s = getChStrategy(ch.id); if (s) { s.errPct = v1; s.reviewPct = rPct; s.newPct = nPct; saveState(); } }
  updateChapterDualSliderUI(v1, rPct, nPct); updateChapterPromptTemplate();
}
function updateChapterDualSliderUI(err, rev, newP) { ['dv-err','sn-err'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = err; }); ['dv-review','sn-review'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = rev; }); ['dv-new','sn-new'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = newP; }); const fe = document.getElementById('fill-err'); if (fe) fe.style.width = err + '%'; const fr = document.getElementById('fill-review'); if (fr) { fr.style.width = rev + '%'; fr.style.left = err + '%'; } const fn = document.getElementById('fill-new'); if (fn) { fn.style.width = newP + '%'; fn.style.left = (err + rev) + '%'; }
}
function renderChapterTags() { const container = document.getElementById('tags-list-container'); if (!container) return; const ch = getCh(); if (!ch) { container.innerHTML = ''; return; } const s = getChStrategy(ch.id); const tags = s ? s.weakTags : []; if (!tags || tags.length === 0) { container.innerHTML = '<span style="color:#bbb;font-size:11px;">暂无标签。答题后错题标签自动添加。</span>'; return; } container.innerHTML = tags.map((t, i) => '<span class="' + (t.active ? 'tag-chip active' : 'tag-chip') + '" onclick="toggleChapterTag(' + i + ')">' + (t.active ? '✅ ' : '⬜ ') + escapeHtml(t.name) + '<span class="tag-remove" onclick="event.stopPropagation();removeChapterTag(' + i + ')">×</span></span>').join(''); }
function toggleChapterTag(idx) { const ch = getCh(); if (!ch) return; const s = getChStrategy(ch.id); if (!s || !s.weakTags[idx]) return; s.weakTags[idx].active = !s.weakTags[idx].active; saveState(); renderChapterTags(); updateChapterPromptTemplate(); }
function removeChapterTag(idx) { const ch = getCh(); if (!ch) return; const s = getChStrategy(ch.id); if (!s || !s.weakTags[idx]) return; s.weakTags.splice(idx, 1); saveState(); renderChapterTags(); updateChapterPromptTemplate(); }
function addManualTag() { const input = document.getElementById('tag-input'); const name = input.value.trim(); if (!name) return; const ch = getCh(); if (!ch) return; const s = getChStrategy(ch.id); if (!s) return; if (s.weakTags.some(t => t.name === name)) { input.value = ''; return; } s.weakTags.push({ name, active: true }); input.value = ''; saveState(); renderChapterTags(); updateChapterPromptTemplate(); }
function syncTagsFromWrongAnswers() { const ch = getCh(); if (!ch || !ch.questions) { alert('当前章节无数据'); return; } const s = getChStrategy(ch.id); if (!s) return; const newTags = new Set(); ch.questions.forEach((q, i) => { if (isObjType(q.type) && ch.userAnswers[i] !== undefined && getCi(q, ch.userAnswers[i]) === false && q.tag) newTags.add(q.tag); }); if (newTags.size === 0) { alert('无客观题错题标签可同步'); return; } let added = 0; newTags.forEach(tag => { if (!s.weakTags.some(t => t.name === tag)) { s.weakTags.push({ name: tag, active: true }); added++; } }); saveState(); renderChapterTags(); updateChapterPromptTemplate(); alert('✅ 已添加 ' + added + ' 个标签'); }
function generatePromptText(chId) {
  const s = getChStrategy(chId); if (!s) return '';
  const single = s.typeCounts.single || 0, judge = s.typeCounts.judge || 0, term = s.typeCounts.term || 0, short = s.typeCounts.short || 0;
  const errPct = s.errPct || 0, reviewPct = s.reviewPct || 0, newPct = s.newPct || 0;
  let parts = []; if (single > 0) parts.push(single + ' 道单选题'); if (judge > 0) parts.push(judge + ' 道判断题'); if (term > 0) parts.push(term + ' 道名词解释题'); if (short > 0) parts.push(short + ' 道简答题');
  const qStr = parts.join('，') || '请自行决定题型与数量';
  const activeTags = (s.weakTags || []).filter(t => t.active).map(t => t.name);
  let tagLine7 = ''; if (errPct > 0 && activeTags.length > 0) tagLine7 = '\n7. 【薄弱点重点出题】请重点针对以下知识点标签出题：' + activeTags.join('、') + '。确保这些知识点在题目中得到充分覆盖。';
  // 列出所有已有 tag，帮助 AI 做归类（传统模式和 AI 模式都受益）
  var allTags = (s.weakTags || []).map(function(t) { return t.name; });
  var existingTagLine = '';
  if (allTags.length > 0) {
    existingTagLine = '\n\n【已有知识点标签】' + allTags.join('、') + '\n如果题目知识点与以上已有标签相似，请优先使用已有标签名称；如果是全新知识点，再创建新标签。';
  }
  var formatNote = '重要：只输出JSON数组，不要包含任何其他文字、代码块标记或解释。\n';
      return formatNote + '请基于我提供的学习资料，生成新一轮复习题目。\n要求：\n1. 题型与数量：' + qStr + '。\n2. 内容来源：必须严格基于提供的资料。\n3. 格式要求：只输出纯文本的 JSON 数组。不要包含 markdown 代码块标记（```）或其他任何非JSON文字。\n4. JSON 字段结构：\n- 所有题目必须包含：id, type（值为 "single", "judge", "term", "short"）, tag（知识点标签）, question, explanation（标准答案/解析）。\n- 单选题（single）：增加 options（数组）, answer（数字索引 0-3）。\n- 判断题（judge）：增加 options（固定为 ["正确", "错误"]）, answer（数字索引 0 或 1）。\n- 名词解释（term）和简答题（short）：不需要 options 和 answer 字段，explanation 字段存放标准参考答案。\n5. 出题策略：' + errPct + '% 针对错题，' + reviewPct + '% 滚动复习，' + newPct + '% 新考点。\n6. 请在 explanation 中标注来源。' + tagLine7 + '\n7. 请为每道题标注其所属的知识点标签（tag 字段），标签名称应简洁、一致。例如："三角函数"、"牛顿定律"、"文艺复兴"等。' + existingTagLine;
}
function updateChapterPromptTemplate() {
  const ch = getCh(); if (!ch) return;
  const el = document.getElementById('prompt-text');
  if (el) el.textContent = generatePromptText(ch.id);
}
function selectPrompt() { const el = document.getElementById('prompt-text'); if (!el) return; const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
function updateQuickActions() {
  const ch = getCh(); const container = document.getElementById('chapter-quick-actions');
  if (!container) return;
  if (!ch) { container.style.display = 'none'; return; }
  document.getElementById('chapter-quick-title').textContent = '📖 当前：' + escapeHtml(ch.name);
  // 检测当前章节是否有正在运行的流式任务
  var runningStreamTask = (state.aiTaskQueue || []).find(function(t) {
    return t.chapterId === ch.id && t.status === 'running';
  });
  var streamSc = runningStreamTask ? (runningStreamTask.streamQuestionCount || 0) : 0;
  var threshold = state.aiConfig ? (state.aiConfig.streamThreshold || 3) : 3;

  // 流式注入中：以 streamQuestionCount 为准，>= threshold 才显示按钮
  if (runningStreamTask) {
    var totalQ = Math.max(streamSc, (runningStreamTask.streamSetRef ? runningStreamTask.streamSetRef.questions.length : 0));
    var answered = runningStreamTask.streamSetRef
      ? runningStreamTask.streamSetRef.userAnswers.filter(function(a) { return a !== undefined; }).length
      : 0;
    document.getElementById('chapter-quick-info').textContent = '共 ' + totalQ + ' 题，已答 ' + answered + ' 题 (注入中...)';
    if (streamSc >= threshold) {
      document.getElementById('btn-continue-quiz').style.display = 'inline-block';
    } else {
      document.getElementById('btn-continue-quiz').style.display = 'none';
    }
    container.style.display = 'block';
    return;
  }

  const sets = ch.quizSets || [];
  if (sets.length > 0) {
    const qs = getCurrentQuizSet();
    var totalQ = qs ? qs.questions.length : 0;
    var answered = qs ? qs.userAnswers.filter(function(a) { return a !== undefined; }).length : 0;
    document.getElementById('chapter-quick-info').textContent = '共 ' + totalQ + ' 题，已答 ' + answered + ' 题';
    if (answered >= totalQ) {
      document.getElementById('btn-continue-quiz').style.display = 'none';
    } else {
      document.getElementById('btn-continue-quiz').style.display = 'inline-block';
    }
    container.style.display = 'block';
  } else {
    document.getElementById('chapter-quick-info').textContent = '暂无题目，请先导入或 AI 出题';
    document.getElementById('btn-continue-quiz').style.display = 'none';
    container.style.display = 'block';
  }
}
function openImportDialog() { document.getElementById('import-error-box').classList.remove('active'); document.getElementById('import-textarea').value = ''; document.getElementById('import-dialog').classList.add('active'); }
function closeImportDialog() { document.getElementById('import-dialog').classList.remove('active'); }
function confirmImport() {
  const text = document.getElementById('import-textarea').value.trim(); const errBox = document.getElementById('import-error-box');
  try {
    if (!text) throw new Error('请输入 JSON');
    // 兼容 Markdown 代码块包裹
    var cleanText = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```*$/, '').trim();
    var data = JSON.parse(cleanText);
    if (!Array.isArray(data)) throw new Error('JSON 必须是数组');
    data.forEach((item, i) => {
      if (!item.type || !item.question) throw new Error('第' + (i + 1) + '题缺 type 或 question');
      if (!['single', 'judge', 'term', 'short'].includes(item.type)) throw new Error('第' + (i + 1) + '题 type 无效');
      if ((item.type === 'single' || item.type === 'judge') && (!Array.isArray(item.options) || !item.options.length)) throw new Error('第' + (i + 1) + '题缺 options');
    });
    // 过滤空题目，补 id
    data = data.filter(function(q) { return q.question && q.question.trim().length > 2; });
    data.forEach(function(q, i) { if (!q.id) q.id = i + 1; });
    if (data.length === 0) throw new Error('没有有效的题目');
    const ch = getCh(); if (!ch) throw new Error('请先选择章节');
    createQuizSet(data); saveState(); renderSubjectList(); updateQuickActions(); closeImportDialog();
    alert('✅ 已导入 ' + data.length + ' 道题目');
  }
  catch(e) { errBox.classList.add('active'); document.getElementById('import-error-text').textContent = '❌ ' + e.message; }
}
function copyImportError() { navigator.clipboard.writeText(document.getElementById('import-error-text').textContent); }