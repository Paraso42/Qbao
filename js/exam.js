function pickRandom(arr, n) { if (n <= 0 || arr.length === 0) return []; var shuffled = arr.slice(); for (var i = shuffled.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp; } return shuffled.slice(0, Math.min(n, shuffled.length)); }
const EXAM_COLORS = ['#e94560','#f59e0b','#2ed573','#4facfe','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
function renderSubjComposeExam(s) {
  const container = document.getElementById('subj-tab-compose-exam'); if (!container) return;
  let html = '<div class="card"><h3>📝 大考卷 — ' + escapeHtml(s.name) + '</h3><p style="color:#666;font-size:14px;margin-bottom:10px;">从本科目各章节中抽取题目，组成综合试卷。</p>';
  html += '<h4 style="font-size:15px;margin-bottom:6px;">1. 选择章节</h4><div class="chapter-select-grid" id="exam-chapter-select">';
  s.chapterIds.forEach(cid => { const ch = state.chapters[cid]; if (!ch) return; html += '<div class="chapter-select-item"><input type="checkbox" id="exam-chk-' + cid + '" value="' + cid + '" onchange="updateExamSlidersFromSubj()"><label for="exam-chk-' + cid + '">' + escapeHtml(ch.name) + '</label><span class="cs-count">' + (ch.questions ? ch.questions.length : 0) + ' 题</span></div>'; });
  html += '</div><h4 style="font-size:15px;margin:10px 0 6px;">2. 各题型数量</h4><div class="type-counts">';
  ['single','judge','term','short'].forEach(function(type){ var labels={single:'📝 单选',judge:'⚖️ 判断',term:'📖 名词解释',short:'✍️ 简答'}; var defaults={single:5,judge:3,term:1,short:1}; html+='<div class="type-count-item"><label>'+labels[type]+'</label><div class="num-picker"><button class="num-btn num-dec" onclick="numPickerStep(this,-1)">−</button><input type="number" id="exam-tc-'+type+'" class="num-input" value="'+defaults[type]+'" min="0" max="50" onchange="updateExamTotal()" oninput="numPickerClamp(this)"><button class="num-btn num-inc" onclick="numPickerStep(this,1)">+</button></div></div>'; });
  html += '</div><p style="font-size:13px;color:#888;" id="exam-total-info">总题数：10 题</p>';
  // 章节占比 - v8.2 累积滑条
  html += '<h4 style="font-size:15px;margin:10px 0 6px;">3. 章节占比（滑动累积边界，总和100%）</h4><div id="exam-proportion-area">请先勾选章节</div>';
  // 出题策略
  html += '<h4 style="font-size:15px;margin:10px 0 6px;">4. 出题策略</h4><div class="strategy-group" style="margin:4px 0;"><div class="strategy-labels" style="font-size:13px;"><span>🔴 针对错题 <span class="val" id="exam-dv-err">60</span>%</span><span>🟡 滚动复习 <span class="val" id="exam-dv-review">20</span>%</span><span>🟢 新考点 <span class="val" id="exam-dv-new">20</span>%</span></div><div class="dual-range-wrap" style="height:36px;"><div class="dual-track-bg"></div><div class="dual-track-fill err" id="exam-fill-err" style="width:60%"></div><div class="dual-track-fill review" id="exam-fill-review" style="width:20%;left:60%"></div><div class="dual-track-fill new" id="exam-fill-new" style="width:20%;left:80%"></div><input type="range" class="exam-s-err" id="exam-s-err" min="0" max="100" value="60" step="1" oninput="updateExamDualSlider()"><input type="range" class="exam-s-review" id="exam-s-review" min="0" max="100" value="80" step="1" oninput="updateExamDualSlider()"></div></div>';
  html += '<div style="margin-top:12px;"><button class="btn btn-success btn-small" onclick="composeSubjExam(\'' + s.id + '\')">📝 生成大考卷</button></div></div>';
  html += '<div class="card" style="margin-top:12px;"><h4 style="font-size:15px;margin-bottom:8px;">📋 历史试卷</h4>';
  html += renderGeneratedExamList(s.id, 'exam');
  html += '</div>';
  container.innerHTML = html;
  updateExamTotal(); updateExamDualSlider(); updateExamSlidersFromSubj();
}
function updateExamTotal() { const s=parseInt(document.getElementById('exam-tc-single')?.value)||0; const j=parseInt(document.getElementById('exam-tc-judge')?.value)||0; const t=parseInt(document.getElementById('exam-tc-term')?.value)||0; const sh=parseInt(document.getElementById('exam-tc-short')?.value)||0; const el=document.getElementById('exam-total-info'); if(el)el.textContent='总题数：'+(s+j+t+sh)+' 题'; }
function updateExamDualSlider() { let v1=parseInt(document.getElementById('exam-s-err')?.value)||0; let v2=parseInt(document.getElementById('exam-s-review')?.value)||0; if(v1>v2){if(document.activeElement===document.getElementById('exam-s-err')){v2=v1;document.getElementById('exam-s-review').value=v2;}else{v1=v2;document.getElementById('exam-s-err').value=v1;}} const rPct=v2-v1,nPct=100-v2; ['exam-dv-err'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=v1;}); ['exam-dv-review'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=rPct;}); ['exam-dv-new'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=nPct;}); const fe=document.getElementById('exam-fill-err');if(fe)fe.style.width=v1+'%'; const fr=document.getElementById('exam-fill-review');if(fr){fr.style.width=rPct+'%';fr.style.left=v1+'%';} const fn=document.getElementById('exam-fill-new');if(fn){fn.style.width=(100-v2)+'%';fn.style.left=v2+'%';} }
// ---- v8.2 核心：N-1 个累积滑条，互不可穿过 ----
function updateExamSlidersFromSubj() {
  const area = document.getElementById('exam-proportion-area'); if (!area) return;
  const checkedCids = []; document.querySelectorAll('#exam-chapter-select input[type="checkbox"]:checked').forEach(cb => checkedCids.push(cb.value));
  area._checkedCids = checkedCids;
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
  const sliders = state._examCumSliders || (() => {
    const arr = []; for (let i = 0; i < n - 1; i++) arr.push(Math.round((i + 1) * 100 / n));
    state._examCumSliders = arr;
    return arr;
  })();
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
  state._examCumSliders = sliders;
  saveState();
  // 构造 UI
  let html = '<div class="multi-range-wrap" id="cum-slider-wrap">';
  html += '<div class="dual-track-bg"></div>';
  // 计算各段占比并生成色块
  const pcts = [];
  let prevVal = 0;
  for (let i = 0; i < n; i++) {
    const curVal = i < n - 1 ? sliders[i] : 100;
    pcts.push(curVal - prevVal);
    prevVal = curVal;
  }
  for (let i = 0; i < n; i++) {
    const left = pcts.slice(0, i).reduce((a, b) => a + b, 0);
    const color = EXAM_COLORS[i % EXAM_COLORS.length];
    html += '<div class="track-segment" id="cum-seg-' + i + '" style="width:' + pcts[i] + '%;left:' + left + '%;background:' + color + ';"></div>';
  }
  // 生成 n-1 个滑块
  for (let i = 0; i < n - 1; i++) {
    html += '<input type="range" class="cum-slider" id="cum-slider-' + i + '" min="0" max="100" value="' + sliders[i] + '" step="1" oninput="onCumSliderChange(' + i + ')">';
  }
  html += '</div>';
  // 标签列表
  html += '<div class="chapter-pct-labels" id="cum-pct-labels">';
  for (let i = 0; i < n; i++) {
    const ch = state.chapters[checkedCids[i]];
    const color = EXAM_COLORS[i % EXAM_COLORS.length];
    html += '<span class="chapter-pct-label" id="cum-label-' + i + '" style="background:' + color + ';">' + escapeHtml(ch ? ch.name : '未知') + ' ' + pcts[i] + '%</span>';
  }
  html += '</div>';
  area.innerHTML = html;
  area._pcts = pcts;
}
function onCumSliderChange(sliderIdx) {
  const area = document.getElementById('exam-proportion-area');
  const checkedCids = area._checkedCids || [];
  const n = checkedCids.length;
  if (n < 2) return;
  const sliders = state._examCumSliders || [];
  const newVal = parseInt(document.getElementById('cum-slider-' + sliderIdx).value) || 0;
  // 确保不越过左边界
  const leftBound = sliderIdx > 0 ? sliders[sliderIdx - 1] : 0;
  const rightBound = sliderIdx < n - 2 ? sliders[sliderIdx + 1] : 100;
  let clampedVal = Math.max(leftBound, Math.min(rightBound, newVal));
  sliders[sliderIdx] = clampedVal;
  document.getElementById('cum-slider-' + sliderIdx).value = clampedVal;
  // 更新色块和标签
  const pcts = [];
  let prevVal = 0;
  for (let i = 0; i < n; i++) {
    const curVal = i < n - 1 ? sliders[i] : 100;
    pcts.push(curVal - prevVal);
    prevVal = curVal;
  }
  for (let i = 0; i < n; i++) {
    const seg = document.getElementById('cum-seg-' + i);
    if (seg) {
      const left = pcts.slice(0, i).reduce((a, b) => a + b, 0);
      seg.style.width = pcts[i] + '%';
      seg.style.left = left + '%';
    }
    const label = document.getElementById('cum-label-' + i);
    if (label) {
      const ch = state.chapters[checkedCids[i]];
      label.textContent = escapeHtml(ch ? ch.name : '未知') + ' ' + pcts[i] + '%';
    }
  }
  state._examCumSliders = sliders;
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
  function pick(chId, type, count, stratPcts) { if (count <= 0) return []; let pool = []; (state.history||[]).filter(r=>r.chapterId===chId).forEach(r => { if (r.questions) r.questions.forEach(q => { if (q.type === type) pool.push({...q}); }); }); const ch = state.chapters[chId]; if (ch && ch.questions) { ch.questions.forEach((q, idx) => { if (q.type === type && ch.userAnswers[idx] === undefined) pool.push({...q}); }); if (pool.length < count) ch.questions.forEach((q, idx) => { if (q.type === type && ch.userAnswers[idx] !== undefined) pool.push({...q}); }); } pool = pool.filter(q => !isQuestionIgnored(chId, q)); const shuffled = [...pool]; for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; } if (stratPcts && pool.length > 0) { var errorPool = pool.filter(function(q) { return q.strategy === 'error'; }); var reviewPool = pool.filter(function(q) { return q.strategy === 'review'; }); var newPool = pool.filter(function(q) { return q.strategy === 'new'; }); var errTarget = Math.round(count * (stratPcts.err || 60) / 100); var revTarget = Math.round(count * (stratPcts.review || 20) / 100); var newTarget = count - errTarget - revTarget; var sel2 = []; sel2 = sel2.concat(pickRandom(errorPool, errTarget)); sel2 = sel2.concat(pickRandom(reviewPool, revTarget)); sel2 = sel2.concat(pickRandom(newPool, newTarget)); var deficit = count - sel2.length; if (deficit > 0) { var remaining = pool.filter(function(q) { return sel2.indexOf(q) < 0; }); sel2 = sel2.concat(pickRandom(remaining, deficit)); } return sel2; } return pickRandom(pool, count); }
  var examErrPct = parseInt(document.getElementById('exam-s-err') ? document.getElementById('exam-s-err').value : 60) || 60; var examReviewSlider = parseInt(document.getElementById('exam-s-review') ? document.getElementById('exam-s-review').value : 80) || 80; var examReviewPct = examReviewSlider - examErrPct; var examNewPct = 100 - examReviewSlider; var stratPcts = { err: examErrPct, review: examReviewPct, new: examNewPct }; const selected = []; cids.forEach((cid, idx) => { selected.push(...pick(cid, 'single', sD[idx], stratPcts)); selected.push(...pick(cid, 'judge', jD[idx], stratPcts)); selected.push(...pick(cid, 'term', tD[idx], stratPcts)); selected.push(...pick(cid, 'short', shD[idx], stratPcts)); });
  if (selected.length === 0) { alert('未能抽取题目'); return; }
  const eid = 'exam_' + Date.now().toString(36);
  const genExam = { id: eid, name: '大考卷 ' + new Date().toLocaleString('zh-CN'), type: 'exam', subjectId: subjId, questions: selected, userAnswers: new Array(selected.length).fill(undefined), currentIdx: 0, createdAt: Date.now() };
  state.generatedExams[eid] = genExam;
  state.currentExamId = eid;
  saveState(); startExamQuiz(eid); renderSubjComposeExam(s);
  alert('✅ 大考卷已生成：共 ' + selected.length + ' 题');
}