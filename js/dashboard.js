function showSubjectDashboard(subjId) { const s=state.subjects[subjId]; if (!s) return; document.getElementById('subj-dash-title').textContent='📊 '+escapeHtml(s.name); document.querySelectorAll('.subj-tab-content').forEach(el=>el.classList.remove('active')); document.querySelectorAll('.subj-tab').forEach(el=>el.classList.remove('active')); const ot=document.querySelector('.subj-tab[data-tab="overview"]'); if(ot)ot.classList.add('active'); const oc=document.getElementById('subj-tab-overview'); if(oc)oc.classList.add('active'); try{renderSubjOverview(s);}catch(e){console.error('renderSubjOverview error:',e);} try{renderSubjQuestionBank(s);}catch(e){console.error('renderSubjQuestionBank error:',e);} try{renderSubjComposeExam(s);}catch(e){console.error('renderSubjComposeExam error:',e);} try{renderSubjSrsReview(s);}catch(e){console.error('renderSubjSrsReview error:',e);} showScreen('subject-dash'); }
function switchSubjTab(tab) { document.querySelectorAll('.subj-tab-content').forEach(el=>el.classList.remove('active')); document.querySelectorAll('.subj-tab').forEach(el=>el.classList.remove('active')); const te=document.querySelector('.subj-tab[data-tab="'+tab+'"]'); if(te)te.classList.add('active'); const ce=document.getElementById('subj-tab-'+tab); if(ce)ce.classList.add('active'); }
function renderSubjOverview(s) {
  let totalQs=0,totalAnswered=0,objCorrect=0,objTotal=0,wrongCount=0,totalRounds=0;
  let histAnswered=0,histCorrect=0,histWrong=0;
  let typeDist={single:0,judge:0,term:0,short:0};
  const chStats=[];
  s.chapterIds.forEach(cid=>{
    totalRounds+=(state.history||[]).filter(r=>r.chapterId===cid).length;
    const ch=state.chapters[cid];if(!ch||!ch.questions)return;
    totalQs+=ch.questions.length;let cCor=0,cTot=0,cAns=0,cWr=0;
    ch.questions.forEach((q,i)=>{typeDist[q.type]=(typeDist[q.type]||0)+1;
    if(ch.userAnswers[i]!==undefined){cAns++;}
    if(isObjType(q.type)){cTot++;const ci=getCi(q,ch.userAnswers[i]);if(ci===true){cCor++;}else if(ci===false){cWr++;}}});
    chStats.push({name:ch.name,rate:cTot>0?Math.round(cCor/cTot*100):0,total:cTot,correct:cCor,wrong:cWr,answered:cAns});
  });
  (state.history||[]).forEach(r=>{if(!s.chapterIds.includes(r.chapterId)||!r.questions)return;
  r.questions.forEach(q=>{if(q.userAnswer!==undefined)histAnswered++;if(isObjType(q.type)){if(q.isCorrect===true)histCorrect++;else if(q.isCorrect===false)histWrong++;}});});
  objCorrect=histCorrect; objTotal=histCorrect+histWrong; wrongCount=histWrong; totalAnswered=histAnswered;
  const rate=objTotal>0?Math.round(objCorrect/objTotal*100):(totalAnswered>0?100:0);
  const o=document.getElementById('subj-tab-overview');if(!o)return;
  let h='<div class="enhanced-overview">';
  h+='<div class="eo-section"><h4>📊 总览</h4><div class="subj-dash-grid">';
  h+='<div class="subj-dash-card"><div class="num">'+s.chapterIds.length+'</div><div class="label">📂 章节</div></div>';
  h+='<div class="subj-dash-card"><div class="num">'+totalQs+'</div><div class="label">📝 当前题数</div></div>';
  h+='<div class="subj-dash-card"><div class="num">'+totalRounds+'</div><div class="label">🔄 总轮次</div></div>';
  h+='<div class="subj-dash-card"><div class="num">'+histAnswered+'</div><div class="label">✍️ 累计答题</div></div>';
  h+='<div class="subj-dash-card"><div class="num" style="color:#2ed573">'+histCorrect+'</div><div class="label">✅ 正确</div></div>';
  h+='<div class="subj-dash-card"><div class="num" style="color:#e94560">'+histWrong+'</div><div class="label">❌ 错误</div></div>';
  h+='<div class="subj-dash-card"><div class="num" style="color:#4facfe">'+rate+'%</div><div class="label">📊 正确率</div></div>';
  h+='</div></div>';
  if(chStats.length>0){
    h+='<div class="eo-section"><h4>📖 各章节正确率</h4>';
    chStats.forEach(cs=>{const color=cs.rate>=70?'#2ed573':cs.rate>=40?'#f59e0b':'#e94560';
    h+='<div class="eo-chapter-item"><div class="eo-chapter-name"><span>'+escapeHtml(cs.name)+'</span><span>'+cs.rate+'% ('+cs.correct+'/'+cs.total+')</span></div>';
    h+='<div class="eo-chapter-bar"><div class="eo-chapter-fill" style="width:'+cs.rate+'%;background:'+color+'"></div></div></div>';});
    h+='</div>';
  }
  const allRounds=(state.history||[]).filter(r=>s.chapterIds.includes(r.chapterId)&&r.questions&&r.questions.length>0);
  if(allRounds.length>=2){
    const rates=allRounds.map(r=>r.rate||0);
    let sumX=0,sumY=0,sumXY=0,sumXX=0,n=rates.length;
    for(let i=0;i<n;i++){sumX+=i;sumY+=rates[i];sumXY+=i*rates[i];sumXX+=i*i;}
    const slope=(n*sumXY-sumX*sumY)/(n*sumXX-sumX*sumX||1);
    let trendIcon,trendText;
    if(slope>2){trendIcon='📈';trendText='实力提升中（每轮平均 +'+slope.toFixed(1)+'%）';}
    else if(slope<-2){trendIcon='📉';trendText='实力下降中（每轮平均 '+slope.toFixed(1)+'%）';}
    else{trendIcon='➡️';trendText='实力稳定（每轮变化 '+slope.toFixed(1)+'%）';}
    h+='<div class="eo-section"><h4>📈 实力趋势</h4><div class="eo-trend-row"><span class="eo-trend-icon">'+trendIcon+'</span><span class="eo-trend-text">'+trendText+'</span></div>';
    h+='<div class="eo-sparkline">';rates.forEach((r,i)=>{const color=r>=70?'#2ed573':r>=40?'#f59e0b':'#e94560';h+='<div class="eo-sparkline-bar" style="height:'+Math.max(r,5)+'%;background:'+color+'" title="第'+(i+1)+'轮: '+r+'%"></div>';});
    h+='</div></div>';
  }
  if(chStats.length>=2){
    const sorted=[...chStats].sort((a,b)=>b.rate-a.rate);
    const best=sorted[0],worst=sorted[sorted.length-1];
    h+='<div class="eo-section"><h4>⭐ 最佳与待提升</h4><div class="eo-highlight">';
    h+='<div class="eo-highlight-card"><div class="eo-hc-label">🥇 最佳章节</div><div class="eo-hc-value" style="color:#2ed573">'+escapeHtml(best.name)+' '+best.rate+'%</div></div>';
    h+='<div class="eo-highlight-card"><div class="eo-hc-label">📌 待提升</div><div class="eo-hc-value" style="color:#e94560">'+escapeHtml(worst.name)+' '+worst.rate+'%</div></div>';
    h+='</div></div>';
  }
  const totalType=Object.values(typeDist).reduce((a,b)=>a+b,0)||1;
  const typeColors={single:'#4facfe',judge:'#f59e0b',term:'#8b5cf6',short:'#e94560'};
  const typeNames={single:'单选',judge:'判断',term:'名词解释',short:'简答'};
  h+='<div class="eo-section"><h4>📚 题型分布</h4><div class="eo-type-bar">';
  for(const t in typeDist){if(typeDist[t]>0){const pct=Math.round(typeDist[t]/totalType*100);h+='<div class="eo-type-seg" style="width:'+pct+'%;background:'+typeColors[t]+'">'+typeNames[t]+'</div>';}}
  h+='</div><div class="eo-type-legend">';
  for(const t in typeDist){h+='<div class="eo-type-legend-item"><span class="eo-type-legend-dot" style="background:'+typeColors[t]+'"></span>'+typeNames[t]+' '+typeDist[t]+'</div>';}
  h+='</div></div></div>';
  o.innerHTML=h;
}
var _qbankSelected = {}; // { flatKey: questionObj } for batch sharing
function renderSubjQuestionBank(s) { const container=document.getElementById('subj-tab-questionbank'); if(!container) return; container.innerHTML='<div class="qbank-toolbar"><label><input type="checkbox" id="qbank-only-wrong" onchange="renderSubjQuestionBankContent()"> ❌ 仅显示错题</label><div class="qbank-search">🔍 <input type="text" id="qbank-search-input" placeholder="搜索题目/标签..." oninput="renderSubjQuestionBankContent()"></div></div><div id="qbank-content"></div>'; renderSubjQuestionBankContent(s); }
function renderSubjQuestionBankContent(subjOverride) { const s=subjOverride||getSubj(); if(!s) return; const onlyWrong=document.getElementById('qbank-only-wrong')?.checked||false; const keyword=(document.getElementById('qbank-search-input')?.value||'').trim().toLowerCase(); const container=document.getElementById('qbank-content'); if(!container) return; let html=''; s.chapterIds.forEach(cid=>{const ch=state.chapters[cid];if(!ch)return;const history=(state.history||[]).filter(r=>r.chapterId===cid);let chHtml='<div class="qbank-chapter-group"><div class="qbc-header">📂 '+escapeHtml(ch.name)+' <span>'+(ch.questions?ch.questions.length:0)+' 题 · '+history.length+' 次答题</span></div>';if(history.length===0&&(!ch.questions||ch.questions.length===0)){chHtml+='<div class="empty-state" style="padding:12px;">无数据</div></div>';html+=chHtml;return;}history.forEach((r,ri)=>{let hasVisible=false,roundHtml='';if(r.questions){r.questions.forEach((q,qi)=>{const ci=q.isCorrect;if(onlyWrong&&ci!==false)return;if(keyword&&!(q.question&&q.question.toLowerCase().includes(keyword))&&!(q.tag&&q.tag.toLowerCase().includes(keyword))&&!(q.explanation&&q.explanation.toLowerCase().includes(keyword)))return;hasVisible=true;const tm={single:'单选',judge:'判断',term:'名词解释',short:'简答'};const icon=ci===true?'✅':(ci===false?'❌':'⏳');roundHtml+='<div class="qbank-question '+(ci===true?'correct':ci===false?'wrong':'unanswered')+'" onclick="event.stopPropagation();showQDetailFromBank('+JSON.stringify(q).replace(/"/g,'&quot;')+','+ri+','+qi+')"><p class="q-text">'+icon+' ['+(tm[q.type]||q.type)+'] '+escapeHtml(q.tag||'')+'：'+escapeHtml((q.question||'').substring(0,60))+((q.question||'').length>60?'...':'')+'</p>';if(q.explanation)roundHtml+='<p class="q-detail">📖 '+escapeHtml(q.explanation.substring(0,80))+'</p>';roundHtml+='<label class="qbank-check-label" onclick="event.stopPropagation();" style="display:inline-flex;align-items:center;gap:3px;margin-left:8px;font-size:11px;color:var(--text-muted);"><input type="checkbox" class="qbank-check" onchange="_qbankOnCheck(this)" data-qdata="'+JSON.stringify(q).replace(/"/g,'&quot;').replace(/'/g,'&#39;')+'"> 加入分享车</label></div>';});}if(hasVisible){chHtml+='<div class="qbank-round" onclick="this.classList.toggle(\'expanded\')"><div class="qbank-round-header"><span>🕐 '+escapeHtml(r.date)+'</span><span>✅ '+(r.correct||0)+' / ❌ '+(r.wrong||0)+' / 📊 '+(r.rate||0)+'%</span></div><div class="qbank-round-detail">'+roundHtml+'</div></div>';}});if(!onlyWrong&&ch.questions&&ch.questions.length>0){const unanswered=ch.questions.filter((q,i)=>ch.userAnswers[i]===undefined);if(unanswered.length>0){let pendingHtml='';unanswered.forEach((q,i)=>{if(keyword&&!q.question.toLowerCase().includes(keyword)&&!(q.tag&&q.tag.toLowerCase().includes(keyword)))return;pendingHtml+='<div class="qbank-question unanswered" onclick="event.stopPropagation();showQDetailFromBank('+JSON.stringify(q).replace(/"/g,'&quot;')+',-1,'+i+')"><p class="q-text">⏳ ['+(q.type==='single'?'单选':q.type==='judge'?'判断':q.type==='term'?'名词解释':'简答')+'] '+escapeHtml(q.tag||'')+'：'+escapeHtml(q.question.substring(0,60))+'</p></div>';});if(pendingHtml){chHtml+='<div class="qbank-round" onclick="this.classList.toggle(\'expanded\')"><div class="qbank-round-header"><span>⏳ 未答题 ('+unanswered.length+' 题)</span></div><div class="qbank-round-detail">'+pendingHtml+'</div></div>';}}}chHtml+='</div>';html+=chHtml;});if(!html)html='<div class="empty-state">没有符合条件的题目</div>';container.innerHTML=html;}
function showQDetailFromBank(q,roundIdx,qIdx){if(!q)return;const tm={single:'单选题',judge:'判断题',term:'名词解释',short:'简答题'};let html='<div class="qd-question"><strong>第'+(qIdx+1)+'题 ['+(tm[q.type]||q.type)+']</strong> '+(q.tag?'🏷️ '+escapeHtml(q.tag):'')+'</div><div class="qd-question">'+renderMarkdown(q.question)+'</div>';if(q.type==='single'||q.type==='judge'){html+='<div class="qd-answer"><strong>选项：</strong><br>';(q.options||[]).forEach((opt,i)=>{html+=String.fromCharCode(65+i)+'. '+renderMarkdown(opt)+(i===q.answer?' <span style="color:#2ed573;">✓</span>':'')+'<br>';});html+='</div>';}if(q.userAnswer!==undefined){const ci=q.isCorrect!==undefined?q.isCorrect:getCi(q,q.userAnswer);var yl='',yt='';if((q.type==='single'||q.type==='judge')&&q.options){var lbs=['A','B','C','D','E','F'];yl=lbs[q.userAnswer]||String(q.userAnswer);yt=q.options[q.userAnswer]||'';}else{yt=String(q.userAnswer);}html+='<div class="qd-answer"><strong>你的答案：</strong> '+(ci===true?'✅ ':ci===false?'❌ ':'')+(yl?yl+'. ':'')+escapeHtml(yt)+'</div>';}if(q.answer!==undefined&&q.answer!==null&&(q.type==='single'||q.type==='judge')){var lbs3=['A','B','C','D','E','F'];var cl3=lbs3[q.answer]||String(q.answer);html+='<div class="qd-answer"><strong>✅ 正确答案：</strong>'+cl3+'. '+escapeHtml(String((q.options&&q.options[q.answer])||''))+'</div>';}if(q.explanation)html+='<div class="qd-explanation"><h4>📖 解析</h4>'+renderMarkdown(q.explanation)+'</div>';document.getElementById('qd-title').textContent='📖 题目详情'+(roundIdx>=0?' (第'+(roundIdx+1)+'轮)':' (未答题)');document.getElementById('qd-content').innerHTML=html;document.getElementById('qdetail-dialog').classList.add('active');}

// =============================================================================
//  Batch Share from Question Bank (v3.9.5)
// =============================================================================

var _qbankSelected = {};       // { key: questionObj }
var _qbankSelectMode = false;

function _qbankToggleSelectMode() {
  _qbankSelectMode = document.getElementById('qbank-select-mode')?.checked || false;
  if (!_qbankSelectMode) _qbankClearSelection();
  renderSubjQuestionBankContent();
  // Add delegated click handler for select mode
  var container = document.getElementById('qbank-content');
  if (container) {
    if (_qbankSelectMode) {
      container.classList.add('qbank-selecting');
    } else {
      container.classList.remove('qbank-selecting');
    }
  }
}

// Delegated click: when in select mode, intercept clicks on questions
document.addEventListener('click', function(e) {
  if (!_qbankSelectMode) return;
  var qItem = e.target.closest('.qbank-question');
  if (!qItem) return;
  var qbankContent = document.getElementById('qbank-content');
  if (!qbankContent || !qbankContent.contains(qItem)) return;
  e.stopPropagation();
  e.preventDefault();
  // Toggle selection via data attributes
  var key = qItem.getAttribute('data-qkey');
  if (!key) return;
  var questionData = null;
  try { questionData = JSON.parse(qItem.getAttribute('data-qdata') || 'null'); } catch(ex) {}
  _qbankToggleCheckEl(key, questionData, qItem);
});

function _qbankGetCheckKey(chapterId, roundIdx, qIdx) {
  return chapterId + ':' + roundIdx + ':' + qIdx;
}


function _qbankInjectAttrs() {
  var container = document.getElementById('qbank-content');
  if (!container) return;
  var questions = container.querySelectorAll('.qbank-question');
  questions.forEach(function(q, idx) {
    // Generate key from parent structure
    var roundEl = q.closest('.qbank-round');
    var chapterEl = q.closest('.qbank-chapter-group');
    var roundIdx = -1, chapterId = '';
    if (roundEl) {
      var allRounds = chapterEl ? chapterEl.querySelectorAll('.qbank-round') : [];
      allRounds.forEach(function(r, i) { if (r === roundEl) roundIdx = i; });
    }
    if (chapterEl) {
      chapterId = chapterEl.getAttribute('data-chapter-id') || '';
    }
    // Extract question data from the onclick handler
    var onclick = q.getAttribute('onclick') || '';
    // Store a simple index-based key
    q.setAttribute('data-qkey', 'q_' + idx);
    // Store basic question info
    var qText = (q.querySelector('.q-text')?.textContent || '').substring(0, 100);
    q.setAttribute('data-qdata', JSON.stringify({ question: qText, idx: idx }));
  });
}

function _qbankToggleCheck(chapterId, roundIdx, qIdx, question, el) {
  var key = _qbankGetCheckKey(chapterId, roundIdx, qIdx);
  if (_qbankSelected[key]) {
    delete _qbankSelected[key];
    if (el) { el.classList.remove('qbank-selected'); }
  } else {
    _qbankSelected[key] = question;
    if (el) { el.classList.add('qbank-selected'); }
  }
  _qbankUpdateShareBar();
}

function _qbankToggleCheckEl(key, question, el) {
  if (_qbankSelected[key]) {
    delete _qbankSelected[key];
    if (el) { el.classList.remove('qbank-selected'); }
  } else {
    _qbankSelected[key] = question;
    if (el) { el.classList.add('qbank-selected'); }
  }
  _qbankUpdateShareBar();
}

function _qbankClearSelection() {
  _qbankSelected = {};
  var selectModeEl = document.getElementById('qbank-select-mode');
  if (selectModeEl) selectModeEl.checked = false;
  _qbankSelectMode = false;
  var shareBar = document.getElementById('qbank-share-bar');
  if (shareBar) shareBar.style.display = 'none';
  // Remove old selection classes
  document.querySelectorAll('.qbank-question.qbank-selected').forEach(function(el) { el.classList.remove('qbank-selected'); });
  // Also clear new cart system
  _qbankCart = {};
  _qbankRenderCart();
  document.querySelectorAll('.qbank-check').forEach(function(cb) { cb.checked = false; });
  var container = document.getElementById('qbank-content');
  if (container) container.classList.remove('qbank-selecting');
  renderSubjQuestionBankContent();
}

function _qbankUpdateShareBar() {
  var bar = document.getElementById('qbank-share-bar');
  var countEl = document.getElementById('qbank-share-count');
  if (!bar || !countEl) return;
  var count = Object.keys(_qbankSelected).length;
  if (count > 0) {
    bar.style.display = 'flex';
    countEl.textContent = '已选 ' + count + ' 题';
  } else {
    bar.style.display = 'none';
  }
}

function _qbankShareSelected() {
  var questions = [];
  Object.keys(_qbankSelected).forEach(function(k) {
    questions.push(_qbankSelected[k]);
  });
  if (questions.length === 0) {
    if (typeof showToast === 'function') showToast('请先选择题日');
    return;
  }

  // Build a simple dialog to choose friend or group
  // First load friends
  _qbankShowShareDialog(questions);
}

function _qbankShowShareDialog(questions) {
  var dialog = document.getElementById('qbank-share-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'qbank-share-dialog';
    dialog.className = 'dialog-overlay';
    dialog.setAttribute('onclick', 'if(event.target===this)_qbankCloseShareDialog()');
    document.body.appendChild(dialog);
  }

  var html = '<div class="dialog-box chat-sub-dialog-box" onclick="event.stopPropagation()">' +
    '<h3 class="chat-sub-dialog-title">📤 分享 ' + questions.length + ' 道题目</h3>' +
    '<div style="margin-bottom:10px;">' +
    '<input type="text" class="chat-user-search-input" id="qbank-share-search" placeholder="搜索好友..." oninput="_qbankFilterShareTargets()">' +
    '</div>' +
    '<div id="qbank-share-targets" style="max-height:260px;overflow-y:auto;"></div>' +
    '</div>';

  dialog.innerHTML = html;
  dialog.classList.add('active');
  window._qbankPendingShare = questions;
  _qbankRenderShareTargets();
}

function _qbankCloseShareDialog() {
  var d = document.getElementById('qbank-share-dialog');
  if (d) d.classList.remove('active');
  window._qbankPendingShare = null;
}

async function _qbankRenderShareTargets(filterText) {
  var container = document.getElementById('qbank-share-targets');
  if (!container) return;
  var filter = (filterText || '').trim().toLowerCase();

  // Load friends if not loaded
  try {
    var res = await fetchWithAuth('/chat/friends');
    if (!res || !res.ok) return;
    var data = await res.json();
    var friends = data.friends || [];
  } catch(e) { return; }

  // Also load rooms (for group sharing)
  try {
    var roomRes = await fetchWithAuth('/chat/rooms');
    var roomData = roomRes && roomRes.ok ? await roomRes.json() : { rooms: [] };
    var rooms = roomData.rooms || [];
  } catch(e) { var rooms = []; }

  var html = '';
  if (friends.length === 0 && rooms.length === 0) {
    html = '<div class="chat-user-search-empty">暂无好友或群聊，请先在好友功能中添加好友</div>';
  } else {
    if (friends.length > 0) {
      html += '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:4px 0;">👤 好友</div>';
      friends.forEach(function(f) {
        var name = f.display_name || f.username;
        if (filter && name.toLowerCase().indexOf(filter) === -1) return;
        html += '<div class="chat-user-search-item" onclick="_qbankDoShare(\'friend\',' + f.id + ')" style="cursor:pointer;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
          '<div class="chat-friend-avatar">' + name.charAt(0).toUpperCase() + '</div>' +
          '<div class="chat-user-search-name">' + escapeHtml(name) + '</div>' +
          '</div></div>';
      });
    }
    if (rooms.length > 0) {
      html += '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:4px 0;">👥 群聊</div>';
      rooms.forEach(function(r) {
        if (r.type !== 'group') return;
        if (filter && (r.name || '').toLowerCase().indexOf(filter) === -1) return;
        html += '<div class="chat-user-search-item" onclick="_qbankDoShare(\'room\',' + r.id + ')" style="cursor:pointer;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
          '<div class="chat-room-avatar group">' + (r.name || '群').charAt(0).toUpperCase() + '</div>' +
          '<div class="chat-user-search-name">' + escapeHtml(r.name || '群聊') + '</div>' +
          '</div></div>';
      });
    }
  }
  container.innerHTML = html;
}

function _qbankFilterShareTargets() {
  var filter = document.getElementById('qbank-share-search')?.value || '';
  _qbankRenderShareTargets(filter);
}

async function _qbankDoShare(type, targetId) {
  var questions = window._qbankPendingShare || [];
  if (questions.length === 0) return;
  _qbankCloseShareDialog();

  var roomId;
  try {
    if (type === 'friend') {
      var res = await fetchWithAuth('/chat/rooms', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', friendId: targetId })
      });
      if (!res.ok) { if (typeof showToast === 'function') showToast('创建会话失败'); return; }
      var data = await res.json();
      roomId = data.roomId;
    } else {
      roomId = targetId;
    }
  } catch(e) {
    if (typeof showToast === 'function') showToast('操作失败: ' + e.message);
    return;
  }

  // Send each question
  var sendCount = 0;
  for (var i = 0; i < questions.length; i++) {
    try {
      var q = questions[i];
      var quizData = {
        questions: [q],
        setName: (q.question || '').substring(0, 30),
        chapterName: '',
        fromUserName: authUser.displayName || authUser.username,
        fromUserId: authUser.id
      };
      var sendRes = await fetchWithAuth('/chat/rooms/' + roomId + '/messages', {
        method: 'POST',
        body: JSON.stringify({ content: '', msg_type: 'quiz_share', quiz_data: quizData })
      });
      if (sendRes.ok) sendCount++;
    } catch(e) {}
  }

  _qbankClearSelection();
  if (typeof showToast === 'function') showToast('已分享 ' + sendCount + ' 道题目');
}

var _qbankCart = {};

function _qbankOnCheck(cb) {
  try {
    var q = JSON.parse(cb.getAttribute("data-qdata"));
    var key = q.question || ("q_" + Date.now() + "_" + Math.random());
    if (cb.checked) { _qbankCart[key] = q; }
    else { delete _qbankCart[key]; }
    _qbankRenderCart();
  } catch(e) {}
}

function _qbankRenderCart() {
  var cart = document.getElementById("qbank-cart");
  if (!cart) return;
  var keys = Object.keys(_qbankCart);
  if (keys.length === 0) { cart.style.display = "none"; return; }
  cart.style.display = "block";
  document.getElementById("qbank-cart-count").textContent = keys.length;
  var html = "";
  keys.forEach(function(k, idx) {
    var q = _qbankCart[k];
    html += "<span style=\"display:inline-flex;align-items:center;gap:3px;background:var(--surface-hover);padding:2px 8px;border-radius:12px;font-size:11px;\">";
    html += escapeHtml((q.question||"").substring(0,25)) + "… ";
    html += "<button data-cart-idx=\"" + idx + "\" onclick=\"event.stopPropagation();_qbankRemoveCartItem(" + idx + ");\" style=\"cursor:pointer;border:none;background:none;padding:0;font-size:13px;\">×</button></span>";
  });
  document.getElementById("qbank-cart-items").innerHTML = html;
}

function _qbankRemoveCartItem(idx) {
  var keys = Object.keys(_qbankCart);
  if (idx >= 0 && idx < keys.length) {
    var removedKey = keys[idx];
    delete _qbankCart[removedKey];
    document.querySelectorAll(".qbank-check").forEach(function(cb) {
      try { var q2 = JSON.parse(cb.getAttribute("data-qdata")); if (q2.question === removedKey) cb.checked = false; } catch(e) {}
    });
  }
  _qbankRenderCart();
}

function _qbankClearCart() {
  _qbankCart = {};
  _qbankRenderCart();
  document.querySelectorAll(".qbank-check").forEach(function(cb) { cb.checked = false; });
}

function _qbankShareCart() {
  var questions = Object.values(_qbankCart);
  if (questions.length === 0) {
    if (typeof showToast === "function") showToast("请先选择题目");
    return;
  }
  _qbankShowShareDialog(questions);
}
