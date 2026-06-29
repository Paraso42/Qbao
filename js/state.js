const DEFAULT_STATE = { subjects: {}, currentSubjectId: null, chapters: {}, currentChapterId: null, history: [], lastScreen: 'start' };
let state = {};
const STORAGE_KEY = 'quizEngineState_v7';
const CLOUD_STORAGE_PREFIX = 'quizEngineState_cloud_';
function loadState() {
  try {
    // 如果已登录，优先加载该账号的云端数据
    const cloudKey = CLOUD_STORAGE_PREFIX + getUser()?.id;
    const saved = localStorage.getItem(cloudKey) || localStorage.getItem(STORAGE_KEY);
    if (saved) {
      state = JSON.parse(saved);
      state = migrateState(state);
      return;
    }
  } catch(e) { console.warn('load err', e); }
  state = JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function sanitizeState() {
  if (state.srsData) {
    var validIds = {};
    Object.keys(state.chapters || {}).forEach(function(cid) { validIds[cid] = true; });
    Object.keys(state.srsData).forEach(function(qId) {
      var cid = qId.split(":")[0];
      if (!validIds[cid]) delete state.srsData[qId];
    });
  }
}

async function DataStoreInit() {
  if (!isOnlineMode || !getToken()) return;
  const cloudKey = CLOUD_STORAGE_PREFIX + getUser()?.id;
  try {
    const res = await fetchWithAuth('/data');
    if (!res) {
      // token 失效，降级到本地
      loadState();
      return;
    }
    const cloud = await res.json();
    if (cloud && cloud.state_json && cloud.synced_at) {
      const cloudState = migrateState(cloud.state_json);
      // 尝试读取本地该账号的缓存
      const localSaved = localStorage.getItem(cloudKey);
      if (localSaved) {
        const localTime = localStorage.getItem('qbao_lastSync');
        if (localTime && new Date(localTime) >= new Date(cloud.synced_at)) {
          // 本地更新，保留本地
          loadState();
        } else {
          // 云端更新，用云端覆盖
          state = cloudState;
          localStorage.setItem(cloudKey, JSON.stringify(state));
        }
      } else {
        // 首次拉取云端，直接使用
        state = cloudState;
        localStorage.setItem(cloudKey, JSON.stringify(state));
      }
    } else {
      // 云端无数据，用本地
      loadState();
    }
  } catch(e) {
    console.warn('cloud load err', e);
    loadState();
  }
}

function saveState() { try { const qs=state.quizSession; state.quizSession=null; if(state.aiTaskQueue) state.aiTaskQueue.forEach(function(t){t._ssr=t.streamSetRef; delete t.streamSetRef;}); var origCm=state.chapterMaterials; if(origCm){ var cleanCm={}; Object.keys(origCm).forEach(function(cid){ cleanCm[cid]=origCm[cid].map(function(m){ var copy={}; for(var k in m){ if(k!=='data') copy[k]=m[k]; } return copy; }); }); state.chapterMaterials=cleanCm; } localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); var user=getUser(); if(user&&user.id) localStorage.setItem(CLOUD_STORAGE_PREFIX+user.id, JSON.stringify(state)); if(state.aiTaskQueue) state.aiTaskQueue.forEach(function(t){t.streamSetRef=t._ssr; delete t._ssr;}); state.quizSession=qs; state.chapterMaterials=origCm; scheduleCloudSync(); } catch(e) {} }

function scheduleCloudSync() {
  if (!isOnlineMode || !getToken()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const res = await fetchWithAuth('/data', {
        method: 'PUT',
        body: JSON.stringify({ state_json: state })
      });
      if (res && res.ok) {
        localStorage.setItem('qbao_lastSync', new Date().toISOString());
        updateSyncStatus();
      }
    } catch(e) { console.warn('cloud sync err', e); }
  }, 2000);
}

function updateSyncStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (!isOnlineMode || !getToken()) { el.textContent = '🔴 离线'; el.style.color = '#555'; return; }
  const last = localStorage.getItem('qbao_lastSync');
  if (last) { el.textContent = '☁️ 已同步 ' + new Date(last).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); el.style.color = '#2ed573'; }
  else { el.textContent = '☁️ 未同步'; el.style.color = '#f59e0b'; }
}
function getCh() { return state.chapters[state.currentChapterId] || null; }
function getSubj() { return state.subjects[state.currentSubjectId] || null; }
function getExam() { return state.generatedExams[state.currentExamId] || null; }
function getActiveSet() {
  const ex = getExam(); if (ex) return { _ref: ex, questions: ex.questions, userAnswers: ex.userAnswers, currentIdx: ex.currentIdx, setCurrentIdx: function(v){ex.currentIdx=v;}, setName: ex.name, isExam: true, setId: ex.id, subjectId: ex.subjectId };
  const ch = getCh(); if (!ch) return null;
  if (ch.quizSets && ch.quizSets.length > 0) {
    var idx = (typeof ch.currentQuizSetIdx === 'number' && ch.currentQuizSetIdx >= 0) ? ch.currentQuizSetIdx : ch.quizSets.length - 1; const qs = ch.quizSets[idx];
    return { _ref: qs, _isSet: true, questions: qs.questions, userAnswers: qs.userAnswers, currentIdx: qs.currentIdx, setCurrentIdx: function(v){qs.currentIdx=v;}, setName: ch.name, isExam: false, setId: ch.id, subjectId: null };
  }
  return { _ref: ch, questions: ch.questions, userAnswers: ch.userAnswers, currentIdx: ch.currentIdx, setCurrentIdx: function(v){ch.currentIdx=v;}, setName: ch.name, isExam: false, setId: ch.id, subjectId: null };
}
function getCurrentQuizSet() { const ch=getCh(); if(!ch||!ch.quizSets||ch.quizSets.length===0) return null; var idx = (typeof ch.currentQuizSetIdx === 'number' && ch.currentQuizSetIdx >= 0) ? ch.currentQuizSetIdx : ch.quizSets.length - 1; return ch.quizSets[idx]; }
function createQuizSetForChapter(questions, chId) {
  const ch = state.chapters[chId]; if (!ch) return null;
  if (!ch.quizSets) ch.quizSets = [];
  const set = { questions: questions.slice(), userAnswers: new Array(questions.length).fill(undefined), currentIdx: 0, createdAt: Date.now() };
  ch.quizSets.push(set);
  ch.currentQuizSetIdx = ch.quizSets.length - 1;
  // 同步到 ch.questions 题库，供科目总览/生成考卷/SRS 等聚合功能使用
  if (!ch.questions) ch.questions = [];
  questions.forEach(q => ch.questions.push(q));
  if (!ch.userAnswers) ch.userAnswers = [];
  ch.userAnswers = ch.userAnswers.concat(new Array(questions.length).fill(undefined));
  if (typeof ch.currentIdx === 'undefined') ch.currentIdx = 0;
  // 初始化本轮标签统计
  var _s2 = getChStrategy(chId);
  if (_s2) {
    _s2._roundTagStats = {};
    questions.forEach(function(_q) {
      if (!_q.tag) return;
      if (!_s2._roundTagStats[_q.tag]) _s2._roundTagStats[_q.tag] = { correct: 0, wrong: 0, total: 0 };
      _s2._roundTagStats[_q.tag].total++;
    });
  }
  return set;
}
function createQuizSet(questions) { return createQuizSetForChapter(questions, state.currentChapterId); }
function selectQuizSet(idx) {
  const ch = getCh(); if (!ch || !ch.quizSets) return;
  if (idx >= 0 && idx < ch.quizSets.length) { ch.currentQuizSetIdx = idx; saveState(); renderSubjectList(); updateQuickActions(); }
}
function startQuizSession() {
  _firstSyncDone = false;
  const ch = getCh(); if (!ch) return;
  // 检测当前章节是否有正在流式注入的任务
  var runningStreamTask = (state.aiTaskQueue || []).find(function(t) {
    return t.chapterId === ch.id && t.status === 'running';
  });
  if (runningStreamTask && runningStreamTask.streamSetRef) {
    ch.currentQuizSetIdx = ch.quizSets.indexOf(runningStreamTask.streamSetRef);
    saveState();
    openQuizModal('quiz');
    renderQuestion();
    updateProgress();
    return;
  }
  // 优先用答题集合
  if (ch.quizSets && ch.quizSets.length > 0) {
    const qs = getCurrentQuizSet();
    if (qs && qs.questions.length > 0) {
      // 如果全部答完，自动结算并显示报告
      var answered = qs.userAnswers ? qs.userAnswers.filter(function(a) { return a !== undefined && a !== -1; }).length : 0;
      if (answered >= qs.questions.length && qs.questions.length > 0) {
        endExam();
        return;
      }
      // 如果没有真实作答（全是 -1 旧标记或 undefined），清除旧标记开始新答题
      if (answered === 0 && qs.userAnswers) {
        qs.userAnswers = new Array(qs.questions.length).fill(undefined);
        qs.currentIdx = 0;
        saveState();
      }
      // 如果有部分作答，将剩余的 -1 标记转为 undefined（允许继续作答未完成题目）
      if (answered > 0 && answered < qs.questions.length && qs.userAnswers) {
        for (var _j = 0; _j < qs.userAnswers.length; _j++) {
          if (qs.userAnswers[_j] === -1 || qs.userAnswers[_j] === null) qs.userAnswers[_j] = undefined;
        }
        saveState();
      }
      // 初始化/重置本轮标签统计
      var _s3 = getChStrategy(ch.id);
      if (_s3) {
        _s3._roundTagStats = {};
        qs.questions.forEach(function(_q2) {
          if (!_q2.tag) return;
          if (!_s3._roundTagStats[_q2.tag]) _s3._roundTagStats[_q2.tag] = { correct: 0, wrong: 0, total: 0 };
          _s3._roundTagStats[_q2.tag].total++;
        });
        // 清除已被重置题目的_tagSynced标记
        if (qs._tagSynced) { for (var _k = 0; _k < qs._tagSynced.length; _k++) { if (qs.userAnswers[_k] === undefined) qs._tagSynced[_k] = false; } }
      }
      openQuizModal('quiz'); renderQuestion(); updateProgress(); return;
    }
  }
  // 兼容旧数据
  if (ch.questions && ch.questions.length > 0) { openQuizModal('quiz'); renderQuestion(); updateProgress(); return; }
  alert('暂无题目');
}
function finalizeUnansweredQuestions(as) {
  if (!as || !as.questions || !as.userAnswers) return;
  for (var i = 0; i < as.questions.length; i++) {
    if (as.userAnswers[i] === undefined) {
      as.userAnswers[i] = -1; // 标记为未作答（-1表示未答）
    }
  }
}
function endQuizSession() {
  const as = getActiveSet(); if (!as) return;
  // 检测是否有流式任务仍在运行
  var streamStillRunning = (state.aiTaskQueue || []).some(function(t) {
    return t.streamSetRef === as._ref && t.status === 'running';
  });
  if (streamStillRunning) {
    var answeredCopy = { questions: as.questions.slice(), userAnswers: as.userAnswers.slice() };
    finalizeUnansweredQuestions(answeredCopy);
  // 将 quizSet 答案同步回全局 ch.userAnswers（科目题库依赖）
  var _ch2 = getCh();
  if (as._isSet && _ch2 && _ch2.quizSets && _ch2.userAnswers) {
    var _qsIdx = _ch2.currentQuizSetIdx;
    if (_qsIdx >= 0 && _qsIdx < _ch2.quizSets.length) {
      var _offset = 0;
      for (var _s = 0; _s < _qsIdx; _s++) _offset += _ch2.quizSets[_s].questions.length;
      var _qsA = _ch2.quizSets[_qsIdx].userAnswers;
      for (var _a = 0; _a < _qsA.length && (_offset + _a) < _ch2.userAnswers.length; _a++) {
        if (_qsA[_a] !== undefined && _qsA[_a] !== null) _ch2.userAnswers[_offset + _a] = _qsA[_a];
      }
    }
  }
    saveQuizHistory({ id: as.setId, name: as.setName, questions: answeredCopy.questions, userAnswers: answeredCopy.userAnswers, setName: as.setName, setId: as.setId });
    updateSRSAfterExam({ setId: as.setId, questions: answeredCopy.questions, userAnswers: answeredCopy.userAnswers });
    if (as.setId) autoUpdateChapterWeakTags(state.chapters[as.setId]);
    autoBackup();
    checkAchievements();
    syncAnswerToServerFinal();
    var unusedStats = calcStats(as);
    saveState();
  updateChapterProgress();
    openQuizModal('report');
    renderReportForSet(as);
    return;
  }
  // 将 quizSet 答案同步回全局 ch.userAnswers（科目题库依赖）
  var _ch2b = getCh();
  if (as._isSet && _ch2b && _ch2b.quizSets && _ch2b.userAnswers) {
    var _qsIdx2 = _ch2b.currentQuizSetIdx;
    if (_qsIdx2 >= 0 && _qsIdx2 < _ch2b.quizSets.length) {
      var _offset2 = 0;
      for (var _s2 = 0; _s2 < _qsIdx2; _s2++) _offset2 += _ch2b.quizSets[_s2].questions.length;
      var _qsA2 = _ch2b.quizSets[_qsIdx2].userAnswers;
      for (var _a2 = 0; _a2 < _qsA2.length && (_offset2 + _a2) < _ch2b.userAnswers.length; _a2++) {
        if (_qsA2[_a2] !== undefined && _qsA2[_a2] !== null) _ch2b.userAnswers[_offset2 + _a2] = _qsA2[_a2];
      }
    }
  }
  renderSubjectList();
  finalizeUnansweredQuestions(as);
  saveState();
  syncAnswerToServerFinal();
  // 保存答题历史
  saveQuizHistory({ id: as.setId, name: as.setName, questions: as.questions, userAnswers: as.userAnswers, setName: as.setName, setId: as.setId });
  updateSRSAfterExam({ setId: as.setId, questions: as.questions, userAnswers: as.userAnswers });
  // 更新薄弱标签
  if (as.setId) autoUpdateChapterWeakTags(state.chapters[as.setId]);
  autoBackup();
  checkAchievements();
  var stats2 = calcStats(as);
  saveState();
  updateChapterProgress();
  openQuizModal('report');
  renderReportForSet(as);
}
function isObjType(t) { return t === 'single' || t === 'judge'; }
function getCi(q, answer) {
  if (!q) return false;
  if (answer === -1) return false; // 未作答判为错误
  if (q.type === 'term' || q.type === 'short') return true;
  if (q.type === 'single' || q.type === 'judge') return answer === q.answer;
  return null;
}
function escapeHtml(text) {
  if (typeof text !== 'string') return String(text ?? '');
  const d = document.createElement('div'); d.textContent = text; return d.innerHTML;
}
function renderMarkdown(text) {
  if (typeof text !== 'string') return escapeHtml(String(text ?? ''));

  // Step 1: Extract and pre-render display math $$...$$ with placeholders
  const displayMath = [];
  let s = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
    try {
      displayMath.push(katex.renderToString(m.trim(), {displayMode: true, throwOnError: false}));
    } catch(e) {
      displayMath.push('<code class="katex-error">' + escapeHtml(m.trim()) + '</code>');
    }
    return '%%DM' + (displayMath.length - 1) + '%%';
  });

  // Step 2: Extract and pre-render inline math $...$ with placeholders
  const inlineMath = [];
  s = s.replace(/\$([^\$]+?)\$/g, (_, m) => {
    try {
      inlineMath.push(katex.renderToString(m.trim(), {displayMode: false, throwOnError: false}));
    } catch(e) {
      inlineMath.push('<code class="katex-error">' + escapeHtml(m.trim()) + '</code>');
    }
    return '%%IM' + (inlineMath.length - 1) + '%%';
  });

  // Step 3: HTML-escape the remaining non-math text only
  s = escapeHtml(s);

  // Step 4: Restore placeholders with pre-rendered KaTeX HTML
  s = s.replace(/%%DM(\d+)%%/g, (_, i) => displayMath[parseInt(i)]);
  s = s.replace(/%%IM(\d+)%%/g, (_, i) => inlineMath[parseInt(i)]);

  // Step 5: Apply other markdown formatting (on escaped text — safe tags only)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\n/g, '<br>');
  return s;
}
function getChStrategy(cid) {
  const ch = state.chapters[cid];
  if (!ch) return null;
  if (!ch.strategy) ch.strategy = { errPct: 60, reviewPct: 20, newPct: 20, typeCounts: { single: 10, judge: 5, term: 1, short: 1 }, errorTags: [], reviewTags: [], newTopicTags: [], tagMeta: {} };
  if (!ch.strategy.errorTags) ch.strategy.errorTags = [];
  if (!ch.strategy.reviewTags) ch.strategy.reviewTags = [];
  if (!ch.strategy.newTopicTags) ch.strategy.newTopicTags = [];
  if (!ch.strategy.tagMeta) ch.strategy.tagMeta = {};
  return ch.strategy;
}
function migrateState(s) {
  if (!s.history) s.history = [];
  // Prevent chat modal from auto-opening on page load (v3.9)
  if (s.lastScreen === "chat") s.lastScreen = "start";
  // Prevent quiz modal from auto-opening on page load (v3.18)
  if (s.lastScreen === "quiz") s.lastScreen = "start";
  if (!s.subjects) s.subjects = {};
  if (!s.chapters) s.chapters = {};
  for (const cid in s.chapters) {
    const ch = s.chapters[cid];
    if (!ch.strategy) ch.strategy = { errPct: 60, reviewPct: 20, newPct: 20, typeCounts: { single: 10, judge: 5, term: 1, short: 1 }, errorTags: [], reviewTags: [], newTopicTags: [], tagMeta: {} };
    if (!ch.quizSets && ch.questions && ch.questions.length > 0) ch.quizSets = [{ questions: ch.questions.slice(), userAnswers: (ch.userAnswers||[]).slice(), currentIdx: 0, createdAt: Date.now() }];
    // Ensure new tag fields exist
    if (!ch.strategy.errorTags) ch.strategy.errorTags = [];
    if (!ch.strategy.reviewTags) ch.strategy.reviewTags = [];
    if (!ch.strategy.newTopicTags) ch.strategy.newTopicTags = [];
    if (!ch.strategy.tagMeta) ch.strategy.tagMeta = {};
    // Migrate old weakTags to errorTags
    if (ch.strategy.weakTags && Array.isArray(ch.strategy.weakTags) && ch.strategy.errorTags.length === 0) {
      ch.strategy.weakTags.forEach(function(t) {
        var tName = typeof t === 'string' ? t : t.name;
        if (tName && ch.strategy.errorTags.indexOf(tName) < 0) ch.strategy.errorTags.push(tName);
      });
      delete ch.strategy.weakTags;
    }
    if (ch.weakTags && Array.isArray(ch.weakTags)) {
      if (typeof ch.weakTags[0] === 'string') ch.strategy.weakTags = ch.weakTags.map(t => ({ name: t, active: true }));
      else ch.strategy.weakTags = ch.weakTags;
      delete ch.weakTags;
    }
  }
  if (s.weakTags) delete s.weakTags;
  if (Object.keys(s.subjects).length === 0 && Object.keys(s.chapters).length > 0) {
    const sid = 'subj_' + Date.now().toString(36);
    s.subjects[sid] = { id: sid, name: '默认科目', chapterIds: Object.keys(s.chapters) };
    s.currentSubjectId = sid;
  }
  // 确保所有科目有 collapsed 字段 (v3.12.2)
  for (const sid in s.subjects) {
    if (typeof s.subjects[sid].collapsed !== 'boolean') {
      s.subjects[sid].collapsed = false;
    }
  }
  if (!s.achievements) s.achievements = { unlocked: [], history: [] };
  if (!s.ignoredQuestions) s.ignoredQuestions = [];
  // subjectOrder 迁移 (v3.18)
  if (!s.subjectOrder || !Array.isArray(s.subjectOrder)) { s.subjectOrder = Object.keys(s.subjects); }
  Object.keys(s.subjects).forEach(function(sid2) { if (!s.subjectOrder.includes(sid2)) s.subjectOrder.push(sid2); });
  s.subjectOrder = s.subjectOrder.filter(function(sid2) { return !!s.subjects[sid2]; });
  if (!s.srsData) s.srsData = {};
  if (!s.settings) s.settings = { quizFontSize: 17, sidebarFontSize: 13, topbarFontSize: 14, mainFontSize: 17, darkMode: false, showNoticeBar: true };
  if (!s.settings.sidebarFontSize) s.settings.sidebarFontSize = 13;
  if (!s.settings.topbarFontSize) s.settings.topbarFontSize = 14;
  if (!s.settings.mainFontSize) s.settings.mainFontSize = 17;
  if (typeof s.settings.darkMode !== 'boolean') s.settings.darkMode = false;
  if (typeof s.settings.showNoticeBar !== 'boolean') s.settings.showNoticeBar = true;
  if (!s.generatedExams) s.generatedExams = {};
  if (!s.aiConfig) s.aiConfig = {};
  if (typeof s.aiConfig.systemPrompt !== 'string') s.aiConfig.systemPrompt = '';
  // Migrate old single-key aiConfig to new providerKeys structure
  if (!s.aiConfig.provider) s.aiConfig.provider = 'ecnu';
  if (!s.aiConfig.model) s.aiConfig.model = 'ecnu-plus';
  if (!s.aiConfig.providerKeys) {
    s.aiConfig.providerKeys = {};
    // Migrate old ecnu apiKey to providerKeys
    if (s.aiConfig.apiKey) {
      s.aiConfig.providerKeys.ecnu = s.aiConfig.apiKey;
    }
  }
  // Ensure apiKeySet flag for backward compat
  if (s.aiConfig.providerKeys && Object.keys(s.aiConfig.providerKeys).length > 0) {
    s.aiConfig.apiKeySet = true;
  }
  if (!s.chapterMaterials) s.chapterMaterials = {};
  if (typeof s.aiEnabled !== 'boolean') s.aiEnabled = false;
  // AI task queue
  if (!s.aiTaskQueue) s.aiTaskQueue = [];
  // Reset any running tasks from page reload
  s.aiTaskQueue.forEach(t => { if (t.status === 'running') t.status = 'pending'; delete t.streamSetRef; });
  // quizSession is transient, not persisted
  s.quizSession = null;
  return s;
}