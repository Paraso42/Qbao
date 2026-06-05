function getChapterMaterials(cid) { if(!state.chapterMaterials)state.chapterMaterials={}; return state.chapterMaterials[cid]||[]; }
function saveChapterMaterials(cid, materials) { if(!state.chapterMaterials)state.chapterMaterials={}; state.chapterMaterials[cid]=materials; saveState(); }
function onAiGlobalToggle() { const enabled=document.getElementById('ai-global-toggle').checked; state.aiEnabled=enabled; saveState(); applyAiModeUi(); updateTopbarAiIndicator(); if(enabled) showAiModeTooltip(); }
function showAiModeTooltip() { const t=document.getElementById('ai-mode-tooltip'); if(t){t.style.display='block'; if(state._aiTooltipTimer) clearTimeout(state._aiTooltipTimer); state._aiTooltipTimer=setTimeout(function(){closeAiModeTooltip();},5000);} }
function closeAiModeTooltip() { const t=document.getElementById('ai-mode-tooltip'); if(t)t.style.display='none'; if(state._aiTooltipTimer){clearTimeout(state._aiTooltipTimer); state._aiTooltipTimer=null;} }
function cancelAiGenerate() {
  if(aiTimer){clearInterval(aiTimer);aiTimer=null;}
  aiGenerating=false;
  aiTaskRunnerActive=false;
  if(aiTaskAbortController){aiTaskAbortController.abort();aiTaskAbortController=null;}
  const progress=document.getElementById('ai-progress');
  if(progress){progress.classList.remove('active');progress.textContent='';}
  // Clear any pending/running tasks
  if(state.aiTaskQueue){
    state.aiTaskQueue.forEach(t=>{if(t.status==='running')t.status='pending';});
    saveState();
  }
  updateAiTaskStatusBar();
}
// ===== AI 任务队列函数 =====
function updateAiTaskStatusBar() {
  const el = document.getElementById('ai-task-status');
  const queue = state.aiTaskQueue || [];
  const running = queue.filter(t => t.status === 'running').length;
  const pending = queue.filter(t => t.status === 'pending').length;
  if (el) {
    if (running > 0) {
      el.innerHTML = '<div class="ai-task-bar"><span class="ai-task-dot"></span></div>' + running + ' 运行中, ' + pending + ' 等待中';
      el.classList.add('active');
    } else if (pending > 0) {
      el.innerHTML = '<div class="ai-task-bar"><span class="ai-task-dot" style="animation:none;"></span></div>' + pending + ' 等待中';
      el.classList.add('active');
    } else {
      el.textContent = '';
      el.classList.remove('active');
    }
  }
  updateTopbarAiIndicator();
}
function showAiTaskNotification(type, message) {
  var toast = document.createElement('div');
  var colors = { completed: '#2ed573', failed: '#e94560', info: '#4facfe' };
  toast.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:8px;z-index:9999;font-size:14px;max-width:320px;background:' + (colors[type] || colors.info) + ';color:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.5s,transform 0.3s;';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { toast.remove(); }, 500); }, 4000);
}
function openAiTaskQueueDialog() { renderAiTaskQueueDialog(); document.getElementById('ai-task-queue-dialog').classList.add('active'); }
function closeAiTaskQueueDialog() { document.getElementById('ai-task-queue-dialog').classList.remove('active'); }
function renderAiTaskQueueDialog() {
  var container = document.getElementById('ai-task-queue-list');
  if (!container) return;
  var queue = state.aiTaskQueue || [];
  if (queue.length === 0) { container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无任务</div>'; return; }
  var html = '';
  for (var i = queue.length - 1; i >= 0; i--) { var task = queue[i];
    var dotColor = task.status === 'completed' ? '#2ed573' : task.status === 'failed' ? '#e94560' : task.status === 'running' ? '#4facfe' : '#999';
    var animStyle = task.status === 'running' ? '' : 'animation:none;';
    html += '<div style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #eee;font-size:13px;">';
    html += '<span class="ai-task-dot" style="background:' + dotColor + ';' + animStyle + '"></span>';
    html += '<span style="flex:1;">' + escapeHtml(task.chapterName) + '</span>';
    if (task.status === 'completed') html += '<span style="color:#2ed573;">' + task.questionCount + ' 题</span>';
    else if (task.status === 'failed') html += '<span style="color:#e94560;font-size:11px;" title="' + escapeHtml(task.error) + '">失败</span>';
    else if (task.status === 'running') {
      var sc = task.streamQuestionCount || 0;
      var threshold = state.aiConfig ? (state.aiConfig.streamThreshold || 3) : 3;
      if (sc >= threshold) {
        html += '<span style="color:#8b5cf6;font-size:11px;font-weight:bold;cursor:pointer;" onclick="event.stopPropagation();startStreamQuiz(\'' + task.id + '\')">' + sc + ' 题 (可答题 →)</span>';
      } else if (sc > 0) {
        html += '<span style="color:#4facfe;font-size:11px;">' + sc + ' 题 (生成中...)</span>';
      } else {
        html += '<span style="color:#4facfe;font-size:11px;">运行中...</span>';
      }
    }
    else html += '<span style="color:#999;font-size:11px;">等待中</span>';
    if (task.status === 'pending' || task.status === 'running') {
      html += '<button onclick="aiTaskCancelTask(\'' + task.id + '\')" style="font-size:11px;padding:2px 8px;cursor:pointer;border:1px solid #ddd;background:#fff;border-radius:4px;">取消</button>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
  container.scrollTop = 0;
}
function aiTaskCancelTask(taskId) {
  var task = state.aiTaskQueue.find(function(t) { return t.id === taskId; });
  if (!task) return;
  if (task.status === 'pending') {
    state.aiTaskQueue = state.aiTaskQueue.filter(function(t) { return t.id !== taskId; });
    saveState(); renderAiTaskQueueDialog(); updateAiTaskStatusBar(); updateGenerateButtonState();
    return;
  }
  if (task.status === 'running') {
    aiTaskRunnerActive = false;
    if (aiTaskAbortController) { aiTaskAbortController.abort(); aiTaskAbortController = null; }
    task.status = 'failed'; task.error = '用户取消';
    saveState(); renderAiTaskQueueDialog(); updateAiTaskStatusBar(); updateGenerateButtonState();
  }
}
function aiTaskCancelAll() {
  cancelAiGenerate();
  renderAiTaskQueueDialog(); updateGenerateButtonState();
}
async function _aiExecuteTask(task) {
  task.status = 'running';
  saveState(); renderAiTaskQueueDialog(); updateAiTaskStatusBar();
  var ch = state.chapters[task.chapterId];
  if (!ch) { task.status = 'failed'; task.error = '章节已删除'; saveState(); renderAiTaskQueueDialog(); updateAiTaskStatusBar(); return; }
  var materials = getChapterMaterials(task.chapterId);
  if (!materials.length) { task.status = 'failed'; task.error = '资料已被删除'; saveState(); renderAiTaskQueueDialog(); updateAiTaskStatusBar(); return; }
  var localMaterials = materials.filter(function(m) { return !m._poolFile; });
  var abortController = new AbortController();
  aiTaskAbortController = abortController;
  try {
    var fd = new FormData();
    for (var i = 0; i < localMaterials.length; i++) {
      var m = localMaterials[i];
      var dataUrl = await idbGetMaterial(m.id);
      if (!dataUrl) { task.status = 'failed'; task.error = '资料 ' + m.name + ' 数据丢失'; saveState(); renderAiTaskQueueDialog(); updateAiTaskStatusBar(); return; }
      var dec = atob(dataUrl.split(',')[1]); var bin = new Uint8Array(dec.length); for(var j=0;j<dec.length;j++) bin[j]=dec.charCodeAt(j); fd.append('files', new Blob([bin]), m.name);
    }
    var uploadData = { text: '', images: [] };
    if (localMaterials.length > 0) {
      var uploadRes = await fetch(API_BASE+'/ai/upload', {method:'POST', headers:{'Authorization':'Bearer '+getToken()}, body:fd});
      if (!uploadRes.ok) { var err = await uploadRes.json().catch(function(){return {};}); throw new Error(err.error || '上传失败: '+uploadRes.status); }
      uploadData = await uploadRes.json();
    }
    // 上传后稍作等待，避免立即调用 API 触发限流
    await sleep(1000);
    var tagStats = {}; var totalQuestions = 0; var totalAnswered = 0; var totalWrong = 0;
    (ch.quizSets||[]).forEach(function(set) { set.questions.forEach(function(q,qi) { totalQuestions++; var answer = set.userAnswers && set.userAnswers[qi]; if (q.tag) { if (!tagStats[q.tag]) tagStats[q.tag] = {total:0,correct:0,wrong:0}; tagStats[q.tag].total++; } if (answer !== undefined) { totalAnswered++; if (getCi(q,answer)===false) { totalWrong++; if(q.tag && tagStats[q.tag]) tagStats[q.tag].wrong++; else if(q.tag) tagStats[q.tag].wrong++; } else { if(q.tag && tagStats[q.tag]) tagStats[q.tag].correct++; } } }); });
    var topWrongTags = Object.entries(tagStats).sort(function(a,b){return b[1].wrong-a[1].wrong;}).slice(0,10).map(function(e){return e[0];});
    var ac = state.aiConfig || {};
    var envPrompt = ac.systemPrompt ? (ac.systemPrompt.trim() + '\n\n') : '';
    var finalPrompt = envPrompt + task.promptText;
    var questions = null; var lastJson = ''; var maxAttempts = 3;
    
    if (ac.streamMode === true) {
      var emptySet = createEmptyQuizSet(task.chapterId);
      task.streamSetRef = emptySet;
      var streamResult = await _aiStreamGenerate(task, { uploadData:uploadData, tagStats:tagStats, totalQuestions:totalQuestions, totalAnswered:totalAnswered, totalWrong:totalWrong, topWrongTags:topWrongTags, finalPrompt:finalPrompt, ac:ac, ch:ch, abortController:abortController });
      if (streamResult && streamResult.length > 0) {
        streamResult.forEach(function(q,i) { if(!q.id) q.id=i+1; });
        questions = streamResult.filter(function(q) { return q.question && q.question.trim().length > 2; });
      }
      if (!questions || questions.length === 0) {
        for (var attempt2 = 1; attempt2 <= maxAttempts && !questions; attempt2++) {
          if (attempt2 > 1) { await sleep(2000*(attempt2-1)); }
          var retry2 = attempt2 > 1 ? task.promptText + '\n\n重要：你上次返回了无效JSON，错误是：'+lastJson+'。请修正后重新输出纯JSON数组。' : task.promptText;
          var genRes2 = await fetchWithRetry(API_BASE+'/ai/generate', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+getToken(), 'x-ai-api-key':ac.apiKey||'', 'x-ai-model':ac.model||'ecnu-plus', 'x-ai-strict-format':ac.strictFormat!==false?'true':'false' }, body:JSON.stringify({ textContent:uploadData.text, imageUrls:uploadData.images, typeCounts:task.strategySnapshot ? task.strategySnapshot.typeCounts : {single:10,judge:5,term:2,short:1}, prompt:envPrompt+retry2, chapterHistory:{ totalQuestions:totalQuestions, totalAnswered:totalAnswered, totalWrong:totalWrong, tagStats:tagStats, topWrongTags:topWrongTags }, chapterId: task.chapterId }) }, 3, 5000);
          var genData2 = await genRes2.json();
          var raw2 = genData2.questions; if(!raw2&&genData2.output) raw2=genData2.output; if(!raw2&&typeof genData2==='object') raw2=Object.values(genData2).find(function(v){return Array.isArray(v)||typeof v==='string';});
          if (typeof raw2 === 'string') { raw2 = raw2.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim(); try { questions = JSON.parse(raw2); } catch(e2) { lastJson=e2.message; if(attempt2<maxAttempts) continue; else throw new Error('JSON格式错误: '+e2.message); } }
          if (Array.isArray(raw2)) { questions = raw2; }
          if (!Array.isArray(questions) || questions.length === 0) { lastJson='不是数组或为空'; if(attempt2<maxAttempts) continue; else throw new Error('AI未返回有效题目'); }
          questions.forEach(function(q,i) { if(!q.id) q.id=i+1; });
          questions = questions.filter(function(q) { return q.question && q.question.trim().length > 2; });
          if (questions.length === 0) { lastJson='题目内容为空'; if(attempt2<maxAttempts) continue; else throw new Error('AI返回的题目全部为空'); }
        }
      }
    } else {
    for (var attempt = 1; attempt <= maxAttempts && !questions; attempt++) {
      if (attempt > 1) { await sleep(2000*(attempt-1)); }
      var retryPrompt = attempt > 1 ? task.promptText + '\n\n重要：你上次返回了无效JSON，错误是：'+lastJson+'。请修正后重新输出纯JSON数组。' : task.promptText;
      var apiKey = (ac.providerKeys && ac.providerKeys[ac.provider||'ecnu']) || ac.apiKey || '';
      var genRes = await fetchWithRetry(API_BASE+'/ai/generate', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+getToken(), 'x-ai-api-key': apiKey, 'x-ai-model':ac.model||'ecnu-plus', 'x-ai-provider': ac.provider||'ecnu', 'x-ai-strict-format':ac.strictFormat!==false?'true':'false' }, body:JSON.stringify({ textContent:uploadData.text, imageUrls:uploadData.images, typeCounts:task.strategySnapshot ? task.strategySnapshot.typeCounts : {single:10,judge:5,term:2,short:1}, prompt:envPrompt+retryPrompt, chapterHistory:{ totalQuestions:totalQuestions, totalAnswered:totalAnswered, totalWrong:totalWrong, tagStats:tagStats, topWrongTags:topWrongTags }, chapterId: task.chapterId }) }, 3, 5000);
      var genData = await genRes.json();
      var raw = genData.questions; if(!raw&&genData.output) raw=genData.output; if(!raw&&typeof genData==='object') raw=Object.values(genData).find(function(v){return Array.isArray(v)||typeof v==='string';});
      if (typeof raw === 'string') { raw = raw.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim(); try { questions = JSON.parse(raw); } catch(e) { lastJson=e.message; if(attempt<maxAttempts) continue; else throw new Error('JSON格式错误: '+e.message); } }
      if (Array.isArray(raw)) { questions = raw; }
      if (!Array.isArray(questions) || questions.length === 0) { lastJson='不是数组或为空'; if(attempt<maxAttempts) continue; else throw new Error('AI未返回有效题目'); }
      questions.forEach(function(q,i) { if(!q.id) q.id=i+1; });
      // 过滤掉空题目（题目文本为空或过短）
      questions = questions.filter(function(q) { return q.question && q.question.trim().length > 2; });
      if (questions.length === 0) { lastJson='题目内容为空'; if(attempt<maxAttempts) continue; else throw new Error('AI返回的题目全部为空'); }
    }
    }
    // 流式路径已完成注入，跳过 createQuizSetForChapter
    if (!(ac.streamMode === true && task.streamSetRef)) {
      createQuizSetForChapter(questions, task.chapterId);
    }
    task.status = 'completed'; task.completedAt = Date.now(); task.questionCount = questions.length;
    if (state.currentChapterId === task.chapterId) { renderSubjectList(); updateQuickActions(); }
  } catch(e) {
    if (e.name === 'AbortError') { task.status = 'failed'; task.error = '用户取消'; }
    else { task.status = 'failed'; task.error = e.message; }
  }
  aiTaskAbortController = null;
  saveState(); renderAiTaskQueueDialog(); updateAiTaskStatusBar(); updateGenerateButtonState();
  if (task.status === 'completed') showAiTaskNotification('completed', task.chapterName + ' 完成，生成 ' + task.questionCount + ' 题');
  else showAiTaskNotification('failed', task.chapterName + ' 失败：' + task.error);
}


// ===== 流式注入函数 =====
function createEmptyQuizSet(chId) {
  const ch2 = state.chapters[chId];
  if (!ch2) return null;
  if (!ch2.quizSets) ch2.quizSets = [];
  var set2 = { questions: [], userAnswers: [], currentIdx: 0, createdAt: Date.now() };
  ch2.quizSets.push(set2);
  ch2.currentQuizSetIdx = ch2.quizSets.length - 1;
  return set2;
}

function startStreamQuiz(taskId) {
  var tsk = state.aiTaskQueue.find(function(t) { return t.id === taskId; });
  if (!tsk || tsk.status !== 'running' || !tsk.streamSetRef) return;
  var ch3 = state.chapters[tsk.chapterId];
  if (!ch3) return;
  ch3.currentQuizSetIdx = ch3.quizSets.indexOf(tsk.streamSetRef);
  state.currentChapterId = tsk.chapterId;
  saveState();
  renderSubjectList();
  var qs3 = tsk.streamSetRef;
  if (qs3.questions.length > 0) {
    showScreen('quiz');
    renderQuestion();
    updateProgress();
    updateQuickActions();
  }
}

var _streamUiTimer = null;
var _streamQuizTimer = null;

async function _aiStreamGenerate(task, opts) {
  var { ac, ch, abortController, finalPrompt, uploadData, tagStats, totalQuestions, totalAnswered, totalWrong, topWrongTags } = opts;
  var maxAttempts = 3;
  var accumulatedQuestions = [];
  var lastStreamError = '';
  var streamCompleted = false;

  for (var attempt = 1; attempt <= maxAttempts && !streamCompleted; attempt++) {
    if (attempt > 1) await sleep(2000 * (attempt - 1));
    var retryPrompt = attempt > 1
      ? finalPrompt + '\n\n重要：上次返回格式错误，请只输出纯JSON数组。错误：' + lastStreamError
      : finalPrompt;

    var apiKey = (ac.providerKeys && ac.providerKeys[ac.provider||'ecnu']) || ac.apiKey || '';
    var res = await fetch(API_BASE + '/ai/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken(),
        'x-ai-api-key': apiKey,
        'x-ai-model': ac.model || 'ecnu-plus',
        'x-ai-provider': ac.provider || 'ecnu',
        'x-ai-strict-format': 'false',
        'x-ai-stream': 'true'
      },
      body: JSON.stringify({
        textContent: uploadData.text,
        typeCounts: task.strategySnapshot ? task.strategySnapshot.typeCounts : { single: 10, judge: 5, term: 2, short: 1 },
        prompt: (ac.systemPrompt ? ac.systemPrompt.trim() + '\n\n' : '') + retryPrompt,
        chapterId: task.chapterId,
        chapterHistory: {
          totalQuestions: totalQuestions || 0, totalAnswered: totalAnswered || 0, totalWrong: totalWrong || 0,
          tagStats: tagStats || {}, topWrongTags: topWrongTags || []
        }
      }),
      signal: abortController ? abortController.signal : undefined
    });

    if (!res.ok) {
      var e = await res.json().catch(function() { return {}; });
      if (attempt < maxAttempts) { lastStreamError = e.error || res.statusText; continue; }
      throw new Error(e.error || '生成失败: ' + res.status);
    }

    var fullContent = '';
    accumulatedQuestions = [];
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var streamDoneOk = false;

    while (true) {
      var r = await reader.read();
      if (r.done) break;
      buffer += decoder.decode(r.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (!line.startsWith('data: ')) continue;
        var data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          var evt = JSON.parse(data);
          if (evt.content) fullContent += evt.content;
          if (evt.newParsed && Array.isArray(evt.newParsed) && evt.newParsed.length > 0) {
            accumulatedQuestions = accumulatedQuestions.concat(evt.newParsed);
            task.streamQuestionCount = accumulatedQuestions.length;
            if (task.streamSetRef) {
              task.streamSetRef.questions.push.apply(task.streamSetRef.questions, evt.newParsed);
              var newUndefs = [];
              for (var u = 0; u < evt.newParsed.length; u++) newUndefs.push(undefined);
              task.streamSetRef.userAnswers.push.apply(task.streamSetRef.userAnswers, newUndefs);
            }
            var quizScreen = document.getElementById('screen-quiz');
            if (quizScreen && quizScreen.classList.contains('active')) {
              var as = getActiveSet();
              if (as && as._ref === task.streamSetRef) {
                if (!_streamQuizTimer) {
                  _streamQuizTimer = setTimeout(function() {
                    _streamQuizTimer = null;
                    renderQuestion();
                    updateProgress();
                  }, 800);
                }
              }
            }
            if (!_streamUiTimer) {
              _streamUiTimer = setTimeout(function() {
                _streamUiTimer = null;
                saveState();
                renderAiTaskQueueDialog();
                updateAiTaskStatusBar();
                updateQuickActions();
              }, 500);
            }
          }
          if (evt.done) {
            if (evt.error) { lastStreamError = evt.error; break; }
            streamDoneOk = true;
            streamCompleted = true;
            if (evt.questions && Array.isArray(evt.questions)) {
              accumulatedQuestions = evt.questions.slice();
              if (task.streamSetRef) {
                var oldAnswers = task.streamSetRef.userAnswers.slice();
                task.streamSetRef.questions = evt.questions.slice();
                task.streamSetRef.userAnswers = [];
                for (var k = 0; k < evt.questions.length; k++) {
                  task.streamSetRef.userAnswers.push(k < oldAnswers.length && oldAnswers[k] !== undefined ? oldAnswers[k] : undefined);
                }
              }
            }
            break;
          }
        } catch (e2) {}
      }
      if (streamDoneOk) break;
    }
    if (!streamCompleted && accumulatedQuestions.length > 0) {
      streamCompleted = true;
      streamDoneOk = true;
      // 尝试从 fullContent 解析可能未被提取的剩余题目
      try {
        var fcClean = fullContent.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'');
        var fcMatch = fcClean.match(/\[[\s\S]*\]/);
        if (fcMatch) {
          var fcAll = JSON.parse(fcMatch[0]);
          if (Array.isArray(fcAll) && fcAll.length > accumulatedQuestions.length) {
            accumulatedQuestions = fcAll.slice();
          }
        }
      } catch(e3) {}
    }
  }

  if (_streamUiTimer) { clearTimeout(_streamUiTimer); _streamUiTimer = null; }
  if (_streamQuizTimer) { clearTimeout(_streamQuizTimer); _streamQuizTimer = null; }

  if (task.streamSetRef && ch) {
    if (!ch.questions) ch.questions = [];
    accumulatedQuestions.forEach(function(q) { ch.questions.push(q); });
    if (!ch.userAnswers) ch.userAnswers = [];
    var moreUndefs = [];
    for (var u2 = 0; u2 < accumulatedQuestions.length; u2++) moreUndefs.push(undefined);
    ch.userAnswers = ch.userAnswers.concat(moreUndefs);
  }

  return accumulatedQuestions;
}

async function aiTaskRunnerLoop() {
  while (aiTaskRunnerActive) {
    var pendingTask = state.aiTaskQueue.find(function(t) { return t.status === 'pending'; });
    if (!pendingTask) { aiTaskRunnerActive = false; updateAiTaskStatusBar(); renderAiTaskQueueDialog(); updateGenerateButtonState(); return; }
    await _aiExecuteTask(pendingTask);
    if (!aiTaskRunnerActive) { updateAiTaskStatusBar(); renderAiTaskQueueDialog(); updateGenerateButtonState(); return; }
	    await new Promise(function(r){setTimeout(r, (state.aiConfig&&state.aiConfig.taskInterval?state.aiConfig.taskInterval:30)*1000);});
  }
}
function aiEnqueueGenerate(chapterId) {
  var ch = state.chapters[chapterId];
  if (!ch) { alert('章节不存在'); return; }
  var materials = getChapterMaterials(chapterId);
  if (!materials.length) { alert('请先上传复习资料'); return; }
  if (!isOnlineMode || !getToken()) { alert('请先登录'); return; }
  var hasPendingOrRunning = state.aiTaskQueue.some(function(t) { return t.chapterId === chapterId && (t.status === 'pending' || t.status === 'running'); });
  if (hasPendingOrRunning) { alert('该章节已在队列中'); return; }
  // 确保 UI 控件的当前值同步到策略（防止用户修改后未触发 onchange）
  var tcSingle = parseInt(document.getElementById('tc-single').value) || 0;
  var tcJudge = parseInt(document.getElementById('tc-judge').value) || 0;
  var tcTerm = parseInt(document.getElementById('tc-term').value) || 0;
  var tcShort = parseInt(document.getElementById('tc-short').value) || 0;
  var strategy = getChStrategy(chapterId);
  if (strategy) {
    strategy.typeCounts.single = tcSingle;
    strategy.typeCounts.judge = tcJudge;
    strategy.typeCounts.term = tcTerm;
    strategy.typeCounts.short = tcShort;
    saveState();
  }
  var totalQ = tcSingle + tcJudge + tcTerm + tcShort;
  if (totalQ === 0) { alert('请至少设置一道题目的数量'); return; }
  var task = { id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2), chapterId: chapterId, chapterName: ch.name, status: 'pending', promptText: generatePromptText(chapterId), materialNames: materials.map(function(m){return m.name;}), strategySnapshot: strategy ? JSON.parse(JSON.stringify(strategy)) : null, createdAt: Date.now(), completedAt: null, questionCount: 0, error: '', streamQuestionCount: 0, streamSetRef: null };
  state.aiTaskQueue.push(task);
  saveState();
  if (!aiTaskRunnerActive) { aiTaskRunnerActive = true; aiTaskRunnerLoop(); }
  updateAiTaskStatusBar();
  renderAiTaskQueueDialog();
  var position = state.aiTaskQueue.filter(function(t) { return t.status === 'pending'; }).length;
  showAiTaskNotification('info', ch.name + ' 已加入队列，排在第 ' + position + ' 位');
  updateGenerateButtonState();
}
function positionCardBottomBar() { var bar=document.getElementById('chapter-card-bottom-bar'); var card=document.getElementById('chapter-prompt-card'); if(!bar||!card||bar.style.display==='none')return; var cr=card.getBoundingClientRect(); bar.style.left=cr.left+'px'; bar.style.width=cr.width+'px'; }
function applyAiModeUi() { const enabled=!!state.aiEnabled; const toggle=document.getElementById('ai-global-toggle'); if(toggle)toggle.checked=enabled; const aiSections=[...document.querySelectorAll('#ai-materials-section, #ai-generate-section')]; const trad=document.getElementById('traditional-steps'); aiSections.forEach(s=>s.classList.toggle('ai-mode-hidden', !enabled)); if(trad)trad.classList.toggle('ai-mode-hidden', enabled); var bar=document.getElementById('chapter-card-bottom-bar'); var ch=getCh(); if(bar){bar.style.display=(enabled&&ch)?'flex':'none';if(enabled&&ch)positionCardBottomBar();} var main=document.getElementById('main'); if(main)main.style.paddingBottom=(enabled&&ch)?'52px':''; updateAiMaterialCount(); updateTopbarAiIndicator(); updateGenerateButtonState(); }
function updateGenerateButtonState() { var btn=document.getElementById('btn-ai-generate-sticky'); var status=document.getElementById('card-bar-status'); if(!btn)return; var ch=getCh(); var materials=ch?getChapterMaterials(ch.id):[]; var hasDup=state.aiTaskQueue&&state.aiTaskQueue.some(function(t){return t.chapterId===(ch?ch.id:null)&&(t.status==='pending'||t.status==='running');}); if(!ch){btn.className='btn btn-small btn-secondary';btn.disabled=true;if(status)status.textContent='请先选择一个章节';}else if(materials.length===0){btn.className='btn btn-small btn-secondary';btn.disabled=true;if(status)status.textContent='请先上传复习资料';}else if(!isOnlineMode||!getToken()){btn.className='btn btn-small btn-secondary';btn.disabled=true;if(status)status.textContent='请先登录';}else if(hasDup){btn.className='btn btn-small btn-secondary';btn.disabled=true;if(status)status.textContent='该章节已有任务在队列中';}else{btn.className='btn btn-success btn-small';btn.disabled=false;if(status)status.textContent='已准备就绪，共 '+materials.length+' 份资料';}}
function handleStickyGenerate() { var ch=getCh(); if(!ch){alert('请先选择一个章节');return;} var materials=getChapterMaterials(ch.id); if(!materials||materials.length===0){alert('请先上传复习资料');return;} if(!isOnlineMode||!getToken()){alert('请先登录');return;} aiEnqueueGenerate(ch.id); }
function updateAiMaterialCount() { const ch=getCh(); if(!ch)return; const materials=getChapterMaterials(ch.id); const el=document.getElementById('ai-material-count'); if(el)el.textContent=materials.length?materials.length+' 份资料已上传':'请先上传资料'; }
function formatFileSize(bytes) { if(bytes<1024)return bytes+' B'; if(bytes<1048576)return (bytes/1024).toFixed(1)+' KB'; return (bytes/1048576).toFixed(1)+' MB'; }
function handleAiFileSelect(e) { const files=e.target.files; if(!files.length)return; handleAiFiles(files); e.target.value=''; }
function handleAiMaterialDrop(e) { e.preventDefault(); e.currentTarget.classList.remove('dragover'); handleAiFiles(e.dataTransfer.files); }
function handleAiFiles(files) { const ch=getCh(); if(!ch){alert('请先选择章节');return;} const materials=getChapterMaterials(ch.id); var allowedExts=['pdf','doc','docx','pptx','txt','md']; let remaining=files.length; for(let i=0;i<files.length;i++){ const f=files[i]; var ext=f.name.split('.').pop().toLowerCase(); if(allowedExts.indexOf(ext)===-1){alert(f.name+' 类型不支持，已跳过');remaining--;continue;} if(f.size>20*1024*1024){alert(f.name+' 超过20MB，已跳过');remaining--;continue;} if(materials.find(function(m){return m.name===f.name&&m.size===f.size;})){alert(f.name+' 已存在，已跳过');remaining--;continue;} const reader=new FileReader(); (function(file, mat){ reader.onload=async function(ev){ var mid=generateMaterialId(); mat.push({name:file.name,size:file.size,addedAt:Date.now(),id:mid}); saveChapterMaterials(ch.id, mat); try{ await idbStoreMaterial(mid, ev.target.result); }catch(e){ alert('保存资料失败：'+file.name); var idx=mat.length-1; mat.splice(idx,1); saveChapterMaterials(ch.id, mat); } try { var upFd = new FormData(); var dec2 = atob(ev.target.result.split(',')[1]); var bin2 = new Uint8Array(dec2.length); for(var k=0;k<dec2.length;k++) bin2[k]=dec2.charCodeAt(k); upFd.append('file', new Blob([bin2]), file.name); upFd.append('chapterId', ch.id); fetchWithAuth('/files/upload', { method: 'POST', body: upFd }).catch(function(){ }); } catch(e) {} renderAiMaterialList(); updateAiMaterialCount(); updateGenerateButtonState(); }; })(f, materials); reader.readAsDataURL(f); } }
function renderAiMaterialList() { const ch=getCh(); if(!ch)return; const materials=getChapterMaterials(ch.id); const container=document.getElementById('ai-materials-file-list'); if(!container)return; if(!materials.length){container.innerHTML='<span style="color:#bbb;font-size:13px;">暂无资料</span>';return;} let html=''; materials.forEach((m,i)=>{ html+='<div class="ai-material-file"><span class="am-name">'+escapeHtml(m.name)+'</span><span class="am-size">'+formatFileSize(m.size)+'</span><button class="am-del" onclick="removeAiMaterial('+i+')" title="删除">✕</button></div>'; }); container.innerHTML=html; }
function removeAiMaterial(idx) { const ch=getCh(); if(!ch)return; const materials=getChapterMaterials(ch.id); var removed=materials.splice(idx,1); if(removed.length) idbDeleteMaterial(removed[0].id); saveChapterMaterials(ch.id, materials); renderAiMaterialList(); updateAiMaterialCount(); updateGenerateButtonState(); }
function openChapterMaterialsDialog() { const ch=getCh(); if(!ch)return; document.getElementById('cm-dialog-chapter-name').textContent='📖 '+escapeHtml(ch.name); renderChapterMaterialsDialog(); document.getElementById('chapter-materials-dialog').classList.add('active'); }
function closeChapterMaterialsDialog() { document.getElementById('chapter-materials-dialog').classList.remove('active'); }
async function openFilePoolForChapter() {
  var ch = getCh();
  if (!ch) { alert('请先选择章节'); return; }
  if (!isOnlineMode || !getToken()) { alert('请先登录以使用文件池'); return; }
  try {
    var res = await fetchWithAuth('/files?pool=true');
    if (!res || !res.ok) { alert('获取文件池失败'); return; }
    var data = await res.json();
    var files = data.files || [];
    if (!files.length) { alert('文件池为空，请先在用户中心上传文件'); return; }
    // Build a simple picker
    var html = '<div style="max-height:300px;overflow-y:auto;">';
    files.forEach(function(f) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:6px;cursor:pointer;" onclick="assignFilePoolToChapter(' + f.id + ',\'' + escapeHtml(f.originalName).replace(/'/g, "\\'") + '\')" onmouseenter="this.style.borderColor=\'#4facfe\'" onmouseleave="this.style.borderColor=\'#e0e0e0\'">';
      html += '<span style="font-size:20px;">' + getFileIcon(f.mimeType) + '</span>';
      html += '<div style="flex:1;min-width:0;"><div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(f.originalName) + '</div><div style="font-size:11px;color:#888;">' + formatFileSize(f.fileSize) + '</div></div>';
      html += '<span style="font-size:11px;color:#4facfe;">选择</span>';
      html += '</div>';
    });
    html += '</div>';
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay active';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:2000;';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="dialog-box" style="max-width:420px;"><h3>📁 从文件池选择</h3><p style="font-size:12px;color:#888;margin-bottom:10px;">点击文件将其分配到当前章节</p>' + html + '<div class="dialog-actions"><button class="btn btn-secondary btn-small" onclick="this.closest(\'.dialog-overlay\').remove()">关闭</button></div></div>';
    document.body.appendChild(overlay);
  } catch(e) { alert('获取文件池失败: ' + e.message); }
}
async function assignFilePoolToChapter(fileId, fileName) {
  var ch = getCh();
  if (!ch) return;
  try {
    var res = await fetchWithAuth('/files/' + fileId + '/assign', {
      method: 'POST',
      body: JSON.stringify({ chapterId: ch.id })
    });
    if (!res || !res.ok) {
      var err = await (res ? res.json().catch(function() { return {}; }) : {});
      alert('分配失败: ' + (err.error || '网络错误'));
      return;
    }
    // Close the picker overlay
    var overlay = document.querySelector('.dialog-overlay.active');
    if (overlay && overlay.querySelector('h3') && overlay.querySelector('h3').textContent.indexOf('文件池') >= 0) {
      overlay.remove();
    }
    // Add pool reference to chapter materials so button enables
    var materials = getChapterMaterials(ch.id);
    if (!materials.some(function(m) { return m._poolFile && m.name === fileName; })) {
      materials.push({ name: fileName, size: 0, addedAt: Date.now(), id: 'pool_' + fileId, _poolFile: true });
      saveChapterMaterials(ch.id, materials);
    }
    renderChapterMaterialsDialog();
    renderAiMaterialList();
    updateAiMaterialCount();
    updateGenerateButtonState();
  } catch(e) { alert('分配失败: ' + e.message); }
}
function renderChapterMaterialsDialog() { const ch=getCh(); if(!ch)return; const materials=getChapterMaterials(ch.id); const container=document.getElementById('cm-dialog-list'); if(!materials.length){container.innerHTML='<div class="empty-state">暂无复习资料</div>';return;} let html=''; materials.forEach((m,i)=>{ html+='<div class="ai-material-file"><span class="am-name">'+escapeHtml(m.name)+'</span><span class="am-size">'+formatFileSize(m.size)+'</span><button class="am-del" onclick="removeChapterMaterial('+i+');renderChapterMaterialsDialog();">✕</button></div>'; }); container.innerHTML=html; }
function removeChapterMaterial(idx) { const ch=getCh(); if(!ch)return; const materials=getChapterMaterials(ch.id); var removed=materials.splice(idx,1); if(removed.length) idbDeleteMaterial(removed[0].id); saveChapterMaterials(ch.id, materials); }
function handleCmFileSelect(e) { const files=e.target.files; if(!files.length)return; handleCmFiles(files); e.target.value=''; }
function handleCmFiles(files) { const ch=getCh(); if(!ch)return; const materials=getChapterMaterials(ch.id); var allowedExts=['pdf','doc','docx','pptx','txt','md']; for(let i=0;i<files.length;i++){ const f=files[i]; var ext=f.name.split('.').pop().toLowerCase(); if(allowedExts.indexOf(ext)===-1){alert(f.name+' 类型不支持，已跳过');continue;} if(f.size>20*1024*1024){alert(f.name+' 超过20MB');continue;} if(materials.find(function(m){return m.name===f.name&&m.size===f.size;})){alert(f.name+' 已存在，已跳过');continue;} const reader=new FileReader(); (function(file, mat){ reader.onload=async function(ev){ var mid=generateMaterialId(); mat.push({name:file.name,size:file.size,addedAt:Date.now(),id:mid}); saveChapterMaterials(ch.id, mat); try{ await idbStoreMaterial(mid, ev.target.result); }catch(e){ alert('保存资料失败：'+file.name); var idx=mat.length-1; mat.splice(idx,1); saveChapterMaterials(ch.id, mat); } try { var upFd2 = new FormData(); var dec3 = atob(ev.target.result.split(',')[1]); var bin3 = new Uint8Array(dec3.length); for(var k=0;k<dec3.length;k++) bin3[k]=dec3.charCodeAt(k); upFd2.append('file', new Blob([bin3]), file.name); upFd2.append('chapterId', ch.id); fetchWithAuth('/files/upload', { method: 'POST', body: upFd2 }).catch(function(){ }); } catch(e) {} renderChapterMaterialsDialog(); renderAiMaterialList(); updateAiMaterialCount(); updateGenerateButtonState(); }; })(f, materials); reader.readAsDataURL(f); } }
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function fetchWithRetry(url, options, retries, delay) {
  for(let i=0;i<retries;i++){
    try{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(), 300000);
      const res=await fetch(url, {...options, signal:controller.signal});
      clearTimeout(timeout);
      if(!res.ok){
        const err=await res.json().catch(()=>({}));
        const msg=err.error||res.status+' '+res.statusText;
        if(res.status===429||res.status===500||res.status===502||res.status===503){
          if(i<retries-1){await sleep(delay*(i+1));continue;}
          else throw new Error('服务器 busy，'+msg);
        }
        throw new Error(msg);
      }
      return res;
    }catch(e){
      if(i<retries-1){
        if(e.name==='AbortError') await sleep(delay*(i+1));
        else await sleep(delay*(i+1));
        continue;
      }
      if(e.name==='AbortError') throw new Error('请求超时（超过5分钟），请减少资料后重试');
      throw e;
    }
  }
}
function aiGenerateQuestions() { aiEnqueueGenerate(state.currentChapterId); }
function simpleHash(str) { let h=0; for(let i=0;i<str.length;i++) h=((h<<5)-h+str.charCodeAt(i))|0; return h.toString(36); }
function getQuestionId(chId,q) { return chId+':'+simpleHash((q.question||'')); }
function isQuestionIgnored(chId,q) { return state.ignoredQuestions&&state.ignoredQuestions.includes(getQuestionId(chId,q)); }
function isQuestionFavorite() { return false; }
function toggleFavorite() {}
function ignoreCurrentQuestion() { const as=getActiveSet(); if(!as)return; const q=as.questions[as.currentIdx]; if(!q)return; if(!state.ignoredQuestions)state.ignoredQuestions=[]; const qId=getQuestionId(as.setId,q); if(!state.ignoredQuestions.includes(qId)){state.ignoredQuestions.push(qId);} if(q.type==='single'||q.type==='judge'){as.userAnswers[as.currentIdx]=q.answer;} else {as.userAnswers[as.currentIdx]='(已掌握)';} saveState(); if(as.currentIdx<as.questions.length-1){as.setCurrentIdx(as.currentIdx+1);} renderQuestion(); updateProgress(); }
window.addEventListener('resize', function() { positionCardBottomBar(); });