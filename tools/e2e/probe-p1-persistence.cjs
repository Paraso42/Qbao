// QA probe P1.1 — 分层持久化回归（v3.31）
// 场景：2000+ 题题库（骨架 <5MB / IDB 分流）、刷新后活动会话续答、
//       多账号隔离切换、离线作答保留（pending 标记 + 骨架/IDB 双写）。
// 用法：cd desktop && npx electron ../tools/e2e/probe-p1-persistence.cjs
// 输出：tools/e2e/out/probe-p1-persistence-result.json（out/ 已 gitignore）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')
const OUT = path.join(__dirname, 'out', 'probe-p1-persistence-result.json')
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const RES = {}
async function js(win, label, code) {
  try {
    const r = await win.webContents.executeJavaScript(code, true)
    RES[label] = r
    console.log(label, '=>', typeof r === 'string' ? r.substring(0, 500) : JSON.stringify(r).substring(0, 500))
  } catch (e) { RES[label] = 'ERR: ' + e.message; console.log(label, 'FAIL', e.message) }
}

// —— 播种 1（未登录离线态）：2100 题 + 活动会话（已答 37 题，停在第 38 题） ——
const SEED_OFFLINE = `(function(){
  var now = Date.now();
  var N = 2100;
  var qs = [];
  for (var i = 0; i < N; i++) {
    qs.push({id:i+1,type:i%2===0?'single':'judge',question:'第'+(i+1)+'题：矩阵与极限的综合应用',options:['选项A','选项B','选项C','选项D'],answer:i%4,tag:'标签'+(i%5),strategy:i%3===0?'error':'new',explanation:'解析'+(i+1)});
  }
  var answers = [];
  for (var a = 0; a < N; a++) answers.push(a < 37 ? a % 4 : undefined);
  var st = {
    subjects:{s1:{id:'s1',name:'高等数学',chapterIds:['c1'],collapsed:false}},
    subjectOrder:['s1'], currentSubjectId:'s1', currentChapterId:'c1',
    chapters:{
      c1:{id:'c1',name:'第一章 极限与连续',questions:qs,userAnswers:answers,currentIdx:37,
        quizSets:[{questions:qs,userAnswers:answers,currentIdx:37,createdAt:now}],
        currentQuizSetIdx:0,
        strategy:{errPct:20,reviewPct:50,newPct:30,typeCounts:{single:5,judge:5,term:3,short:2},errorTags:[],reviewTags:[],newTopicTags:[],tagMeta:{}}}
    },
    history:[], lastScreen:'start',
    settings:{quizFontSize:17,sidebarFontSize:13,topbarFontSize:14,mainFontSize:17,darkMode:false,showNoticeBar:true},
    aiConfig:{provider:'ecnu',model:'ecnu-plus',apiKeySet:false},
    chapterMaterials:{}, aiTaskQueue:[], srsData:{}, generatedExams:{}, achievements:{unlocked:[],history:[]}, ignoredQuestions:[]
  };
  localStorage.clear();
  localStorage.setItem('quizEngineState_v7', JSON.stringify(st));
  // 活动会话（模拟 saveState 已写入的最新作答进度）
  localStorage.setItem('qbao_active_session', JSON.stringify({cid:'c1', qsIdx:0, questions:qs, userAnswers:answers, currentIdx:37}));
  return { seededQuestions: N, skeletonBytesBefore: localStorage.getItem('quizEngineState_v7').length };
})()`

// —— 播种 2（多账号）：u1 / u2 各自的账号键与小数据集 ——
const SEED_ACCOUNTS = `(function(){
  localStorage.clear();
  var base = function(name, qn) {
    return JSON.stringify({
      subjects:{s1:{id:'s1',name:name,chapterIds:['c1'],collapsed:false}},
      subjectOrder:['s1'], currentSubjectId:'s1', currentChapterId:'c1',
      chapters:{c1:{id:'c1',name:name+'的章节',questions:[{id:1,question:name+'的题目',type:'single',options:['A','B','C','D'],answer:0,tag:'x',strategy:'new'}],userAnswers:[undefined],currentIdx:0,quizSets:[],strategy:{errPct:20,reviewPct:50,newPct:30,typeCounts:{single:5,judge:5,term:3,short:2},errorTags:[],reviewTags:[],newTopicTags:[],tagMeta:{}}}},
      history:[], lastScreen:'start', settings:{darkMode:false}, aiConfig:{}, aiTaskQueue:[], srsData:{}, generatedExams:{}, achievements:{unlocked:[],history:[]}, ignoredQuestions:[], chapterMaterials:{}
    });
  };
  localStorage.setItem('qbao_user', JSON.stringify({id:'u1',username:'alice'}));
  localStorage.setItem('qbao_token', 'tok1');
  localStorage.setItem('quizEngineState_cloud_u1', base('账号一并集数据','u1题'));
  localStorage.setItem('quizEngineState_cloud_u2', base('账号二数据','u2题'));
  return true;
})()`

// —— 播种 3（离线作答→上线合并 的本地层）：登录态 u1 下已有云端骨架，作答后应出现 pending ——
const SEED_ONLINE_DIRTY = `(function(){
  localStorage.clear();
  localStorage.setItem('qbao_user', JSON.stringify({id:'u1',username:'alice'}));
  localStorage.setItem('qbao_token', 'tok1');
  localStorage.setItem('quizEngineState_cloud_u1', JSON.stringify({
    subjects:{s1:{id:'s1',name:'云端科目',chapterIds:['c1'],collapsed:false}}, subjectOrder:['s1'],
    currentSubjectId:'s1', currentChapterId:'c1',
    chapters:{c1:{id:'c1',name:'云端章节',questions:[],strategy:{typeCounts:{single:5,judge:5,term:3,short:2},errPct:20,reviewPct:50,newPct:30,errorTags:[],reviewTags:[],newTopicTags:[],tagMeta:{}}}},
    history:[], lastScreen:'start', settings:{darkMode:false}, aiConfig:{}, aiTaskQueue:[], srsData:{}, generatedExams:{}, achievements:{unlocked:[],history:[]}, ignoredQuestions:[], chapterMaterials:{}
  }));
  return true;
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 800, show: true,
    webPreferences: { preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await win.loadFile(DIST)
  await sleep(1500)
  await js(win, 't0-ready', 'JSON.stringify({ pinia: !!window.__pinia, appText: (document.querySelector("#app").innerText||"").substring(0,40) })')

  // ── 场景 A：2000+ 题离线态 ──
  await js(win, 'a1-seed', SEED_OFFLINE)
  await js(win, 'a2-reload', 'location.reload(); 1')
  await sleep(2500)
  await js(win, 'a3-boot', `JSON.stringify({
    pinia: !!window.__pinia,
    rendered: (document.querySelector('#app').innerText || '').length > 50,
    skeletonBytes: (localStorage.getItem('quizEngineState_v7') || '').length,
    skeletonHasQuestions: (localStorage.getItem('quizEngineState_v7') || '').indexOf('"questions"') !== -1
  })`)
  // 启动答题入口：直接走 store（DOM 选择器级入口在 3.1 变化大，store 语义稳定）
  await js(win, 'a4-resume', `(function(){
    var quiz = window.__pinia._s.get('quiz');
    var data = window.__pinia._s.get('data');
    quiz.startSession();
    var as = data.getActiveSet();
    var cur = quiz.currentQuestion ? quiz.currentQuestion.question : null;
    var ansLen = as && as.userAnswers ? as.userAnswers.filter(function(a){return a!==undefined && a!==null && a!==-1}).length : -1;
    return JSON.stringify({ modalOpen: quiz.session.modalOpen, current: cur, answered: ansLen, currentIdx: as ? as.currentIdx : -1 });
  })()`)
  // 答一题 → 本地保存（骨架 + IDB 含 2100 题；骨架不超 5MB）
  await js(win, 'a5-answer', `(function(){
    var quiz = window.__pinia._s.get('quiz');
    quiz.selectOption(0);
    var sk = localStorage.getItem('quizEngineState_v7') || '';
    return JSON.stringify({ bytes: sk.length, under5MB: sk.length < 5*1024*1024, saved: !!sk });
  })()`)
  await sleep(1200) // 等 IDB 空闲写入
  await js(win, 'a6-idb', `(function(){
    return new Promise(function(resolve){
      try {
        var req = indexedDB.open('qbao_state_db', 1);
        req.onsuccess = function(){
          var db = req.result;
          var tx = db.transaction('chapters','readonly');
          var st = tx.objectStore('chapters');
          var g = st.get('c1');
          g.onsuccess = function(){
            var d = g.result ? g.result.data : null;
            resolve(JSON.stringify({ hasChapter: !!d, questions: d ? (d.questions||[]).length : 0, hasAnswers: d ? !!(d.userAnswers) : false }));
          };
          g.onerror = function(){ resolve(JSON.stringify({err:'get err'})) };
        };
        req.onerror = function(){ resolve(JSON.stringify({err:'open err'})) };
      } catch(e){ resolve(JSON.stringify({err:e.message})) }
    });
  })()`)

  // ── 场景 B：多账号隔离切换（seed 时登录 u1；先切 u2 验证专属键读取） ──
  await js(win, 'b1-seed', SEED_ACCOUNTS)
  await js(win, 'b2-reload', 'location.reload(); 1')
  await sleep(2000)
  await js(win, 'b3-u1-view', `JSON.stringify({
    subj: (window.__pinia._s.get('data').state.subjects.s1 || {}).name,
    question: (window.__pinia._s.get('data').state.chapters.c1.questions[0] || {}).question
  })`)
  // 切到 u2 → 必须读到 u2 专属键（不得回退公共键/串 u1 数据）
  await js(win, 'b4-switch-u2', `(function(){ localStorage.setItem('qbao_user', JSON.stringify({id:'u2',username:'bob'})); window.location.reload(); return 1 })()`)
  await sleep(2000)
  await js(win, 'b5-u2-view', `JSON.stringify({
    subj: (window.__pinia._s.get('data').state.subjects.s1 || {}).name,
    question: (window.__pinia._s.get('data').state.chapters.c1.questions[0] || {}).question
  })`)
  // 切回 u1 → 恢复 u1 数据
  await js(win, 'b6-switch-back', `(function(){ localStorage.setItem('qbao_user', JSON.stringify({id:'u1',username:'alice'})); window.location.reload(); return 1 })()`)
  await sleep(2000)
  await js(win, 'b7-u1-again', `JSON.stringify({
    subj: (window.__pinia._s.get('data').state.subjects.s1 || {}).name,
    question: (window.__pinia._s.get('data').state.chapters.c1.questions[0] || {}).question
  })`)

  // ── 场景 C：登录态离线作答 → pending 写入（上线后补推的本地凭证） ──
  await js(win, 'c1-seed', SEED_ONLINE_DIRTY)
  await js(win, 'c2-reload', 'location.reload(); 1')
  await sleep(2000)
  await js(win, 'c3-offline-answer', `(function(){
    try {
      var data = window.__pinia._s.get('data');
      data.state.chapters.c1.questions.push({id:9,question:'离线答的新题',type:'single',options:['A','B','C','D'],answer:0,tag:'x',strategy:'new'});
      data.saveState();
      return JSON.stringify({
        pending: localStorage.getItem('qbao_sync_pending_u_u1'),
        cloudKeyUpdated: !!localStorage.getItem('quizEngineState_cloud_u1'),
        // 大字段（题目）不进骨架：断言骨架体积仍极小
        skeletonBytes: (localStorage.getItem('quizEngineState_cloud_u1')||'').length
      });
    } catch(e){ return JSON.stringify({err: e.message}) }
  })()`)
  await sleep(1200)
  await js(win, 'c4-idb-newq', `(function(){
    return new Promise(function(resolve){
      try {
        var req = indexedDB.open('qbao_state_db', 1);
        req.onsuccess = function(){
          var db = req.result;
          var st = db.transaction('chapters','readonly').objectStore('chapters');
          var g = st.get('c1');
          g.onsuccess = function(){
            var d = g.result ? g.result.data : null;
            var arr = d ? (d.questions||[]) : [];
            resolve(JSON.stringify({ count: arr.length, hasNew: arr.some(function(q){ return q.question === '离线答的新题' }) }));
          };
          g.onerror = function(){ resolve(JSON.stringify({err:'get err'})) };
        };
        req.onerror = function(){ resolve(JSON.stringify({err:'open err'})) };
      } catch(e){ resolve(JSON.stringify({err:e.message})) }
    });
  })()`)

  fs.writeFileSync(OUT, JSON.stringify(RES, null, 2))
  console.log('REPORT_WRITTEN', OUT)
  app.exit(0)
}).catch((e) => { try { fs.writeFileSync(OUT, JSON.stringify({ fatal: e.message })) } catch (e2) {}; console.error('FATAL', e); app.exit(1) })
