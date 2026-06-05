// --- Server answer recovery (called on init) ---
async function restoreQuizFromServer() {
  if (!isOnlineMode || !getToken()) return;
  var as = getActiveSet();
  var ch = getCh();
  var chapterId = as ? (as.setId || (ch ? ch.id : null)) : (ch ? ch.id : null);
  if (!chapterId) return;
  try {
    // Only fetch in_progress sessions for recovery
    var sRes = await fetchWithAuth('/quiz/sessions?status=in_progress');
    if (!sRes || !sRes.ok) return;
    var sData = await sRes.json();
    var sessions = sData.sessions || [];
    // Find session matching this chapter, prefer most recent (already sorted by updated_at DESC)
    var targetSession = null;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].chapterId === chapterId) {
        targetSession = sessions[i];
        break;
      }
    }
    if (!targetSession) return;
    var dRes = await fetchWithAuth('/quiz/session/' + targetSession.id);
    if (!dRes || !dRes.ok) return;
    var dData = await dRes.json();
    var srv = dData.session;
    if (!srv || !srv.userAnswers || !Array.isArray(srv.userAnswers)) return;
    var srvQs = srv.questions || [];

    // If local has no questions, repopulate from server (cross-device restore)
    if (!as || !as.questions || !as.questions.length) {
      if (srvQs.length > 0 && ch) {
        // Create a quizSet from server questions
        if (!ch.quizSets) ch.quizSets = [];
        // Check if a matching set already exists (same question count)
        var existingSet = ch.quizSets.length > 0 ? ch.quizSets[ch.quizSets.length - 1] : null;
        // Create new set or reuse last one
        var cleanAnswers = srv.userAnswers.map(function(a) { return a === null ? undefined : a; });
        var set = { questions: srvQs.slice(), userAnswers: cleanAnswers, currentIdx: 0, createdAt: Date.now() };
        ch.quizSets.push(set);
        ch.currentQuizSetIdx = ch.quizSets.length - 1;
        // Sync to ch.questions for backward compat
        if (!ch.questions) ch.questions = [];
        ch.questions = srvQs.slice();
        if (!ch.userAnswers) ch.userAnswers = [];
        ch.userAnswers = cleanAnswers;
        saveState();
        console.log('restoreQuizFromServer: repopulated quizSet from server (' + srvQs.length + ' questions, ' + targetSession.answeredCount + ' answered)');
        return;
      }
      return;
    }

    // Validate server questions match local questions by text, avoiding cross-round merge
    if (srvQs.length !== as.questions.length) {
      console.warn('restoreQuizFromServer: question count mismatch, skipping merge (server=' + srvQs.length + ', local=' + as.questions.length + ')');
      return;
    }
    var contentMismatch = false;
    for (var qi = 0; qi < as.questions.length; qi++) {
      if ((srvQs[qi] && srvQs[qi].question) !== (as.questions[qi] && as.questions[qi].question)) {
        contentMismatch = true;
        break;
      }
    }
    if (contentMismatch) {
      console.warn('restoreQuizFromServer: question content mismatch, skipping merge');
      return;
    }
    for (var j = 0; j < as.userAnswers.length && j < srv.userAnswers.length; j++) {
      var srvAns = srv.userAnswers[j];
      // Skip -1 (finalize marker) and null/undefined
      if (srvAns !== -1 && srvAns !== null && srvAns !== undefined) {
        var localAns = as.userAnswers[j];
        if (localAns === undefined || localAns === -1 || localAns === null) {
          as.userAnswers[j] = srvAns;
        }
      }
      // Normalize any null values to undefined (JSON null from server)
      if (as.userAnswers[j] === null) as.userAnswers[j] = undefined;
    }
    saveState();
  } catch(e) { console.warn('restoreQuizFromServer failed:', e); }
}

// --- Server answer sync (throttled) ---
var _lastSyncTime = 0;
var _syncPending = null;
var _firstSyncDone = false;
function syncAnswerToServer() {
  if (!isOnlineMode || !getToken()) return;
  var now = Date.now();
  if (!_firstSyncDone) {
    _firstSyncDone = true;
    // First sync of this session: execute immediately
  } else if (now - _lastSyncTime < 5000) {
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
  var subj = getSubj();
  var subjectId = (as.subjectId) || (subj ? subj.id : null);
  var stats = calcStats(as);
  // Filter out -1 markers from synced answers
  var syncAnswers = as.userAnswers.map(function(a) { return (a === -1 || a === null) ? undefined : a; });
  fetchWithAuth('/quiz/session', {
    method: 'POST',
    body: JSON.stringify({
      chapterId: chapterId,
      subjectId: subjectId,
      setId: as.setId,
      sessionName: as.setName || (ch ? ch.name : ''),
      questions: as.questions,
      userAnswers: syncAnswers,
      stats: stats,
      status: 'in_progress'
    })
  }).catch(function(e) { console.warn('syncAnswerToServer failed:', e); });
}

// --- Page lifecycle: force immediate sync before page unload ---
function _flushSyncBeforeUnload() {
    if (_syncPending) { clearTimeout(_syncPending); _syncPending = null; }
    _firstSyncDone = true;
    _lastSyncTime = 0;
    syncAnswerToServer();
}
window.addEventListener('beforeunload', function() {
    _flushSyncBeforeUnload();
});
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
        _flushSyncBeforeUnload();
    }
});

async function syncAnswerToServerFinal() {
  if (!isOnlineMode || !getToken()) return;
  if (_syncPending) { clearTimeout(_syncPending); _syncPending = null; }
  _lastSyncTime = 0;
  _firstSyncDone = false;
  var as = getActiveSet();
  if (!as || !as.questions || !as.questions.length) return;
  var ch = getCh();
  var chapterId = as.setId || (ch ? ch.id : null);
  if (!chapterId) return;
  var subj = getSubj();
  var subjectId = (as.subjectId) || (subj ? subj.id : null);
  var stats = calcStats(as);
  try {
    await fetchWithAuth('/quiz/session', {
      method: 'POST',
      body: JSON.stringify({
        chapterId: chapterId,
        subjectId: subjectId,
        setId: as.setId,
        sessionName: as.setName || (ch ? ch.name : ''),
        questions: as.questions,
        userAnswers: as.userAnswers,
        stats: stats,
        status: 'completed'
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
  const ans = as.userAnswers[qi]; const hasAns = ans !== undefined && ans !== -1 && ans !== null; const isCor = hasAns ? getCi(q, as.userAnswers[qi]) : null;
  let html = '<div class="quiz-question"><strong>'+(qi+1)+'. </strong>'+renderMarkdown(q.question)+'</div>';
  if (q.type==='single'||q.type==='judge') {
    html += '<div class="quiz-options">';
    q.options.forEach((opt,idx) => { let cls = 'quiz-option'; if (hasAns) cls+=' disabled'; if (hasAns&&idx===as.userAnswers[as.currentIdx]) cls+=isCor?' correct':' wrong'; if (hasAns&&idx===q.answer) cls+=' correct'; if (!hasAns&&as.userAnswers[as.currentIdx]===idx) cls+=' selected'; html += '<div class="'+cls+'" onclick="'+(hasAns?'':'selectOption('+idx+')')+'">'+String.fromCharCode(65+idx)+'. '+renderMarkdown(opt)+'</div>'; });
    html += '</div>';
  } else { html += '<div class="quiz-options"><textarea style="width:100%;min-height:60px;padding:8px;border:1px solid #dee2e6;border-radius:5px;font-size:15px;font-family:inherit;" placeholder="输入你的答案..." id="subjective-answer"'+(hasAns?' disabled':'')+'>'+(hasAns?escapeHtml(as.userAnswers[as.currentIdx]||''):'')+'</textarea></div>'; }
  if (hasAns&&q.explanation) html += '<div class="explanation-box"><h4>📖 参考答案</h4><p>'+renderMarkdown(q.explanation)+'</p></div>';
  if (area) area.innerHTML = html;
  if (navEl) { navEl.innerHTML = as.questions.map((q2,idx) => { let cls='dot'; if (idx===as.currentIdx) cls+=' current'; if(isQuestionIgnored(as.setId,q2))cls+=' ignored'; if (as.userAnswers[idx]!==undefined&&as.userAnswers[idx]!==null) cls+=getCi(as.questions[idx],as.userAnswers[idx])?' answered':' wrong'; return '<div class="'+cls+'" onclick="goToQuestion('+idx+')">'+(idx+1)+'</div>'; }).join(''); }
  if (sb) sb.style.display = hasAns?'none':'inline-block'; const ig=document.getElementById('btn-ignore'); if(ig)ig.style.display=(hasAns||isQuestionIgnored(as.setId,q))?'none':'inline-block';
  if (nx) { if (hasAns&&as.currentIdx<as.questions.length-1) { nx.style.display='inline-block'; nx.textContent='下一题 ➡️'; nx.onclick=nextQuestion; } else if (hasAns&&as.currentIdx>=as.questions.length-1) { nx.style.display='inline-block'; nx.textContent='结束 📊'; nx.onclick=endExam; } else nx.style.display='none'; }
  applyQuizFontSize();
}
function selectOption(idx) { const as=getActiveSet(); if (!as||(as.userAnswers[as.currentIdx]!==undefined&&as.userAnswers[as.currentIdx]!==null)) return; as.userAnswers[as.currentIdx]=idx; saveState(); renderQuestion(); syncAnswerToServer(); }
function submitAnswer() {
  const as=getActiveSet(); if (!as||!as.questions||!as.questions.length) return;
  const q=as.questions[as.currentIdx]; if (!q||(as.userAnswers[as.currentIdx]!==undefined&&as.userAnswers[as.currentIdx]!==null)) return;
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
function calcStats(as) { if (!as||!as.questions) return {total:0,answered:0,objCorrect:0,objTotal:0,wrongCount:0,subjCount:0}; let total=as.questions.length,answered=0,objCorrect=0,objTotal=0,wrongCount=0,subjCount=0; as.questions.forEach((q,i)=>{ var ans = as.userAnswers && as.userAnswers[i]; if(ans !== undefined && ans !== -1) answered++; if(isObjType(q.type)){objTotal++;if(ans !== undefined && ans !== -1){const ci=getCi(q,ans);if(ci===true)objCorrect++;else if(ci===false)wrongCount++;}} else {if(ans !== undefined && ans !== -1)subjCount++;}}); return {total,answered,objCorrect,objTotal,wrongCount,subjCount}; }

function calcChapterStats(chapterId) {
  var result = { total: 0, answered: 0, objCorrect: 0, objTotal: 0, wrongCount: 0, subjCount: 0, completedSets: 0 };
  var ch = state.chapters[chapterId];
  if (!ch || !ch.quizSets) return result;
  ch.quizSets.forEach(function(set) {
    var stats = calcStats(set);
    // Only count completed sets (all questions answered, no -1 markers)
    if (stats.answered >= stats.total && stats.total > 0) {
      result.total += stats.total;
      result.answered += stats.answered;
      result.objCorrect += stats.objCorrect;
      result.objTotal += stats.objTotal;
      result.wrongCount += stats.wrongCount;
      result.subjCount += stats.subjCount;
      result.completedSets++;
    }
  });
  return result;
}

function updateProgress() { updateChapterProgress(); }

function updateChapterProgress() {
  var ch = getCh();
  var stats;
  if (ch && ch.quizSets && ch.quizSets.length > 0) {
    stats = calcChapterStats(ch.id);
    // If no completed sets, show 0-based stats for the chapter
    if (stats.completedSets === 0) {
      stats.total = 0; stats.answered = 0; stats.objCorrect = 0; stats.objTotal = 0; stats.wrongCount = 0;
      // Sum total questions across all sets (for display)
      ch.quizSets.forEach(function(set) { stats.total += (set.questions ? set.questions.length : 0); });
    }
  } else {
    var as = getActiveSet();
    stats = calcStats(as);
  }
  var pct = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0;
  var rate = stats.objTotal > 0 ? Math.round((stats.objCorrect / stats.objTotal) * 100) : 0;
  var pf = document.getElementById('progress-fill');
  if (pf) pf.style.width = pct + '%';
  var rd = document.getElementById('rate-display');
  if (rd) rd.textContent = rate + '%';
  var pd = document.getElementById('progress-display');
  if (pd) pd.textContent = stats.total + ' 题';
  var wd = document.getElementById('wrong-display');
  if (wd) wd.textContent = stats.wrongCount;
}