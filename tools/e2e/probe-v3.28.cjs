// QA probe v3.28 — match qa-shot3 pattern, results to file
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')
const OUT = path.join(__dirname, 'out', 'probe-v3.28-result.json')
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const SEED = `(function(){
  var now = Date.now();
  var qs = [];
  for (var i = 0; i < 36; i++) {
    qs.push({id:i+1,type:i%3===0?'judge':'single',question:'第'+(i+1)+'题：求极限',options:['0','1','∞','不存在'],answer:1,tag:'标签'+(i%4),strategy:'error',explanation:'解析第'+(i+1)+'题'});
  }
  var qs2 = [{id:101,type:'single',question:'第二章测试题：导数的定义',options:['A','B','C','D'],answer:0,tag:'导数',explanation:'导数定义'}];
  var mkHist = function(id, cid, cname, n) {
    var arr = [];
    for (var k = 0; k < n; k++) {
      arr.push({id:id+'_'+k, chapterId:cid, chapterName:cname, date:'2025-08-'+(10+k)+' 14:3'+k+':00', total:6, correct:4, wrong:2, rate:67,
        questions: [
          {question:'题A', type:'single', tag:'极限', userAnswer:0, answer:0, isCorrect:true, explanation:'解析A'},
          {question:'题B', type:'single', tag:'极限', userAnswer:1, answer:0, isCorrect:false, explanation:'解析B'},
          {question:'题C', type:'judge', tag:'导数', userAnswer:0, answer:0, isCorrect:true, explanation:'解析C'}
        ]});
    }
    return arr;
  };
  var st = {
    subjects:{s1:{id:'s1',name:'高等数学',chapterIds:['c1','c2'],collapsed:false}},
    currentSubjectId:'s1', subjectOrder:['s1'],
    chapters:{
      c1:{id:'c1',name:'第一章 极限与连续',questions:qs,userAnswers:qs.map(function(){return undefined}),currentIdx:0,quizSets:[],createdAt:now,strategy:{errPct:30,reviewPct:40,newPct:30,typeCounts:{single:4,judge:3,term:2,short:1},errorTags:['极限','洛必达','等价无穷小','泰勒','夹逼','间断点','连续','导数','无穷级数','函数项'],reviewTags:['导数','积分'],newTopicTags:['泰勒展开'],tagMeta:{}}},
      c2:{id:'c2',name:'第二章 导数与微分',questions:qs2,userAnswers:[undefined],currentIdx:0,quizSets:[],createdAt:now,strategy:{errPct:20,reviewPct:50,newPct:30,typeCounts:{single:5,judge:5,term:3,short:2},errorTags:[],reviewTags:[],newTopicTags:[],tagMeta:{}}}
    },
    currentChapterId:'c1',
    history: mkHist('h1','c1','第一章 极限与连续',4).concat(mkHist('h2','c2','第二章 导数与微分',2)),
    lastScreen:'start',
    settings:{quizFontSize:17,sidebarFontSize:13,topbarFontSize:14,mainFontSize:17,darkMode:false,showNoticeBar:true},
    aiEnabled:true,
    aiConfig:{provider:'deepseek',model:'deepseek-v4-pro',systemPrompt:'',selfCheck:false,useServerQueue:false,apiKeySet:false},
    chapterMaterials:{c1:[{name:'高数笔记.pdf',size:123456,addedAt:now,id:'mat_1'},{name:'习题课.pptx',size:456789,addedAt:now,id:'mat_2'}]},
    aiTaskQueue:[], srsData:{}, generatedExams:{}, achievements:{unlocked:[],history:[]}, ignoredQuestions:[]
  };
  localStorage.setItem('quizEngineState_v7', JSON.stringify(st));
  return true;
})()`

const RES = {}
async function js(win, label, code) {
  try { const r = await win.webContents.executeJavaScript(code); RES[label] = r; console.log(label, '=>', JSON.stringify(r)) }
  catch (e) { RES[label] = 'ERR: ' + e.message; console.log(label, 'FAIL', e.message) }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 800, show: true, x: 0, y: 0,
    webPreferences: { preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await win.loadFile(DIST)
  await js(win, 'seed', SEED)
  await js(win, 'reload', 'location.reload(); 1')
  await sleep(2000)

  await js(win, 'topbar-chat', "JSON.stringify({ tbChat: !!document.querySelector('#topbar .tb-chat') })")
  await js(win, 'sidebar', "JSON.stringify({ sideNav: !!document.querySelector('.side-nav'), aiRowOpen: document.querySelector('#sidebar-footer .ai-row') ? document.querySelector('#sidebar-footer .ai-row').classList.contains('ai-row-open') : false })")
  await js(win, 'tags-toggle', "JSON.stringify(Array.from(document.querySelectorAll('.tag-col-toggle')).map(function(x){return x.textContent.trim()}))")
  await js(win, 'font-vars', "JSON.stringify({ mainFsBase: getComputedStyle(document.querySelector('#main')).getPropertyValue('--fs-base').trim(), topbarFsLg: getComputedStyle(document.querySelector('#topbar')).getPropertyValue('--fs-lg').trim() })")

  await js(win, 'goto-history', "window.__pinia._s.get('ui').showScreen('history'); 1")
  await sleep(700)
  await js(win, 'history', "JSON.stringify({ hasSelect: !!document.querySelector('.hs-chapter-pick select'), hsCurrent: !!document.querySelector('.hs-current'), hs: document.querySelectorAll('.hs-session').length })")

  await js(win, 'goto-dash', "window.__pinia._s.get('ui').showScreen('subject-dash'); 1")
  await sleep(700)
  await js(win, 'open-compose', "document.querySelectorAll('.sd-tabs .tab')[2].click(); 1")
  await sleep(500)
  await js(win, 'compose', "JSON.stringify({ ceCh: document.querySelectorAll('.ce-ch').length, names: Array.from(document.querySelectorAll('.ce-ch-name')).map(function(x){return x.textContent.trim()}) })")

  fs.writeFileSync(OUT, JSON.stringify(RES, null, 2))
  app.exit(0)
}).catch((e) => { fs.writeFileSync(OUT, JSON.stringify({ fatal: e.message })); app.exit(1) })
