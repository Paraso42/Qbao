
function showToast(msg, type) {
  var colors = { success: '#2ed573', warning: '#f59e0b', info: '#4facfe', error: '#e94560' };
  var toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:8px;z-index:9999;font-size:14px;max-width:320px;background:'+(colors[type]||colors.info)+';color:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.5s,transform 0.3s;transform:translateY(20px);opacity:0;';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function(){ toast.style.opacity='1'; toast.style.transform='translateY(0)'; },10);
  setTimeout(function(){ toast.style.opacity='0'; setTimeout(function(){ toast.remove(); },500); },3000);
}

function populateSRSFromHistory() {
  if (!state.srsData) state.srsData = {};
  let added = 0;
  (state.history || []).forEach(r => {
    if (!r.questions) return;
    r.questions.forEach(q => {
      if (!isObjType(q.type) || q.userAnswer === undefined) return;
      const qId = getQuestionId(r.chapterId, q);
      if (!state.srsData[qId]) {
        state.srsData[qId] = { interval: 0, easeFactor: 2.5, repetitions: 0, nextReview: 0 };
        added++;
      }
      const srs = state.srsData[qId];
      const ci = q.isCorrect;
      if (ci === true) {
        if (srs.repetitions === 0) srs.interval = 1;
        else if (srs.repetitions === 1) srs.interval = 3;
        else srs.interval = Math.round(srs.interval * srs.easeFactor);
        srs.repetitions++;
      } else {
        srs.interval = 1; srs.repetitions = 0;
        srs.easeFactor = Math.max(1.3, srs.easeFactor - 0.2);
      }
    });
  });
  if (added > 0) saveState();
  return added;
}
// ===== SRS 间隔重复 (SM-2 算法) =====
function getSRSData(qId) { if (!state.srsData||!state.srsData[qId]) state.srsData[qId]={interval:0,easeFactor:2.5,repetitions:0,nextReview:0}; return state.srsData[qId]; }
function getSrsDueQuestions() { const now=Date.now(); return Object.keys(state.srsData||{}).filter(id=>state.srsData[id].nextReview>0&&state.srsData[id].nextReview<=now); }
function getOverdueCount() { return getSrsDueQuestions().length; }
function updateSrsCard() { /* SRS card moved to subject dashboard, home card removed */ }
function updateSRSAfterExam(as) { if (!state.srsData) state.srsData={}; const now=Date.now(); as.questions.forEach((q,i)=>{ if (!isObjType(q.type)||as.userAnswers[i]===undefined) return; const qId=getQuestionId(as.setId,q); const ci=getCi(q,as.userAnswers[i]); const srs=getSRSData(qId); if (ci===true) { if (srs.repetitions===0) srs.interval=1; else if (srs.repetitions===1) srs.interval=3; else srs.interval=Math.round(srs.interval*srs.easeFactor); srs.repetitions++; } else { srs.interval=1; srs.repetitions=0; srs.easeFactor=Math.max(1.3,srs.easeFactor-0.2); } const days=srs.interval*86400000; srs.nextReview=now+days; }); saveState(); }
function startSrsReview() { const due=getSrsDueQuestions(); if (!due.length) { showToast('暂无待复习题目', 'info'); return; } const questions=[]; due.forEach(qId=>{ for (const cid in state.chapters) { const ch=state.chapters[cid]; if (!ch||!ch.questions) continue; for (const q of ch.questions) { if (getQuestionId(cid,q)===qId) { questions.push({...q,_srsChapterId:cid}); break; } } if (questions.length>0) break; } }); if (!questions.length) { showToast('未找到对应题目数据', 'warning'); return; } const sid=state.currentSubjectId||Object.keys(state.subjects)[0]; const eid='srs_'+Date.now().toString(36); const genExam={id:eid,name:'📅 间隔复习 '+new Date().toLocaleDateString('zh-CN'),type:'srs',subjectId:sid,questions,userAnswers:new Array(questions.length).fill(undefined),currentIdx:0,createdAt:Date.now()}; state.generatedExams[eid]=genExam; state.currentExamId=eid; saveState(); startExamQuiz(eid); }
function startExamQuiz(eid) { const ex=state.generatedExams[eid]; if (!ex) return; state.currentExamId=eid; saveState(); showScreen('quiz'); renderQuestion(); updateProgress(); }
function endExamGenerated(as) { updateSRSAfterExam(as); autoBackup(); checkAchievements(); syncAnswerToServerFinal(); state.currentExamId=null; saveState();
  // Update chapter tags (issue #7)
  if (as.questions && as.questions.length > 0) {
    var taggedChapterId = null;
    as.questions.forEach(function(q) { if (q._srsChapterId && !taggedChapterId) taggedChapterId = q._srsChapterId; });
    if (taggedChapterId && state.chapters[taggedChapterId]) {
      autoUpdateChapterWeakTags(state.chapters[taggedChapterId]);
    }
  }
  renderExamReport(as); }
function renderExamReport(as) { const stats=calcStats(as); const c=document.getElementById('report-content'); if (!c) return; const correctTotal=stats.objCorrect+stats.subjCount; const rate=stats.objTotal>0?Math.round((stats.objCorrect/stats.objTotal)*100):0; let html='<div class="report-grid"><div class="report-stat correct"><div class="num">'+correctTotal+'</div><div class="label">✅ 总正确</div></div><div class="report-stat wrong"><div class="num">'+stats.wrongCount+'</div><div class="label">❌ 错误</div></div><div class="report-stat rate"><div class="num">'+rate+'%</div><div class="label">📊 正确率</div></div><div class="report-stat"><div class="num">'+stats.answered+'/'+stats.total+'</div><div class="label">📝 进度</div></div></div>'; const wrongTags=new Set(); as.questions.forEach((q,i)=>{if(isObjType(q.type)&&as.userAnswers&&as.userAnswers[i]!==undefined&&getCi(q,as.userAnswers[i])===false&&q.tag) wrongTags.add(q.tag);}); if(wrongTags.size>0){html+='<hr style="margin:10px 0;"><div style="padding:8px;background:#fff8f0;border-radius:6px;"><h4 style="color:#c2410c;font-size:14px;margin-bottom:4px;">🏷️ 错题标签</h4><div style="display:flex;flex-wrap:wrap;gap:3px;">';wrongTags.forEach(t=>{html+='<span style="background:#fed7aa;padding:1px 8px;border-radius:12px;font-size:12px;color:#9a3412;">'+escapeHtml(t)+'</span>';});html+='</div></div>';} html+='<hr style="margin:10px 0;"><h4 style="margin-bottom:8px;font-size:15px;">📋 逐题回顾</h4>'; as.questions.forEach((q,i)=>{const ua=as.userAnswers?as.userAnswers[i]:undefined;const ci=ua!==undefined?getCi(q,ua):null;const tm={single:'单选',judge:'判断',term:'名词解释',short:'简答'};let icon='⏳';if(ua!==undefined)icon=ci===true?'✅':(ci===false?'❌':'✅（主观题）');html+='<div class="history-q-item '+(ci===false?'wrong':ci===true?'correct':'')+'"><p class="q-text">'+icon+' ['+(tm[q.type]||q.type)+'] '+(q.tag?escapeHtml(q.tag):'')+' 第'+(i+1)+'题：'+escapeHtml(q.question)+'</p>';if(ua!==undefined){if(q.type==='single'||q.type==='judge'){html+='<p class="q-detail">📝 你答：'+escapeHtml(String(q.options[ua]??''))+' ｜ ✅：'+escapeHtml(String(q.options[q.answer]??''))+'</p>';}else{html+='<p class="q-detail">📝 你的答案：'+escapeHtml(String(ua))+'</p>';}}if(q.explanation)html+='<p class="q-detail">📖 '+escapeHtml(q.explanation)+'</p></div>';}); c.innerHTML=html; showScreen('report'); }
function renderSubjSrsReview(s) {
  const container = document.getElementById('subj-tab-srs-review'); if (!container) return;
  const due = getSrsDueQuestions(); const dueCount = due.length;
  let html = '<div class="card"><h3>📅 间隔复习 — ' + escapeHtml(s.name) + '</h3>';
  html += '<p style="color:#666;font-size:14px;margin:6px 0 12px;">基于 SM-2 算法自动安排复习时间。答对后间隔延长，答错后重新学习。</p>';
  html += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<span style="font-size:15px;font-weight:600;">到期题目：<strong style="color:#e94560;">' + dueCount + '</strong> 道</span>';
  html += '<button class="btn btn-primary btn-small" onclick="startSrsReviewForSubj(\'' + s.id + '\')">📅 复习到期题目</button>';
  html += '</div>';
  html += '<h4 style="font-size:15px;margin:12px 0 8px;">自定义复习 — 选择章节生成复习试卷</h4>';
  html += '<div class="chapter-select-grid" id="srs-chapter-select">';
  s.chapterIds.forEach(cid => { const ch = state.chapters[cid]; if (!ch) return; html += '<div class="chapter-select-item"><input type="checkbox" id="srs-chk-' + cid + '" value="' + cid + '"><label for="srs-chk-' + cid + '">' + escapeHtml(ch.name) + '</label><span class="cs-count">' + (ch.questions ? ch.questions.length : 0) + ' 题</span></div>'; });
  html += '</div>';
  html += '<div class="type-counts" style="margin-top:10px;">';
  html += '<div class="type-count-item"><label>📝 单选</label><input type="number" id="srs-tc-single" min="0" value="5"></div>';
  html += '<div class="type-count-item"><label>⚖️ 判断</label><input type="number" id="srs-tc-judge" min="0" value="3"></div>';
  html += '</div>';
  html += '<div style="margin-top:10px;"><button class="btn btn-warning btn-small" onclick="composeSrsCustom(\'' + s.id + '\')">📝 生成复习试卷</button></div>';
  html += '</div>';
  // 历史试卷列表
  html += '<div class="card" style="margin-top:12px;"><h4 style="font-size:15px;margin-bottom:8px;">📋 历史试卷</h4>';
  html += renderGeneratedExamList(s.id);
  html += '</div>';
  container.innerHTML = html;
}
function renderGeneratedExamList(subjId, typeFilter) {
  const exams = state.generatedExams || {};
  const subjExams = Object.values(exams).filter(e => e.subjectId === subjId && (!typeFilter || e.type === typeFilter)).sort((a, b) => b.createdAt - a.createdAt);
  if (!subjExams.length) return '<div class="empty-state" style="padding:12px;">暂无历史试卷</div>';
  const tm = { exam: '大考卷', srs: '间隔复习' };
  let html = '';
  subjExams.forEach(e => {
    const total = e.questions.length;
    const answered = e.userAnswers.filter(a => a !== undefined).length;
    const isDone = answered >= total;
    const isSrs = e.type === 'srs';
    html += '<div class="restore-list-item" style="cursor:default;">';
    html += '<div class="rli-info">';
    html += '<div class="rli-label">' + (isSrs ? '📅' : '📝') + ' ' + escapeHtml(e.name) + ' <span style="color:#888;">(' + total + '题)</span></div>';
    html += '<div class="rli-date">' + new Date(e.createdAt).toLocaleString('zh-CN') + ' — ' + answered + '/' + total + ' 已答</div>';
    html += '</div>';
    if (isDone) {
      const correctCount = e.questions.filter((q, i) => getCi(q, e.userAnswers[i]) === true).length;
      const rate = total > 0 ? Math.round(correctCount / total * 100) : 0;
      html += '<span style="color:#2ed573;font-weight:600;margin-right:8px;">✅ ' + rate + '%</span>';
      html += '<button class="btn btn-small btn-secondary" onclick="startExamQuiz(\'' + e.id + '\')">查看</button>';
    } else {
      html += '<button class="btn btn-small btn-primary" onclick="startExamQuiz(\'' + e.id + '\')">▶️ 继续作答</button>';
    }
    html += '</div>';
  });
  return html;
}
function composeSrsCustom(subjId) {
  const s = state.subjects[subjId]; if (!s) return;
  const checkedCids = []; document.querySelectorAll('#srs-chapter-select input[type="checkbox"]:checked').forEach(cb => checkedCids.push(cb.value));
  if (!checkedCids.length) { showToast('请至少选择一个章节', 'warning'); return; }
  const ts = parseInt(document.getElementById('srs-tc-single').value) || 0; const tj = parseInt(document.getElementById('srs-tc-judge').value) || 0;
  if (ts + tj === 0) { alert('请设置至少 1 道题'); return; }
  const selected = [];
  checkedCids.forEach(cid => {
    const ch = state.chapters[cid]; if (!ch || !ch.questions) return;
    var s2 = getChStrategy(cid);
    var stratPcts = s2 ? { err: s2.errPct !== undefined ? s2.errPct : 60, review: s2.reviewPct !== undefined ? s2.reviewPct : 20, new: s2.newPct !== undefined ? s2.newPct : 20 } : { err: 60, review: 20, new: 20 };
    const pool = ch.questions.filter(q => (q.type === 'single' || q.type === 'judge') && !isQuestionIgnored(cid, q));
    var stratPick = function(typePool, count) {
      if (count <= 0 || typePool.length === 0) return [];
      var errorP = typePool.filter(function(q) { return q.strategy === 'error'; });
      var reviewP = typePool.filter(function(q) { return q.strategy === 'review'; });
      var newP2 = typePool.filter(function(q) { return q.strategy === 'new'; });
      var errT = Math.round(count * (stratPcts.err || 60) / 100);
      var revT = Math.round(count * (stratPcts.review || 20) / 100);
      var newT = count - errT - revT;
      var sel = [];
      sel = sel.concat(pickRandom(errorP, errT));
      sel = sel.concat(pickRandom(reviewP, revT));
      sel = sel.concat(pickRandom(newP2, newT));
      var deficit = count - sel.length;
      if (deficit > 0) {
        var remaining = typePool.filter(function(q) { return sel.indexOf(q) < 0; });
        sel = sel.concat(pickRandom(remaining, deficit));
      }
      return sel;
    };
    const singlePool = pool.filter(q => q.type === 'single');
    const judgePool = pool.filter(q => q.type === 'judge');
    selected.push(...stratPick(singlePool, ts));
    selected.push(...stratPick(judgePool, tj));
  });
  if (!selected.length) { showToast('所选章节没有可用题目', 'warning'); return; }
  const eid = 'srs_' + Date.now().toString(36);
  const genExam = { id: eid, name: '📅 自定义复习 ' + new Date().toLocaleDateString('zh-CN'), type: 'srs', subjectId: subjId, questions: selected, userAnswers: new Array(selected.length).fill(undefined), currentIdx: 0, createdAt: Date.now() };
  state.generatedExams[eid] = genExam; state.currentExamId = eid; saveState();
  startExamQuiz(eid); renderSubjSrsReview(s);
  showToast('复习试卷已生成：共 ' + selected.length + ' 题', 'success');
}
function startSrsReviewForSubj(subjId) {
  const s = state.subjects[subjId]; if (!s) return;
  const subjChapterIds = s.chapterIds;
  const now = Date.now();
  const due = getSrsDueQuestions().filter(qId => {
    return subjChapterIds.some(cid => qId.startsWith(cid + ':'));
  });
  if (!due.length) { showToast('本科目暂无待复习题目', 'info'); return; }
  const questions = [];
  due.forEach(qId => {
    for (const cid of subjChapterIds) {
      const ch = state.chapters[cid]; if (!ch || !ch.questions) continue;
      for (const q of ch.questions) { if (getQuestionId(cid, q) === qId) { questions.push({ ...q, _srsChapterId: cid }); break; } }
      if (questions.length > 0) break;
    }
  });
  if (!questions.length) { showToast('未找到对应题目数据', 'warning'); return; }
  const eid = 'srs_' + Date.now().toString(36);
  const genExam = { id: eid, name: '📅 间隔复习 ' + new Date().toLocaleDateString('zh-CN'), type: 'srs', subjectId: subjId, questions, userAnswers: new Array(questions.length).fill(undefined), currentIdx: 0, createdAt: Date.now() };
  state.generatedExams[eid] = genExam; state.currentExamId = eid; saveState();
  startExamQuiz(eid);
}
