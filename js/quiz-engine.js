// --- Server answer recovery (called on init) ---
// restoreAll: when true, restore all chapters with in_progress sessions
async function restoreQuizFromServer(restoreAll) {
  if (!isOnlineMode || !getToken()) return;
  try {
    var sRes = await fetchWithAuth('/quiz/sessions?status=in_progress');
    if (!sRes || !sRes.ok) return;
    var sData = await sRes.json();
    var sessions = sData.sessions || [];
    if (sessions.length === 0) return;

    if (restoreAll) {
      // Restore ALL chapters with in_progress sessions
      for (var si = 0; si < sessions.length; si++) {
        await _restoreOneSession(sessions[si]);
      }
    } else {
      // Restore only current chapter's session
      var as = getActiveSet();
      var ch = getCh();
      var chapterId = as ? (as.setId || (ch ? ch.id : null)) : (ch ? ch.id : null);
      if (!chapterId) return;
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].chapterId === chapterId) {
          await _restoreOneSession(sessions[i]);
          break;
        }
      }
    }
  } catch(e) { console.warn('restoreQuizFromServer failed:', e); }
}

async function _restoreOneSession(sessionMeta) {
  var dRes = await fetchWithAuth('/quiz/session/' + sessionMeta.id);
  if (!dRes || !dRes.ok) return;
  var dData = await dRes.json();
  var srv = dData.session;
  if (!srv || !srv.userAnswers || !Array.isArray(srv.userAnswers)) return;
  var srvQs = srv.questions || [];
  if (srvQs.length === 0) return;

  var ch = state.chapters[sessionMeta.chapterId];
  if (!ch) return;
  if (!ch.quizSets) ch.quizSets = [];

  // Find matching quizSet by question count and first-question content
  var matchingSet = null;
  for (var si = ch.quizSets.length - 1; si >= 0; si--) {
    var qs = ch.quizSets[si];
    if (qs.questions.length === srvQs.length) {
      if (qs.questions[0] && srvQs[0] && qs.questions[0].question === srvQs[0].question) {
        matchingSet = qs;
        break;
      }
    }
  }

  if (matchingSet) {
    // Merge answers from server into local quizSet
    var as = matchingSet;
    for (var j = 0; j < as.userAnswers.length && j < srv.userAnswers.length; j++) {
      var srvAns = srv.userAnswers[j];
      if (srvAns !== -1 && srvAns !== null && srvAns !== undefined) {
        var localAns = as.userAnswers[j];
        if (localAns === undefined || localAns === -1 || localAns === null) {
          as.userAnswers[j] = srvAns;
        }
      }
      if (as.userAnswers[j] === null) as.userAnswers[j] = undefined;
    }
    // Update currentIdx if needed
    if (ch.currentQuizSetIdx !== ch.quizSets.indexOf(matchingSet)) {
      ch.currentQuizSetIdx = ch.quizSets.indexOf(matchingSet);
    }
    console.log('restoreQuizFromServer: merged answers for chapter ' + (ch.name || sessionMeta.chapterId) + ' (' + srvQs.length + ' questions)');
  } else if (srvQs.length > 0) {
    // No matching local set — create one from server data (cross-device restore)
    var cleanAnswers = srv.userAnswers.map(function(a) { return a === null ? undefined : a; });
    var newSet = { questions: srvQs.slice(), userAnswers: cleanAnswers, currentIdx: 0, createdAt: Date.now() };
    ch.quizSets.push(newSet);
    ch.currentQuizSetIdx = ch.quizSets.length - 1;
    if (!ch.questions) ch.questions = [];
    ch.questions = srvQs.slice();
    if (!ch.userAnswers) ch.userAnswers = [];
    ch.userAnswers = cleanAnswers;
    console.log('restoreQuizFromServer: created quizSet for chapter ' + (ch.name || sessionMeta.chapterId) + ' (' + srvQs.length + ' questions)');
  }
  saveState();
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
  // Auto-complete if all questions answered (prevents stale in_progress sessions)
  var answered = syncAnswers.filter(function(a) { return a !== undefined; }).length;
  var syncStatus = (answered >= as.questions.length) ? 'completed' : 'in_progress';
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
      status: syncStatus
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


// Keyboard shortcuts for quiz
var _quizKeyHandler = null;
function setupQuizKeyboard() {
  if (_quizKeyHandler) document.removeEventListener('keydown', _quizKeyHandler);
  _quizKeyHandler = function(e) {
    var quizModal = document.getElementById('quiz-modal');
    if (!quizModal || !quizModal.classList.contains('active')) return;
    // Don't intercept when typing in textarea
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    var as = getActiveSet();
    if (!as) return;
    var q = as.questions[as.currentIdx];
    if (!q) return;
    var hasAns = as.userAnswers[as.currentIdx] !== undefined && as.userAnswers[as.currentIdx] !== -1 && as.userAnswers[as.currentIdx] !== null;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (hasAns && as.currentIdx < as.questions.length - 1) nextQuestion();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (as.currentIdx > 0) goToQuestion(as.currentIdx - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!hasAns) submitAnswer();
      else if (as.currentIdx >= as.questions.length - 1) endExam();
      else nextQuestion();
    }
    // Number keys 1-4 for option selection
    if (!hasAns && (q.type === 'single' || q.type === 'judge')) {
      var numKeys = { '1': 0, '2': 1, '3': 2, '4': 3 };
      if (e.key in numKeys && numKeys[e.key] < (q.options ? q.options.length : 0)) {
        e.preventDefault();
        selectOption(numKeys[e.key]);
      }
      // A-D keys for options too
      var letterKeys = { 'a': 0, 'b': 1, 'c': 2, 'd': 3 };
      if (e.key.toLowerCase() in letterKeys && letterKeys[e.key.toLowerCase()] < (q.options ? q.options.length : 0)) {
        e.preventDefault();
        selectOption(letterKeys[e.key.toLowerCase()]);
      }
    }
  };
  document.addEventListener('keydown', _quizKeyHandler);
}
// Initialize keyboard shortcuts
setupQuizKeyboard();

function renderQuestion() {
  const as = getActiveSet(); const area = document.getElementById('question-area'); const tagEl = document.getElementById('quiz-tag'), typeEl = document.getElementById('quiz-type'); const navEl = document.getElementById('quiz-nav'), sb = document.getElementById('btn-submit'), nx = document.getElementById('btn-next');
  if (!as||!as.questions||!as.questions.length) { if (area) area.innerHTML = '<div class="empty-state">📭 暂无题目</div>'; if (sb) sb.style.display='none'; if (nx) { nx.style.display='none'; nx.onclick=null; } if (tagEl) tagEl.textContent='标签'; if (typeEl) typeEl.textContent='题型'; if (navEl) navEl.innerHTML=''; var sh=document.getElementById('btn-share-quiz'); if(sh)sh.style.display='none'; return; }
  if (as.currentIdx>=as.questions.length) as.setCurrentIdx(as.questions.length-1); if (as.currentIdx<0) as.setCurrentIdx(0);
  const qi = as.currentIdx;
  const q = as.questions[qi]; if (!q) { if (area) area.innerHTML='<div class="empty-state">🎉 全部完成</div>'; var sh2=document.getElementById('btn-share-quiz'); if(sh2)sh2.style.display='none'; return; }
  const typeMap = { single:'单选题', judge:'判断题', term:'名词解释', short:'简答题' };
  if (tagEl) tagEl.textContent = as.setName||'未标注'; if (typeEl) typeEl.textContent = typeMap[q.type]||q.type;
  const ans = as.userAnswers[qi]; const hasAns = ans !== undefined && ans !== -1 && ans !== null; const isCor = hasAns ? getCi(q, as.userAnswers[qi]) : null;
  let html = '<div class="quiz-question"><strong>'+(qi+1)+'. </strong>'+renderMarkdown(q.question)+'</div>';
  if ((q.type==='single'||q.type==='judge') && q.options && Array.isArray(q.options) && q.options.length > 0) {
    html += '<div class="quiz-options">';
    q.options.forEach((opt,idx) => { let cls = 'quiz-option'; if (hasAns) cls+=' disabled'; if (hasAns&&idx===as.userAnswers[as.currentIdx]) cls+=isCor?' correct':' wrong'; if (hasAns&&idx===q.answer) cls+=' correct'; if (!hasAns&&as.userAnswers[as.currentIdx]===idx) cls+=' selected'; html += '<div class="'+cls+'" onclick="'+(hasAns?'':'selectOption('+idx+')')+'">'+String.fromCharCode(65+idx)+'. '+renderMarkdown(opt)+'</div>'; });
    html += '</div>';
  } else { html += '<div class="quiz-options"><textarea style="width:100%;min-height:60px;padding:8px;border:1px solid #dee2e6;border-radius:5px;font-size:15px;font-family:inherit;" placeholder="输入你的答案..." id="subjective-answer"'+(hasAns?' disabled':'')+'>'+(hasAns?escapeHtml(as.userAnswers[as.currentIdx]||''):'')+'</textarea></div>'; }
  if (hasAns&&q.explanation) html += '<div class="explanation-box"><h4>📖 参考答案</h4><p>'+renderMarkdown(q.explanation)+'</p></div>';
  if (area) area.innerHTML = html;
  if (navEl) { navEl.innerHTML = as.questions.map((q2,idx) => { let cls='dot'; if (idx===as.currentIdx) cls+=' current'; if(isQuestionIgnored(as.setId,q2))cls+=' ignored'; if (as.userAnswers[idx]!==undefined&&as.userAnswers[idx]!==null) cls+=getCi(as.questions[idx],as.userAnswers[idx])?' answered':' wrong'; return '<div class="'+cls+'" onclick="goToQuestion('+idx+')">'+(idx+1)+'</div>'; }).join(''); }
  if (sb) sb.style.display = hasAns?'none':'inline-block'; var ig=document.getElementById('btn-ignore'); if(ig){ig.style.display=(hasAns||isQuestionIgnored(as.setId,q))?'none':'inline-block';ig.textContent='👍 我会了';} var dk=document.getElementById('btn-dont-know'); if(dk){var isObj2=q.type==='single'||q.type==='judge';dk.style.display=(!hasAns&&isObj2&&!isQuestionIgnored(as.setId,q))?'inline-block':'none';}
  var sq=document.getElementById('btn-share-quiz'); if(sq)sq.style.display='inline-block';
  if (nx) { if (hasAns&&as.currentIdx<as.questions.length-1) { nx.style.display='inline-block'; nx.textContent='下一题 ➡️'; nx.onclick=nextQuestion; } else if (hasAns&&as.currentIdx>=as.questions.length-1) { nx.style.display='inline-block'; nx.textContent='结束 📊'; nx.onclick=endExam; } else nx.style.display='none'; }

  applyQuizFontSize();
}
function selectOption(idx) { const as=getActiveSet(); if (!as||(as.userAnswers[as.currentIdx]!==undefined&&as.userAnswers[as.currentIdx]!==null)) return; as.userAnswers[as.currentIdx]=idx; var ch3=getCh(); if(ch3&&as._isSet){if(!as._tagSynced)as._tagSynced=[];if(!as._tagSynced[as.currentIdx]){_syncSingleAnswerToTagMeta(ch3.id,as.questions[as.currentIdx],idx);as._tagSynced[as.currentIdx]=true;}} saveState(); renderQuestion(); syncAnswerToServer(); }
function submitAnswer() {
  const as=getActiveSet(); if (!as||!as.questions||!as.questions.length) return;
  const q=as.questions[as.currentIdx]; if (!q||(as.userAnswers[as.currentIdx]!==undefined&&as.userAnswers[as.currentIdx]!==null)) return;
  if (q.type==='term'||q.type==='short') { const ta=document.getElementById('subjective-answer'); if (!ta||!ta.value.trim()) { alert('请输入答案'); return; } as.userAnswers[as.currentIdx]=ta.value.trim(); }
  else { if (as.userAnswers[as.currentIdx]===undefined) { alert('请选择选项'); return; } }
  var ch4=getCh(); if(ch4&&as._isSet&&as.userAnswers[as.currentIdx]!==undefined&&as.userAnswers[as.currentIdx]!==null){if(!as._tagSynced)as._tagSynced=[];if(!as._tagSynced[as.currentIdx]){_syncSingleAnswerToTagMeta(ch4.id,as.questions[as.currentIdx],as.userAnswers[as.currentIdx]);as._tagSynced[as.currentIdx]=true;}}
  saveState(); renderQuestion(); updateProgress(); updateQuickActions(); checkAchievements(); syncAnswerToServer();
}
function nextQuestion() { const as=getActiveSet(); if (!as) return; if (as.currentIdx<as.questions.length-1) { as.setCurrentIdx(as.currentIdx+1); saveState(); renderQuestion(); updateProgress(); } }
function goToQuestion(idx) { const as=getActiveSet(); if (!as||idx<0||idx>=as.questions.length) return; as.setCurrentIdx(idx); saveState(); renderQuestion(); updateProgress(); }
function endExam() { const as=getActiveSet(); if (!as) return; if (as._isSet) { endQuizSession(); } else if (as.isExam) { endExamGenerated(as); } else { const ch=as; autoUpdateChapterWeakTags(ch); saveQuizHistory(ch); updateSRSAfterExam(ch); autoBackup(); checkAchievements(); syncAnswerToServerFinal(); updateChapterProgress(); openQuizModal("report"); renderReport(); } }
function resetQuiz() { const as=getActiveSet(); if (!as) return; if (as._isSet) { as.userAnswers=new Array(as.questions.length).fill(undefined); as.setCurrentIdx(0); saveState(); openQuizModal('quiz'); renderQuestion(); updateProgress(); return; } as.userAnswers=new Array(as.questions.length).fill(undefined); as.setCurrentIdx(0); saveState(); renderQuestion(); updateProgress(); closeQuizModal(); showScreen('start'); updateQuickActions(); }
// 基于本轮统计重新分类标签，同时保留不在本轮中的历史标签
function _reclassifyTagsByRound(s) {
  var rts = s._roundTagStats || {};

  // 1. 不在本轮题目中的标签 — 保留原分类不变
  var keepError = (s.errorTags || []).filter(function(t) { return !rts[t]; });
  var keepReview = (s.reviewTags || []).filter(function(t) { return !rts[t]; });

  // 2. 在本轮题目中但尚未全部答完的 — 保留原分类（等答完再判定）
  var pendingError = (s.errorTags || []).filter(function(t) {
    if (!rts[t]) return false;
    return (rts[t].correct + rts[t].wrong) < rts[t].total;
  });
  var pendingReview = (s.reviewTags || []).filter(function(t) {
    if (!rts[t]) return false;
    return (rts[t].correct + rts[t].wrong) < rts[t].total;
  });

  // 3. 本轮全部答完的标签 — 本轮表现决定分类（体现最新学习状态）
  var autoError = [], autoReview = [];
  Object.keys(rts).forEach(function(tag) {
    var rs = rts[tag];
    if (rs.correct + rs.wrong < rs.total) return;  // 未答完，跳过
    if (rs.wrong > 0) autoError.push(tag);
    else autoReview.push(tag);
  });

  // 4. 合并（用对象 key 去重，error 优先）
  var errSet = {}, revSet = {};
  keepError.forEach(function(t) { errSet[t] = true; });
  pendingError.forEach(function(t) { errSet[t] = true; });
  keepReview.forEach(function(t) { revSet[t] = true; });
  pendingReview.forEach(function(t) { revSet[t] = true; });
  autoError.forEach(function(t) { if (!revSet[t]) errSet[t] = true; });
  autoReview.forEach(function(t) { if (!errSet[t]) revSet[t] = true; });

  s.errorTags = Object.keys(errSet);
  s.reviewTags = Object.keys(revSet);

  // 5. 清理 newTopicTags — 已产生答题数据的标签不再是「新」标签
  if (s.newTopicTags && s.newTopicTags.length > 0) {
    s.newTopicTags = s.newTopicTags.filter(function(t) {
      var m = s.tagMeta && s.tagMeta[t];
      return !m || m.totalQ === 0;
    });
  }
}

// 单题标签统计更新 — 每道题作答后立即更新
function _syncSingleAnswerToTagMeta(chapterId, question, answerVal) {
  if (!question || !question.tag) return;
  var s = getChStrategy(chapterId);
  if (!s) return;
  // 更新本轮统计
  if (!s._roundTagStats) s._roundTagStats = {};
  if (!s._roundTagStats[question.tag]) s._roundTagStats[question.tag] = { correct: 0, wrong: 0, total: 0 };
  var ci = isObjType(question.type) ? getCi(question, answerVal) : (answerVal !== undefined && answerVal !== null && answerVal !== -1);
  if (ci === true) s._roundTagStats[question.tag].correct++;
  else s._roundTagStats[question.tag].wrong++;
  // 更新累计 tagMeta（展示用）
  if (!s.tagMeta) s.tagMeta = {};
  if (!s.tagMeta[question.tag]) s.tagMeta[question.tag] = { totalQ: 0, correct: 0 };
  s.tagMeta[question.tag].totalQ++;
  if (ci === true) s.tagMeta[question.tag].correct++;
  s.tagMeta[question.tag].lastAnswer = Date.now();
  // 重新分类并刷新 UI
  _reclassifyTagsByRound(s);
  saveState();
  renderTagColumns();
  updateChapterPromptTemplate();
}

function autoUpdateChapterWeakTags(ch) {
  ch = ch || getCh();
  if (!ch) return;
  var s = getChStrategy(ch.id);
  if (!s) return;
  var as = getActiveSet ? (typeof getActiveSet === 'function' ? getActiveSet() : null) : null;
  if (!as || !as.questions) {
    var sets = ch.quizSets || [];
    as = sets.length > 0 ? sets[sets.length - 1] : null;
  }
  if (!as) return;
  // 处理未被单题函数覆盖的答案（如直接点"结束"跳过的题目）
  (as.questions || []).forEach(function(q, qi) {
    if (!q.tag) return;
    if (as._tagSynced && as._tagSynced[qi]) return; // 已被单题函数处理过
    var ans = as.userAnswers && as.userAnswers[qi];
    if (ans === undefined || ans === -1 || ans === null) return;
    // 更新本轮统计
    if (!s._roundTagStats) s._roundTagStats = {};
    if (!s._roundTagStats[q.tag]) s._roundTagStats[q.tag] = { correct: 0, wrong: 0, total: 0 };
    var ci = isObjType(q.type) ? getCi(q, ans) : (ans !== undefined && ans !== null && ans !== -1);
    if (ci === true) s._roundTagStats[q.tag].correct++;
    else s._roundTagStats[q.tag].wrong++;
    // 更新累计 tagMeta
    if (!s.tagMeta) s.tagMeta = {};
    if (!s.tagMeta[q.tag]) s.tagMeta[q.tag] = { totalQ: 0, correct: 0 };
    s.tagMeta[q.tag].totalQ++;
    if (ci === true) s.tagMeta[q.tag].correct++;
    s.tagMeta[q.tag].lastAnswer = Date.now();
    if (as._tagSynced) as._tagSynced[qi] = true;
  });
  // 基于本轮统计重新分类（不再用累计正确率）
  _reclassifyTagsByRound(s);
  if (!s.newTopicTags) s.newTopicTags = [];
  saveState(); renderTagColumns(); updateChapterPromptTemplate();
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