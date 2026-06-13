function numPickerStep(btn, delta) { var input = btn.parentElement.querySelector('.num-input'); var val = parseInt(input.value) || 0; val = Math.max(0, Math.min(50, val + delta)); input.value = val; input.dispatchEvent(new Event('change', { bubbles: true })); }
function numPickerClamp(input) { var val = parseInt(input.value); if (isNaN(val) || val < 0) input.value = 0; if (val > 50) input.value = 50; }
function initTypeCountPickers() { /* num-picker inputs are pre-initialized in HTML with defaults */ }
function loadChapterStrategyToUI() {
  const ch = getCh(); const card = document.getElementById('chapter-prompt-card');
  if (!card) return;
  var bar = document.getElementById('chapter-card-bottom-bar');
  if (!ch) { card.style.display = 'none'; if (bar) bar.style.display = 'none'; document.getElementById('main').style.paddingBottom = ''; return; }
  card.style.display = 'block';
  var guide2 = document.getElementById('start-empty-guide');
  if (guide2) guide2.style.display = 'none';
  if (bar && bar.style.display !== 'none') { positionCardBottomBar(); document.getElementById('main').style.paddingBottom = '52px'; }
  document.getElementById('ch-strategy-name').textContent = escapeHtml(ch.name);
  const s = getChStrategy(ch.id); if (!s) return;
  initTypeCountPickers();
  document.getElementById('tc-single').value = s.typeCounts.single || 10;
  document.getElementById('tc-judge').value = s.typeCounts.judge || 5;
  document.getElementById('tc-term').value = s.typeCounts.term || 1;
  document.getElementById('tc-short').value = s.typeCounts.short || 1;
  document.getElementById('s-err').value = s.errPct || 0;
  document.getElementById('s-review').value = (s.errPct || 0) + (s.reviewPct || 0);
  updateChapterDualSliderUI(s.errPct || 0, s.reviewPct || 0, s.newPct || 0);
  renderTagColumns(); updateChapterPromptTemplate(); applyAiModeUi();
}
function onChapterStrategyChange() { const ch = getCh(); if (!ch) return; const s = getChStrategy(ch.id); if (!s) return; s.typeCounts.single = parseInt(document.getElementById('tc-single').value) || 0; s.typeCounts.judge = parseInt(document.getElementById('tc-judge').value) || 0; s.typeCounts.term = parseInt(document.getElementById('tc-term').value) || 0; s.typeCounts.short = parseInt(document.getElementById('tc-short').value) || 0; saveState(); updateChapterPromptTemplate(); updateGenerateButtonState(); }
function onChapterDualSlider() {
  let v1 = parseInt(document.getElementById('s-err').value) || 0; let v2 = parseInt(document.getElementById('s-review').value) || 0;
  if (v1 > v2) { if (document.activeElement === document.getElementById('s-err')) { v2 = v1; document.getElementById('s-review').value = v2; } else { v1 = v2; document.getElementById('s-err').value = v1; } }
  const rPct = v2 - v1, nPct = 100 - v2;
  const ch = getCh(); if (ch) { const s = getChStrategy(ch.id); if (s) { s.errPct = v1; s.reviewPct = rPct; s.newPct = nPct; saveState(); } }
  updateChapterDualSliderUI(v1, rPct, nPct); updateChapterPromptTemplate();
}
function updateChapterDualSliderUI(err, rev, newP) { ['dv-err','sn-err'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = err; }); ['dv-review','sn-review'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = rev; }); ['dv-new','sn-new'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = newP; }); const fe = document.getElementById('fill-err'); if (fe) fe.style.width = err + '%'; const fr = document.getElementById('fill-review'); if (fr) { fr.style.width = rev + '%'; fr.style.left = err + '%'; } const fn = document.getElementById('fill-new'); if (fn) { fn.style.width = newP + '%'; fn.style.left = (err + rev) + '%'; }
}
// ===== Tag Management v2: Three-Column Layout =====
function _tagArr(s, cat) { return cat === 'new' ? (s.newTopicTags || []) : (s[cat + 'Tags'] || []); }
var _dragTag = null, _dragCat = null;

function _setupDragListeners() {
  console.log('_setupDragListeners: chips=' + document.querySelectorAll('.tag-chip-v2[draggable]').length + ' panel=' + !!document.getElementById('tags-manager-v2'));
  // Programmatic dragstart on all chips (more reliable than inline ondragstart)
  document.querySelectorAll('.tag-chip-v2[draggable]').forEach(function(chip) {
    if (chip._hasDrag) return;
    chip._hasDrag = true;
    chip.addEventListener('dragstart', function(e) {
      _dragTag = chip.dataset.tag;
      _dragCat = chip.dataset.cat;
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragTag);
      console.log('dragStart: tag=' + _dragTag + ' cat=' + _dragCat);
    });
    chip.addEventListener('dragend', function(e) {
      chip.classList.remove('dragging');
      document.querySelectorAll('.tag-chip-v2.drag-target').forEach(function(el) { el.classList.remove('drag-target'); });
      _dragTag = null; _dragCat = null;
    });
  });

  // Set up drop zone on the panel (once)
  var panel = document.getElementById('tags-manager-v2');
  if (!panel || panel._dropReady) return;
  panel._dropReady = true;

  panel.addEventListener('dragover', function(e) {
    e.preventDefault();
    var colList = e.target.closest('.tag-col-list');
    document.querySelectorAll('.tag-col-list.drag-over').forEach(function(el) {
      if (el !== colList) el.classList.remove('drag-over');
    });
    if (colList) colList.classList.add('drag-over');
    var chip = e.target.closest('.tag-chip-v2');
    document.querySelectorAll('.tag-chip-v2.drag-target').forEach(function(el) { el.classList.remove('drag-target'); });
    if (chip && _dragTag && chip.dataset.cat === _dragCat && chip.dataset.tag !== _dragTag) {
      chip.classList.add('drag-target');
    }
  });

  panel.addEventListener('drop', function(e) {
    e.preventDefault();
    document.querySelectorAll('.tag-col-list.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
    document.querySelectorAll('.tag-chip-v2.drag-target').forEach(function(el) { el.classList.remove('drag-target'); });

    if (!_dragTag || !_dragCat) { console.log('drop: no _dragTag/_dragCat'); return; }
    // Find target column by checking parent .tag-column
    var colEl = e.target.closest('.tag-column');
    if (!colEl) { console.log('drop: not on .tag-column, target:', e.target.tagName, e.target.className); return; }
    var listEl = colEl.querySelector('.tag-col-list');
    if (!listEl) return;
    var toCat = listEl.id.replace('tag-col-', '');
    if (['error','review','new'].indexOf(toCat) < 0) return;

    console.log('drop: tag=' + _dragTag + ' from=' + _dragCat + ' to=' + toCat);

    // Merge: dropped on another chip in SAME category
    var targetChip = e.target.closest('.tag-chip-v2');
    if (targetChip && targetChip.dataset.cat === _dragCat && targetChip.dataset.tag !== _dragTag) {
      console.log('drop: merge ' + _dragTag + ' -> ' + targetChip.dataset.tag);
      try { mergeTagInCategory(_dragTag, targetChip.dataset.tag, _dragCat); } catch(me) { console.error('merge error:', me); }
      return;
    }

    // Move between categories
    if (_dragCat !== toCat) {
      console.log('drop: move to ' + toCat);
      try { moveTagBetweenColumns(_dragTag, _dragCat, toCat); } catch(me2) { console.error('move error:', me2); }
    }
  });
}

function renderTagColumns() {
  var cols = ['error','review','new'];
  var emptyMsgs = { error: '暂无错题标签', review: '暂无复习标签', new: '暂无新题标签' };
  var ch = getCh(); var s = ch ? getChStrategy(ch.id) : null;
  cols.forEach(function(cat) {
    var listEl = document.getElementById('tag-col-' + cat);
    if (!listEl) return;
    var tags = s ? _tagArr(s, cat) : [];
    if (tags.length === 0) {
      listEl.innerHTML = '<span style="color:#bbb;font-size:11px;padding:4px;">' + emptyMsgs[cat] + '</span>';
      return;
    }
    listEl.innerHTML = tags.map(function(t) {
      var meta = (s.tagMeta && s.tagMeta[t]) || { totalQ: 0, correct: 0 };
      var rate = meta.totalQ > 0 ? Math.round(meta.correct / meta.totalQ * 100) : 0;
      var statStr = meta.totalQ > 0 ? ('<span class="tag-stat">' + meta.totalQ + '题 ' + rate + '%</span>') : '';
      return '<span class="tag-chip-v2 cat-' + cat + '" draggable="true" data-tag="' + escapeHtml(t) + '" data-cat="' + cat + '" ondblclick="tagRenameStart(this,\'' + cat + '\')">' +
        '<span class="tag-name">' + escapeHtml(t) + '</span>' + statStr +
        '<span class="tag-del" onclick="event.stopPropagation();removeTagFromCategory(\'' + cat + '\',\'' + escapeHtml(t).replace(/'/g,"\\'") + '\')">×</span>' +
        '</span>';
    }).join('');
  });
  // Bind programmatic drag listeners to all chips (idempotent — _hasDrag flag)
  _setupDragListeners();
}

var _dragTag = null, _dragCat = null;
function addTagToCategory(cat, input) {
  var name = input.value.trim(); if (!name) return;
  var ch = getCh(); if (!ch) return;
  var s = getChStrategy(ch.id); if (!s) return;
  var allTags = (s.errorTags || []).concat(s.reviewTags || [], s.newTopicTags || []);
  if (allTags.indexOf(name) >= 0) { input.value = ''; return; }
  var tagArr = _tagArr(s, cat); tagArr.push(name); if (cat === 'new') s.newTopicTags = tagArr; else s[cat + 'Tags'] = tagArr;
  if (!s.tagMeta[name]) s.tagMeta[name] = { totalQ: 0, correct: 0 };
  input.value = ''; saveState(); renderTagColumns(); updateChapterPromptTemplate();
}

function removeTagFromCategory(cat, name) {
  var ch = getCh(); if (!ch) return;
  var s = getChStrategy(ch.id); if (!s) return;
  var arr = _tagArr(s, cat); if (!arr || !arr.length) return;
  var idx = arr.indexOf(name);
  if (idx >= 0) arr.splice(idx, 1);
  saveState(); renderTagColumns(); updateChapterPromptTemplate();
}

function moveTagBetweenColumns(tagName, fromCat, toCat) {
  var ch = getCh(); if (!ch) { console.log('moveTag: no chapter'); return; }
  var s = getChStrategy(ch.id); if (!s) { console.log('moveTag: no strategy'); return; }
  var fromArr = _tagArr(s, fromCat); var toArr = _tagArr(s, toCat);
  if (!fromArr || !toArr) { console.log('moveTag: missing arrays for ' + fromCat + ' or ' + toCat); return; }
  var idx = fromArr.indexOf(tagName);
  console.log('moveTag: removing "' + tagName + '" from ' + fromCat + 'Tags (idx=' + idx + '), adding to ' + toCat + 'Tags');
  if (idx >= 0) fromArr.splice(idx, 1);
  if (toArr.indexOf(tagName) < 0) toArr.push(tagName);
  saveState(); renderTagColumns(); updateChapterPromptTemplate();
}

function mergeTagInCategory(draggedTag, targetTag, cat) {
  console.log('mergeTag: ' + draggedTag + ' -> ' + targetTag + ' in ' + cat);
  if (!confirm('合并标签「' + draggedTag + '」到「' + targetTag + '」？\n被合并的标签将被移除，其关联的题目归入目标标签。')) { console.log('mergeTag: cancelled by user'); return; }
  var ch = getCh(); if (!ch) { console.log('mergeTag: no chapter'); return; }
  var s = getChStrategy(ch.id); if (!s) { console.log('mergeTag: no strategy'); return; }
  var arr = _tagArr(s, cat);
  var idx = arr.indexOf(draggedTag);
  if (idx >= 0) arr.splice(idx, 1);
  // Merge tagMeta: add draggedTag's stats to targetTag
  if (s.tagMeta[draggedTag] && s.tagMeta[targetTag]) {
    s.tagMeta[targetTag].totalQ += s.tagMeta[draggedTag].totalQ;
    s.tagMeta[targetTag].correct += s.tagMeta[draggedTag].correct;
  }
  delete s.tagMeta[draggedTag];
  // Update all quizSets: rename tag on questions
  (ch.quizSets || []).forEach(function(set) {
    set.questions.forEach(function(q) { if (q.tag === draggedTag) q.tag = targetTag; });
  });
  saveState(); renderTagColumns(); updateChapterPromptTemplate();
}

function tagRenameStart(el, cat) {
  var oldName = el.dataset.tag;
  var newName = prompt('重命名标签：', oldName);
  if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
  newName = newName.trim();
  var ch = getCh(); if (!ch) return;
  var s = getChStrategy(ch.id); if (!s) return;
  var arr = _tagArr(s, cat); var idx = arr.indexOf(oldName);
  if (idx >= 0) arr[idx] = newName;
  if (s.tagMeta[oldName]) { s.tagMeta[newName] = s.tagMeta[oldName]; delete s.tagMeta[oldName]; }
  (ch.quizSets || []).forEach(function(set) {
    set.questions.forEach(function(q) { if (q.tag === oldName) q.tag = newName; });
  });
  saveState(); renderTagColumns(); updateChapterPromptTemplate();
}

// Backward compat stubs
function renderChapterTags() { renderTagColumns(); }
function addManualTag() { var input = document.getElementById('tag-input'); if (input) addTagToCategory('error', input); }
function toggleChapterTag(idx) {}
function removeChapterTag(idx) {}

// ===== Updated generatePromptText =====
function generatePromptText(chId) {
  var s = getChStrategy(chId); if (!s) return '';
  var single = s.typeCounts.single || 0, judge = s.typeCounts.judge || 0, term = s.typeCounts.term || 0, short = s.typeCounts.short || 0;
  var errPct = s.errPct || 0, reviewPct = s.reviewPct || 0, newPct = s.newPct || 0;
  var parts = []; if (single > 0) parts.push(single + ' 道单选题'); if (judge > 0) parts.push(judge + ' 道判断题'); if (term > 0) parts.push(term + ' 道名词解释题'); if (short > 0) parts.push(short + ' 道简答题');
  var qStr = parts.join('，') || '请自行决定题型与数量';
  var totalQ = single + judge + term + short;
  // Calculate exact per-category question counts
  var errTarget = Math.round(totalQ * errPct / 100);
  var reviewTarget = Math.round(totalQ * reviewPct / 100);
  var newTarget = totalQ - errTarget - reviewTarget;

  var errorTags = s.errorTags || [], reviewTags = s.reviewTags || [], newTopicTags = s.newTopicTags || [];
  var meta = s.tagMeta || {};

  function tagWithRate(t) {
    var m = meta[t] || { totalQ: 0, correct: 0 };
    var rate = m.totalQ > 0 ? Math.round(m.correct / m.totalQ * 100) : 0;
    return t + '(共' + m.totalQ + '题 正确率' + rate + '%)';
  }
  var errStr = errorTags.length > 0 ? errorTags.map(tagWithRate).join('、') : '暂无';
  var revStr = reviewTags.length > 0 ? reviewTags.map(tagWithRate).join('、') : '暂无';
  var newStr = newTopicTags.length > 0 ? newTopicTags.map(tagWithRate).join('、') : '暂无';

  var formatNote = '重要：只输出JSON数组，不要包含任何其他文字、代码块标记或解释。\n';
  var base = formatNote;

  base += '请根据提供的学习资料生成题目。\n\n';

  base += '【当前标签分类】\n';
  base += '- 错题标签：' + errStr + '\n';
  base += '- 复习标签：' + revStr + '\n';
  base += '- 新知识点标签：' + newStr + '\n';
  base += '注意：复习标签和错题标签都可能包含正确率不为 100% 的标签。正确率仅作为出题侧重参考，不是分类依据。\n\n';

  base += '【出题要求】\n';
  base += '1. 题型与数量：' + qStr + '。\n';
  base += '2. 内容来源：必须严格基于提供的资料。\n';
  base += '3. 格式要求：只输出纯文本的 JSON 数组。含有数学符号、上下标、分式、根号、积分、求和等内容的题目，必须使用 $...$ 包裹行内公式（如 $E=mc^2$、$x_1$），使用 $$...$$ 包裹独立公式块（如 $$\\sum_{i=1}^{n} x_i$$）。\n';
  base += '4. JSON 字段结构：所有题目必须包含 id, type("single"/"judge"/"term"/"short"), tag(知识点标签), question, explanation, strategy("error"/"review"/"new")。\n';
  base += '   单选增加 options(数组), answer(索引 0-3)；判断增加 options(["正确","错误"]), answer(0或1)；名词解释和简答不需要 options 和 answer。\n';
  base += '5. 出题策略分配 — 严格遵循：\n';
  base += '   - 错题回顾 (error)：' + errTarget + ' 道 — 从错题标签范围出变式题，tag 使用对应错题标签\n';
  base += '   - 滚动复习 (review)：' + reviewTarget + ' 道 — 从复习标签范围出巩固题，tag 使用对应复习标签\n';
  base += '   - 新考点探索 (new)：' + newTarget + ' 道 — 从资料中挖掘尚未被以上标签覆盖的全新知识点\n';
  base += '   每道题的 strategy 字段必须恰好是 "error"、"review"、"new" 之一。\n';
  if (newTarget > 0) {
    base += '   【重要】strategy="new" 的题目：其 tag 必须是与错题标签、复习标签不同的全新知识点标签（从资料中挖掘未覆盖的考点）。禁止在 new 题上复用错题标签或复习标签中的已有标签。如果新知识点标签列表非空则优先使用，否则自行从资料中提取新知识点作为 tag。\n';
  }
  base += '   如果某个区块写"暂无"，则该区块分配的数量归入新考点探索。\n';
  base += '6. strategy="error"或"review"的题目，tag 应使用对应的已有标签；只有 strategy="new"的题目才创建新标签。\n';

  return base;
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
  // Hide empty state guide when chapter exists
  var guide = document.getElementById('start-empty-guide');
  if (guide) guide.style.display = 'none';
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
      ? runningStreamTask.streamSetRef.userAnswers.filter(function(a) { return a !== undefined && a !== -1; }).length
      : 0;
    document.getElementById('chapter-quick-info').textContent = '共 ' + totalQ + ' 题，已答 ' + answered + ' 题 (注入中...)';
    var btn2 = document.getElementById('btn-continue-quiz');
    if (streamSc >= threshold) {
      btn2.style.display = '';
      btn2.textContent = (answered >= totalQ && totalQ > 0) ? '📊 查看报告' : '▶️ 继续答题';
    } else {
      btn2.style.display = 'none';
    }
    container.style.display = 'block';
    return;
  }

  const sets = ch.quizSets || [];
  if (sets.length > 0) {
    const qs = getCurrentQuizSet();
    var totalQ = qs ? qs.questions.length : 0;
    var answered = qs ? qs.userAnswers.filter(function(a) { return a !== undefined && a !== -1; }).length : 0;
    document.getElementById('chapter-quick-info').textContent = '共 ' + totalQ + ' 题，已答 ' + answered + ' 题';
    var btn = document.getElementById('btn-continue-quiz');
    if (totalQ > 0) {
      btn.style.display = '';
      if (answered >= totalQ) {
        btn.textContent = '📊 查看报告';
      } else {
        btn.textContent = '▶️ 继续答题';
      }
    } else {
      btn.style.display = 'none';
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