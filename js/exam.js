const EXAM_COLORS = ['#e94560','#f59e0b','#2ed573','#4facfe','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
const EXAM_DEFAULTS = {
  typeCounts: { single: 20, judge: 10, term: 5, short: 1 },
  errPct: 30, reviewPct: 70, newPct: 0
};

function getExamSettings(subjId) {
  if (!state._examSettings) state._examSettings = {};
  if (!state._examSettings[subjId]) {
    state._examSettings[subjId] = {
      typeCounts: { single: EXAM_DEFAULTS.typeCounts.single, judge: EXAM_DEFAULTS.typeCounts.judge, term: EXAM_DEFAULTS.typeCounts.term, short: EXAM_DEFAULTS.typeCounts.short },
      errPct: EXAM_DEFAULTS.errPct,
      reviewPct: EXAM_DEFAULTS.reviewPct,
      newPct: EXAM_DEFAULTS.newPct,
      _examCumSliders: null
    };
  }
  return state._examSettings[subjId];
}

function renderSubjComposeExam(s) {
  const container = document.getElementById('subj-tab-compose-exam'); if (!container) return;
  const es = getExamSettings(s.id);
  let html = '<div class="card"><h3>📝 大考卷 — ' + escapeHtml(s.name) + '</h3><p style="color:#666;font-size:14px;margin-bottom:10px;">从本科目各章节中抽取题目，组成综合试卷。</p>';
  html += '<h4 style="font-size:15px;margin-bottom:6px;">1. 选择章节</h4><div class="chapter-select-grid" id="exam-chapter-select">';
  s.chapterIds.forEach(cid => { const ch = state.chapters[cid]; if (!ch) return; html += '<div class="chapter-select-item"><input type="checkbox" id="exam-chk-' + cid + '" value="' + cid + '" onchange="updateExamSlidersFromSubj()"><label for="exam-chk-' + cid + '">' + escapeHtml(ch.name) + '</label><span class="cs-count">' + (ch.questions ? ch.questions.length : 0) + ' 题</span></div>'; });
  html += '</div><h4 style="font-size:15px;margin:10px 0 6px;">2. 各题型数量</h4><div class="type-counts">';
  ['single','judge','term','short'].forEach(function(type){
    var labels={single:'📝 单选',judge:'⚖️ 判断',term:'📖 名词解释',short:'✍️ 简答'};
    html+='<div class="type-count-item"><label>'+labels[type]+'</label><div class="num-picker"><button class="num-btn num-dec" onclick="numPickerStep(this,-1);saveExamTypeCounts(\''+s.id+'\')">−</button><input type="number" id="exam-tc-'+type+'" class="num-input" value="'+es.typeCounts[type]+'" min="0" max="50" onchange="updateExamTotal();saveExamTypeCounts(\''+s.id+'\')" oninput="numPickerClamp(this)"><button class="num-btn num-inc" onclick="numPickerStep(this,1);saveExamTypeCounts(\''+s.id+'\')">+</button></div></div>';
  });
  html += '</div><p style="font-size:13px;color:#888;" id="exam-total-info"></p>';
  // 章节占比 - 含直接输入
  html += '<h4 style="font-size:15px;margin:10px 0 6px;">3. 章节占比（总和100%）<span style="font-size:11px;color:#888;">可拖拽滑块或直接输入百分比，调整右侧章节自动补偿</span></h4><div id="exam-proportion-area">请先勾选章节</div>';
  // 出题策略 (不含新题策略，大考卷无新题)
  html += '<h4 style="font-size:15px;margin:10px 0 6px;">4. 出题策略（不含新题）</h4>';
  html += '<div class="strategy-group" style="margin:4px 0;"><div class="strategy-labels" style="font-size:13px;"><span>🔴 针对错题 <input type="number" id="exam-dv-err-inp" class="strategy-pct-input" value="'+es.errPct+'" min="0" max="100" onchange="onExamStrategyInput(\''+s.id+'\')" style="width:45px;">%</span><span>🟡 滚动复习 <span class="val" id="exam-dv-review">'+es.reviewPct+'</span>%</span></div>';
  html += '<div class="dual-range-wrap" style="height:36px;"><div class="dual-track-bg"></div><div class="dual-track-fill err" id="exam-fill-err" style="width:'+es.errPct+'%"></div><div class="dual-track-fill review" id="exam-fill-review" style="width:'+es.reviewPct+'%;left:'+es.errPct+'%"></div><input type="range" class="exam-s-err" id="exam-s-err" min="0" max="100" value="'+es.errPct+'" step="1" oninput="updateExamDualSlider(\''+s.id+'\')"></div></div>';
  html += '<div style="margin-top:12px;"><button class="btn btn-success btn-small" onclick="composeSubjExam(\'' + s.id + '\')">📝 生成大考卷</button></div></div>';
  html += '<div class="card" style="margin-top:12px;"><h4 style="font-size:15px;margin-bottom:8px;">📋 历史试卷</h4>';
  html += renderGeneratedExamList(s.id, 'exam');
  html += '</div>';
  container.innerHTML = html;

  // 恢复之前勾选的章节
  if (es._checkedCids && es._checkedCids.length > 0) {
    es._checkedCids.forEach(function(cid) {
      var cb = document.getElementById('exam-chk-' + cid);
      if (cb) cb.checked = true;
    });
  }

  updateExamTotal();
  updateExamDualSlider(s.id);
  updateExamSlidersFromSubj();
}

// ---- 记忆题型数量 ----
function saveExamTypeCounts(subjId) {
  const es = getExamSettings(subjId);
  es.typeCounts.single = parseInt(document.getElementById('exam-tc-single')?.value) || 0;
  es.typeCounts.judge = parseInt(document.getElementById('exam-tc-judge')?.value) || 0;
  es.typeCounts.term = parseInt(document.getElementById('exam-tc-term')?.value) || 0;
  es.typeCounts.short = parseInt(document.getElementById('exam-tc-short')?.value) || 0;
  saveState();
}

// ---- 出题策略输入 ----
function onExamStrategyInput(subjId) {
  const es = getExamSettings(subjId);
  let errVal = parseInt(document.getElementById('exam-dv-err-inp')?.value) || 0;
  errVal = Math.max(0, Math.min(100, errVal));
  document.getElementById('exam-dv-err-inp').value = errVal;
  es.errPct = errVal;
  es.reviewPct = 100 - errVal;
  es.newPct = 0;
  // 更新slider
  const sErr = document.getElementById('exam-s-err');
  if (sErr) sErr.value = errVal;
  // 更新显示
  const revLabel = document.getElementById('exam-dv-review');
  if (revLabel) revLabel.textContent = es.reviewPct;
  updateExamDualSliderUI(errVal, es.reviewPct);
  saveState();
}

function updateExamTotal() {
  const s = parseInt(document.getElementById('exam-tc-single')?.value) || 0;
  const j = parseInt(document.getElementById('exam-tc-judge')?.value) || 0;
  const t = parseInt(document.getElementById('exam-tc-term')?.value) || 0;
  const sh = parseInt(document.getElementById('exam-tc-short')?.value) || 0;
  const el = document.getElementById('exam-total-info');
  if (el) el.textContent = '总题数：' + (s+j+t+sh) + ' 题';
}

function updateExamDualSlider(subjId) {
  const es = getExamSettings(subjId);
  let v1 = parseInt(document.getElementById('exam-s-err')?.value) || 0;
  // 大考卷只有错题+复习，总和100%，不需要第二个slider
  v1 = Math.max(0, Math.min(100, v1));
  es.errPct = v1;
  es.reviewPct = 100 - v1;
  es.newPct = 0;
  // 同步输入框
  const inp = document.getElementById('exam-dv-err-inp');
  if (inp) inp.value = v1;
  updateExamDualSliderUI(v1, es.reviewPct);
  saveState();
}

function updateExamDualSliderUI(errPct, reviewPct) {
  const revLabel = document.getElementById('exam-dv-review');
  if (revLabel) revLabel.textContent = reviewPct;
  const fe = document.getElementById('exam-fill-err');
  if (fe) fe.style.width = errPct + '%';
  const fr = document.getElementById('exam-fill-review');
  if (fr) { fr.style.width = reviewPct + '%'; fr.style.left = errPct + '%'; }
}

// ---- 章节占比：累积滑条 + 数字输入 ----
function updateExamSlidersFromSubj() {
  const area = document.getElementById('exam-proportion-area'); if (!area) return;
  const checkedCids = []; document.querySelectorAll('#exam-chapter-select input[type="checkbox"]:checked').forEach(cb => checkedCids.push(cb.value));
  area._checkedCids = checkedCids;

  // 记忆选中的章节
  const subjId = getSubj()?.id;
  if (subjId) { const es = getExamSettings(subjId); es._checkedCids = checkedCids.slice(); saveState(); }

  const n = checkedCids.length;
  if (n === 0) { area.innerHTML = '<div style="color:#999;font-size:13px;text-align:center;padding:6px;">请先勾选章节</div>'; return; }
  if (n === 1) {
    const ch = state.chapters[checkedCids[0]];
    area.innerHTML = '<div style="text-align:center;padding:6px;font-size:14px;color:#888;">仅一个章节占比固定 <strong style="color:#2ed573;">100%</strong></div>' +
      '<div class="chapter-pct-labels"><span class="chapter-pct-label" style="background:' + EXAM_COLORS[0] + ';">' + escapeHtml(ch ? ch.name : '') + ' 100%</span></div>';
    area._pcts = [100];
    return;
  }
  // n >= 2: 生成 n-1 个累积滑条
  // 如果是用户勾选/取消章节导致的调用，自动平均化；否则保留已有设置
  const es = subjId ? getExamSettings(subjId) : null;
  const prevN = (es && es._examCumSliders && es._examCumSliders.length > 0) ? es._examCumSliders.length + 1 : 0;

  // 当章节数量变化时自动平均化
  const shouldAutoAvg = (n !== prevN);

  const sliders = shouldAutoAvg ? (() => {
    const arr = []; for (let i = 0; i < n - 1; i++) arr.push(Math.round((i + 1) * 100 / n));
    return arr;
  })() : (es && es._examCumSliders ? es._examCumSliders.slice() : (() => {
    const arr = []; for (let i = 0; i < n - 1; i++) arr.push(Math.round((i + 1) * 100 / n));
    return arr;
  })());

  // 确保长度匹配
  while (sliders.length < n - 1) sliders.push(Math.round((sliders.length + 1) * 100 / n));
  while (sliders.length > n - 1) sliders.pop();
  // 确保单调性
  for (let i = 0; i < n - 1; i++) {
    const prev = i > 0 ? sliders[i - 1] : 0;
    const next = i < n - 2 ? sliders[i + 1] : 100;
    if (sliders[i] < prev) sliders[i] = prev;
    if (sliders[i] > next) sliders[i] = next;
  }
  if (es) { es._examCumSliders = sliders; }
  state._examCumSliders = sliders;
  saveState();

  // 计算各段占比
  const pcts = [];
  let prevVal = 0;
  for (let i = 0; i < n; i++) {
    const curVal = i < n - 1 ? sliders[i] : 100;
    pcts.push(curVal - prevVal);
    prevVal = curVal;
  }

  // 构造 UI：累积滑条 + 数字输入
  let html = '<div class="multi-range-wrap" id="cum-slider-wrap">';
  html += '<div class="dual-track-bg"></div>';
  for (let i = 0; i < n; i++) {
    const left = pcts.slice(0, i).reduce((a, b) => a + b, 0);
    const color = EXAM_COLORS[i % EXAM_COLORS.length];
    html += '<div class="track-segment" id="cum-seg-' + i + '" style="width:' + pcts[i] + '%;left:' + left + '%;background:' + color + ';"></div>';
  }
  for (let i = 0; i < n - 1; i++) {
    html += '<input type="range" class="cum-slider" id="cum-slider-' + i + '" min="0" max="100" value="' + sliders[i] + '" step="1" oninput="onCumSliderChange(' + i + ')">';
  }
  html += '</div>';
  // 标签列表 + 数字输入
  html += '<div class="chapter-pct-labels" id="cum-pct-labels">';
  for (let i = 0; i < n; i++) {
    const ch = state.chapters[checkedCids[i]];
    const color = EXAM_COLORS[i % EXAM_COLORS.length];
    html += '<div class="chapter-pct-label-row" id="cum-label-row-' + i + '">';
    html += '<span class="chapter-pct-label" style="background:' + color + ';">' + escapeHtml(ch ? ch.name : '未知') + '</span>';
    html += '<input type="number" class="chapter-pct-input" id="cum-pct-inp-' + i + '" value="' + pcts[i] + '" min="1" max="99" onchange="onChapterPctInput(' + i + ')" style="width:50px;">%';
    html += '</div>';
  }
  html += '</div>';
  area.innerHTML = html;
  area._pcts = pcts;
}

// ---- 章节占比直接输入：向右增减 ----
function onChapterPctInput(inputIdx) {
  const area = document.getElementById('exam-proportion-area');
  const checkedCids = area._checkedCids || [];
  const n = checkedCids.length;
  if (n < 2) return;

  let newVal = parseInt(document.getElementById('cum-pct-inp-' + inputIdx)?.value) || 0;
  newVal = Math.max(1, Math.min(99, newVal));

  // 计算当前pcts
  const sliders = (state._examCumSliders || []).slice();
  const pcts = [];
  let prevVal = 0;
  for (let i = 0; i < n; i++) {
    const curVal = i < n - 1 ? sliders[i] : 100;
    pcts.push(curVal - prevVal);
    prevVal = curVal;
  }

  const oldVal = pcts[inputIdx];
  const delta = newVal - oldVal;

  if (delta === 0) return;

  // 向右增减原则：增加inputIdx则减少inputIdx+1，减少则增加inputIdx+1
  // 最右边一格(inputIdx === n-1)：向左增减
  if (inputIdx === n - 1) {
    // 最右边，调整左边(inputIdx-1)
    pcts[inputIdx - 1] -= delta;
    pcts[inputIdx] += delta;
  } else {
    // 调整右边(inputIdx+1)
    pcts[inputIdx + 1] -= delta;
    pcts[inputIdx] += delta;
  }

  // 确保所有值合法
  for (let i = 0; i < n; i++) {
    if (pcts[i] < 1) {
      // 从另一边借
      if (i < n - 1) {
        pcts[i + 1] -= (1 - pcts[i]);
        pcts[i] = 1;
      } else if (i > 0) {
        pcts[i - 1] -= (1 - pcts[i]);
        pcts[i] = 1;
      }
    }
    if (pcts[i] > 99) pcts[i] = 99;
  }

  // 重建sliders并更新UI
  const newSliders = [];
  let cum = 0;
  for (let i = 0; i < n - 1; i++) {
    cum += pcts[i];
    newSliders.push(cum);
  }
  state._examCumSliders = newSliders;
  const subjId = getSubj()?.id;
  if (subjId) { const es = getExamSettings(subjId); es._examCumSliders = newSliders; }

  // 更新所有输入框和滑块
  for (let i = 0; i < n; i++) {
    const inp = document.getElementById('cum-pct-inp-' + i);
    if (inp) inp.value = pcts[i];
    const seg = document.getElementById('cum-seg-' + i);
    if (seg) {
      const left = pcts.slice(0, i).reduce((a, b) => a + b, 0);
      seg.style.width = pcts[i] + '%';
      seg.style.left = left + '%';
    }
    const label = document.getElementById('cum-label-row-' + i);
    if (label) {
      const labelSpan = label.querySelector('.chapter-pct-label');
      if (labelSpan) {
        const ch = state.chapters[checkedCids[i]];
        labelSpan.textContent = escapeHtml(ch ? ch.name : '未知');
      }
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const slider = document.getElementById('cum-slider-' + i);
    if (slider) slider.value = newSliders[i];
  }
  area._pcts = pcts;
  saveState();
}

function onCumSliderChange(sliderIdx) {
  const area = document.getElementById('exam-proportion-area');
  const checkedCids = area._checkedCids || [];
  const n = checkedCids.length;
  if (n < 2) return;
  const sliders = state._examCumSliders || [];
  const newVal = parseInt(document.getElementById('cum-slider-' + sliderIdx).value) || 0;
  const leftBound = sliderIdx > 0 ? sliders[sliderIdx - 1] : 0;
  const rightBound = sliderIdx < n - 2 ? sliders[sliderIdx + 1] : 100;
  let clampedVal = Math.max(leftBound, Math.min(rightBound, newVal));
  sliders[sliderIdx] = clampedVal;
  document.getElementById('cum-slider-' + sliderIdx).value = clampedVal;

  const pcts = [];
  let prevVal = 0;
  for (let i = 0; i < n; i++) {
    const curVal = i < n - 1 ? sliders[i] : 100;
    pcts.push(curVal - prevVal);
    prevVal = curVal;
  }

  // 更新滑块和色块
  for (let i = 0; i < n; i++) {
    const seg = document.getElementById('cum-seg-' + i);
    if (seg) {
      const left = pcts.slice(0, i).reduce((a, b) => a + b, 0);
      seg.style.width = pcts[i] + '%';
      seg.style.left = left + '%';
    }
    // 更新输入框
    const inp = document.getElementById('cum-pct-inp-' + i);
    if (inp) inp.value = pcts[i];
    const label = document.getElementById('cum-label-row-' + i);
    if (label) {
      const labelSpan = label.querySelector('.chapter-pct-label');
      if (labelSpan) {
        const ch = state.chapters[checkedCids[i]];
        labelSpan.textContent = escapeHtml(ch ? ch.name : '未知');
      }
    }
  }
  state._examCumSliders = sliders;
  const subjId = getSubj()?.id;
  if (subjId) { const es = getExamSettings(subjId); es._examCumSliders = sliders; }
  area._pcts = pcts;
  saveState();
}

function getSubjExamSliderValues() {
  const area = document.getElementById('exam-proportion-area');
  const checkedCids = area._checkedCids || [];
  const n = checkedCids.length;
  if (n === 0) return { cids: [], weights: [] };
  const pcts = area._pcts || new Array(n).fill(Math.floor(100 / n));
  return { cids: checkedCids, weights: pcts };
}

function composeSubjExam(subjId) {
  const s = state.subjects[subjId]; if (!s) return;
  const es = getExamSettings(subjId);
  const checkedCids = []; document.querySelectorAll('#exam-chapter-select input[type="checkbox"]:checked').forEach(cb => checkedCids.push(cb.value));
  if (checkedCids.length === 0) { alert('请至少选择一个章节'); return; }
  const ts = parseInt(document.getElementById('exam-tc-single').value) || 0; const tj = parseInt(document.getElementById('exam-tc-judge').value) || 0; const tt = parseInt(document.getElementById('exam-tc-term').value) || 0; const tsh = parseInt(document.getElementById('exam-tc-short').value) || 0;
  if (ts + tj + tt + tsh === 0) { alert('请设置至少 1 道题'); return; }
  let aS = 0, aJ = 0, aT = 0, aSh = 0;
  checkedCids.forEach(cid => { const ch = state.chapters[cid]; if (ch && ch.questions) ch.questions.forEach(q => { if (q.type === 'single') aS++; else if (q.type === 'judge') aJ++; else if (q.type === 'term') aT++; else if (q.type === 'short') aSh++; }); (state.history||[]).filter(r=>r.chapterId===cid).forEach(r => { if (r.questions) r.questions.forEach(q => { if (q.type === 'single') aS++; else if (q.type === 'judge') aJ++; else if (q.type === 'term') aT++; else if (q.type === 'short') aSh++; }); }); });
  if (ts > aS) { alert('单选需求 ' + ts + '，可用 ' + aS); return; } if (tj > aJ) { alert('判断需求 ' + tj + '，可用 ' + aJ); return; } if (tt > aT) { alert('名词解释需求 ' + tt + '，可用 ' + aT); return; } if (tsh > aSh) { alert('简答需求 ' + tsh + '，可用 ' + aSh); return; }
  const { cids, weights } = getSubjExamSliderValues();
  function dist(count, cidList, wList) { if (count === 0) return new Array(cidList.length).fill(0); const raw = wList.map(w => (w / 100) * count); const results = raw.map(Math.floor); let remain = count - results.reduce((a, b) => a + b, 0); while (remain > 0) { let maxIdx = 0; for (let i = 0; i < results.length; i++) { if (raw[i] - results[i] > raw[maxIdx] - results[maxIdx]) maxIdx = i; } results[maxIdx]++; remain--; } return results; }
  const sD = dist(ts, cids, weights), jD = dist(tj, cids, weights), tD = dist(tt, cids, weights), shD = dist(tsh, cids, weights);
  function pick(chId, type, count) { if (count <= 0) return []; let pool = []; (state.history||[]).filter(r=>r.chapterId===chId).forEach(r => { if (r.questions) r.questions.forEach(q => { if (q.type === type) pool.push({...q}); }); }); const ch = state.chapters[chId]; if (ch && ch.questions) { ch.questions.forEach((q, idx) => { if (q.type === type && ch.userAnswers[idx] === undefined) pool.push({...q}); }); if (pool.length < count) ch.questions.forEach((q, idx) => { if (q.type === type && ch.userAnswers[idx] !== undefined) pool.push({...q}); }); } pool = pool.filter(q => !isQuestionIgnored(chId, q)); const shuffled = [...pool]; for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; } return shuffled.slice(0, count); }
  const selected = []; cids.forEach((cid, idx) => { selected.push(...pick(cid, 'single', sD[idx])); selected.push(...pick(cid, 'judge', jD[idx])); selected.push(...pick(cid, 'term', tD[idx])); selected.push(...pick(cid, 'short', shD[idx])); });
  if (selected.length === 0) { alert('未能抽取题目'); return; }
  const eid = 'exam_' + Date.now().toString(36);
  const genExam = { id: eid, name: '大考卷 ' + new Date().toLocaleString('zh-CN'), type: 'exam', subjectId: subjId, questions: selected, userAnswers: new Array(selected.length).fill(undefined), currentIdx: 0, createdAt: Date.now() };

  // 记忆当前设置（在生成考试时保存）
  saveExamTypeCounts(subjId);
  // 保存策略
  es.errPct = parseInt(document.getElementById('exam-dv-err-inp')?.value) || es.errPct;
  es.reviewPct = 100 - es.errPct;
  es.newPct = 0;
  const sliders = state._examCumSliders;
  if (sliders && sliders.length > 0) es._examCumSliders = sliders.slice();
  saveState();

  state.generatedExams[eid] = genExam;
  state.currentExamId = eid;
  saveState(); startExamQuiz(eid); renderSubjComposeExam(s);
  alert('✅ 大考卷已生成：共 ' + selected.length + ' 题');
}
