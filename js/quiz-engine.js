// --- Server answer recovery (called on init) ---
async function restoreQuizFromServer() {
  if (!isOnlineMode || !getToken()) return;
  var as = getActiveSet();
  if (!as || !as.questions || !as.questions.length) return;
  var ch = getCh();
  var chapterId = as.setId || (ch ? ch.id : null);
  if (!chapterId) return;
  try {
    var sRes = await fetchWithAuth('/quiz/sessions');
    if (!sRes || !sRes.ok) return;
    var sData = await sRes.json();
    var sessions = sData.sessions || [];
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].chapterId === chapterId) {
        var dRes = await fetchWithAuth('/quiz/session/' + sessions[i].id);
        if (!dRes || !dRes.ok) return;
        var dData = await dRes.json();
        var srv = dData.session;
        if (srv && srv.userAnswers && Array.isArray(srv.userAnswers)) {
          // Merge: server answers win for already-answered positions
          // Also restore from server if local has fewer answers
          for (var j = 0; j < as.userAnswers.length && j < srv.userAnswers.length; j++) {
            var srvAns = srv.userAnswers[j];
            if (srvAns !== null && srvAns !== undefined) {
              as.userAnswers[j] = srvAns;
            }
          }
          saveState();
        }
        break;
      }
    }
  } catch(e) { console.warn('restoreQuizFromServer failed:', e); }
}

// --- Server answer sync (throttled) ---
var _lastSyncTime = 0;
var _syncPending = null;
function syncAnswerToServer() {
  if (!isOnlineMode || !getToken()) return;
  var now = Date.now();
  if (now - _lastSyncTime < 5000) {
    // Throttle: schedule a trailing sync
    if (_syncPending) clearTimeout(_syncPending);
    _syncPending = setTimeout(syncAnswerToServer, 5000 - (now - _lastSyncTime));
    return;
  }
  _lastSyncTime = now;
  var as = getActiveSet();
  if (!as || !as.questions || !as.questions.length) return;
  var ch = getCh();
  var chapterId = as.setId || (ch ? ch.id : null);
  if (!chapterId) return;
  var stats = calcStats(as);
  fetchWithAuth('/quiz/session', {
    method: 'POST',
    body: JSON.stringify({
      chapterId: chapterId,
      sessionName: as.setName || (ch ? ch.name : ''),
      questions: as.questions,
      userAnswers: as.userAnswers,
      stats: stats
    })
  }).catch(function(e) { console.warn('syncAnswerToServer failed:', e); });
}
async function syncAnswerToServerFinal() {
  if (!isOnlineMode || !getToken()) return;
  if (_syncPending) { clearTimeout(_syncPending); _syncPending = null; }
  _lastSyncTime = 0;
  var as = getActiveSet();
  if (!as || !as.questions || !as.questions.length) return;
  var ch = getCh();
  var chapterId = as.setId || (ch ? ch.id : null);
  if (!chapterId) return;
  var stats = calcStats(as);
  try {
    await fetchWithAuth('/quiz/session', {
      method: 'POST',
      body: JSON.stringify({
        chapterId: chapterId,
        sessionName: as.setName || (ch ? ch.name : ''),
        questions: as.questions,
        userAnswers: as.userAnswers,
        stats: stats
      })
    });
  } catch(e) { console.warn('syncAnswerToServerFinal failed:', e); }
}

function renderQuestion() {
  const as = getActiveSet(); const area = document.getElementById('question-area'); const tagEl = document.getElementById('quiz-tag'), typeEl = document.getElementById('quiz-type'); const navEl = document.getElementById('quiz-nav'), sb = document.getElementById('btn-submit'), nx = document.getElementById('btn-next');
  if (!as||!as.questions||!as.questions.length) { if (area) area.innerHTML = '<div class="empty-state">📭 暂无题目</div>'; if (sb) sb.style.display='none'; if (nx) { nx.style.display='none'; nx.onclick=null; } if (tagEl) tagEl.textContent='标签'; if (typeEl) typeEl.textContent='题型'; if (navEl) navEl.innerHTML=''; return; }
  if (as.currentIdx>=as.questions.length) as.setCurrentIdx(as.questions.length-1); if (as.currentIdx<0) as.setCurrentIdx(0);
  const qi = as.currentIdx;
  const q = as.questions[qi]; if (!q) { if (area) area.innerHTML='<div class="empty-state">🎉 全部完成</div>'; return; }
  const typeMap = { single:'单选题', judge:'判断题', term:'名词解释', short:'简答题' };
  if (tagEl) tagEl.textContent = as.setName||'未标注'; if (typeEl) typeEl.textContent = typeMap[q.type]||q.type;
  const hasAns = as.userAnswers[qi] !== undefined; const isCor = hasAns ? getCi(q, as.userAnswers[qi]) : null;
  let html = '<div class="quiz-question"><strong>'+(qi+1)+'. </strong>'+renderMarkdown(q.question)+'</div>';
  if (q.type==='single'||q.type==='judge') {
    html += '<div class="quiz-options">';
    q.options.forEach((opt,idx) => { let cls = 'quiz-option'; if (hasAns) cls+=' disabled'; if (hasAns&&idx===as.userAnswers[as.currentIdx]) cls+=isCor?' correct':' wrong'; if (hasAns&&idx===q.answer) cls+=' correct'; if (!hasAns&&as.userAnswers[as.currentIdx]===idx) cls+=' selected'; html += '<div class="'+cls+'" onclick="'+(hasAns?'':'selectOption('+idx+')')+'">'+String.fromCharCode(65+idx)+'. '+renderMarkdown(opt)+'</div>'; });
    html += '</div>';
  } else { html += '<div class="quiz-options"><textarea style="width:100%;min-height:60px;padding:8px;border:1px solid #dee2e6;border-radius:5px;font-size:15px;font-family:inherit;" placeholder="输入你的答案..." id="subjective-answer"'+(hasAns?' disabled':'')+'>'+(hasAns?escapeHtml(as.userAnswers[as.currentIdx]||''):'')+'</textarea></div>'; }
  if (hasAns&&q.explanation) html += '<div class="explanation-box"><h4>📖 参考答案</h4><p>'+renderMarkdown(q.explanation)+'</p></div>';
  if (area) area.innerHTML = html;
  if (navEl) { navEl.innerHTML = as.questions.map((q2,idx) => { let cls='dot'; if (idx===as.currentIdx) cls+=' current'; if(isQuestionIgnored(as.setId,q2))cls+=' ignored'; if (as.userAnswers[idx]!==undefined) cls+=getCi(as.questions[idx],as.userAnswers[idx])?' answered':' wrong'; return '<div class="'+cls+'" onclick="goToQuestion('+idx+')">'+(idx+1)+'</div>'; }).join(''); }
  if (sb) sb.style.display = hasAns?'none':'inline-block'; const ig=document.getElementById('btn-ignore'); if(ig)ig.style.display=(hasAns||isQuestionIgnored(as.setId,q))?'none':'inline-block';
  if (nx) { if (hasAns&&as.currentIdx<as.questions.length-1) { nx.style.display='inline-block'; nx.textContent='下一题 ➡️'; nx.onclick=nextQuestion; } else if (hasAns&&as.currentIdx>=as.questions.length-1) { nx.style.display='inline-block'; nx.textContent='结束 📊'; nx.onclick=endExam; } else nx.style.display='none'; }
  applyQuizFontSize();
}
function selectOption(idx) { const as=getActiveSet(); if (!as||as.userAnswers[as.currentIdx]!==undefined) return; as.userAnswers[as.currentIdx]=idx; saveState(); renderQuestion(); }
function submitAnswer() {
  const as=getActiveSet(); if (!as||!as.questions||!as.questions.length) return;
  const q=as.questions[as.currentIdx]; if (!q||as.userAnswers[as.currentIdx]!==undefined) return;
  if (q.type==='term'||q.type==='short') { const ta=document.getElementById('subjective-answer'); if (!ta||!ta.value.trim()) { alert('请输入答案'); return; } as.userAnswers[as.currentIdx]=ta.value.trim(); }
  else { if (as.userAnswers[as.currentIdx]===undefined) { alert('请选择选项'); return; } }
  saveState(); renderQuestion(); updateProgress(); updateQuickActions(); checkAchievements(); syncAnswerToServer();
}
function nextQuestion() { const as=getActiveSet(); if (!as) return; if (as.currentIdx<as.questions.length-1) { as.setCurrentIdx(as.currentIdx+1); saveState(); renderQuestion(); updateProgress(); } }
function goToQuestion(idx) { const as=getActiveSet(); if (!as||idx<0||idx>=as.questions.length) return; as.setCurrentIdx(idx); saveState(); renderQuestion(); updateProgress(); }
function endExam() { const as=getActiveSet(); if (!as) return; if (as._isSet) { endQuizSession(); } else if (as.isExam) { endExamGenerated(as); } else { const ch=as; autoUpdateChapterWeakTags(ch); saveQuizHistory(ch); updateSRSAfterExam(ch); autoBackup(); checkAchievements(); syncAnswerToServerFinal(); openQuizModal("report"); renderReport(); } }
function resetQuiz() { const as=getActiveSet(); if (!as) return; if (as._isSet) { as.userAnswers=new Array(as.questions.length).fill(undefined); as.setCurrentIdx(0); saveState(); openQuizModal('quiz'); renderQuestion(); updateProgress(); return; } as.userAnswers=new Array(as.questions.length).fill(undefined); as.setCurrentIdx(0); saveState(); renderQuestion(); updateProgress(); closeQuizModal(); showScreen('start'); updateQuickActions(); }
function autoUpdateChapterWeakTags(ch) {
  ch = ch || getCh();
  if (!ch) return;
  const s = getChStrategy(ch.id);
  if (!s) return;
  const tagResults = {};
  const quizSets = ch.quizSets || [];
  quizSets.forEach(set => {
    (set.questions || []).forEach((q, qi) => {
      if (!q.tag || !isObjType(q.type) || set.userAnswers[qi] === undefined) return;
      if (!tagResults[q.tag]) tagResults[q.tag] = { correct: 0, total: 0 };
      tagResults[q.tag].total++;
      if (getCi(q, set.userAnswers[qi]) === true) tagResults[q.tag].correct++;
    });
  });
  for (const tag in tagResults) {
    const r = tagResults[tag];
    if (r.correct === r.total) s.weakTags = s.weakTags.filter(t => t.name !== tag);
    else if (!s.weakTags.some(t => t.name === tag)) s.weakTags.push({ name: tag, active: true });
  }
  saveState(); renderChapterTags(); updateChapterPromptTemplate();
}
function calcStats(as) { if (!as||!as.questions) return {total:0,answered:0,objCorrect:0,objTotal:0,wrongCount:0,subjCount:0}; let total=as.questions.length,answered=0,objCorrect=0,objTotal=0,wrongCount=0,subjCount=0; as.questions.forEach((q,i)=>{ if(as.userAnswers&&as.userAnswers[i]!==undefined) answered++; if(isObjType(q.type)){objTotal++;if(as.userAnswers&&as.userAnswers[i]!==undefined){const ci=getCi(q,as.userAnswers[i]);if(ci===true)objCorrect++;else if(ci===false)wrongCount++;}} else {if(as.userAnswers&&as.userAnswers[i]!==undefined)subjCount++;}}); return {total,answered,objCorrect,objTotal,wrongCount,subjCount}; }
function updateProgress() { const as=getActiveSet(); const stats=calcStats(as); const pct=stats.total>0?Math.round((stats.answered/stats.total)*100):0; const rate=stats.objTotal>0?Math.round((stats.objCorrect/stats.objTotal)*100):(stats.total>0&&stats.answered===stats.total?100:0); const pf=document.getElementById('progress-fill'); if(pf)pf.style.width=pct+'%'; const rd=document.getElementById('rate-display'); if(rd)rd.textContent=rate+'%'; const pd=document.getElementById('progress-display'); if(pd)pd.textContent=stats.answered+'/'+stats.total; const wd=document.getElementById('wrong-display'); if(wd)wd.textContent=stats.wrongCount; }