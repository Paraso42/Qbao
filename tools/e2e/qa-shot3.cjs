// QA v3（加固版）：每步 try/catch
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const OUT = path.join(__dirname, 'out', 'qa-shots3')
const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')
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

async function js(win, label, code) {
  try {
    const r = await win.webContents.executeJavaScript(code)
    console.log(label + ' OK', r)
    return r
  } catch (e) { console.log(label + ' FAIL', e.message) }
}
async function shot(win, name) {
  await sleep(450)
  await js(win, 'state:' + name, "JSON.stringify({ so: window.__pinia._s.get('ui').settingsOpen, screen: window.__pinia._s.get('ui').activeScreen, ov: document.querySelectorAll('.dialog-overlay').length, smtabs: document.querySelectorAll('.sm-tab').length, hs: document.querySelectorAll('.hs-session').length, collapsed: document.querySelectorAll('.subject-group.collapsed').length })")
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, name), img.toPNG())
  console.log('shot:', name)
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const win = new BrowserWindow({ width: 1280, height: 800, show: true, x: 0, y: 0,
    webPreferences: { preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await win.loadFile(DIST)
  await js(win, 'seed', SEED)
  await js(win, 'reload', 'location.reload(); 1')
  await sleep(1500)

  await js(win, 'hover-before', "JSON.stringify({ h1: document.querySelectorAll('.subject-header')[0].offsetHeight, chTop: document.querySelector('.chapter-list').offsetTop, chH: document.querySelectorAll('.chapter-item')[0].offsetHeight })")
  const rect = await js(win, 'rect', "JSON.stringify((function(){ var r = document.querySelectorAll('.subject-header')[0].getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })())")
  if (rect) {
    const p = JSON.parse(rect)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    await sleep(400)
  }
  await js(win, 'hover-after', "JSON.stringify({ h1: document.querySelectorAll('.subject-header')[0].offsetHeight, chTop: document.querySelector('.chapter-list').offsetTop, chH: document.querySelectorAll('.chapter-item')[0].offsetHeight, actions: getComputedStyle(document.querySelectorAll('.subject-header')[0].querySelector('.subj-actions')).display })")
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 640, y: 400 })
  await sleep(300)

  await shot(win, '01-start-desktop.png')

  await js(win, 'collapse-subject', "document.querySelectorAll('.subject-header')[0].click(); 1")
  await sleep(350)
  await shot(win, '02-subject-collapsed.png')
  await js(win, 'expand-subject', "document.querySelectorAll('.subject-header')[0].click(); 1")
  await sleep(350)
  await shot(win, '03-subject-expanded.png')

  await js(win, 'open-settings-noarg', "window.__pinia._s.get('ui').openSettings(); 1")
  await sleep(500)
  await shot(win, '04-settings-default.png')
  await js(win, 'close-settings', "window.__pinia._s.get('ui').closeSettings(); 1")
  await sleep(250)

  await js(win, 'show-history', "window.__pinia._s.get('ui').showScreen('history'); 1")
  await sleep(500)
  await shot(win, '05-history-chapter.png')
  await js(win, 'expand-session', "document.querySelector('.hs-session-head').click(); 1")
  await sleep(400)
  await shot(win, '06-history-expanded.png')
  await js(win, 'switch-chapter', "var s = document.querySelector('.hs-chapter-pick select'); s.value='c2'; s.dispatchEvent(new Event('change',{bubbles:true})); 1")
  await sleep(400)
  await shot(win, '07-history-c2.png')

  await js(win, 'show-dash', "window.__pinia._s.get('ui').showScreen('subject-dash'); 1")
  await sleep(400)
  await js(win, 'tab-qbank', "var tabs=document.querySelectorAll('.sd-tabs .tab'); tabs[1].click(); 1")
  await sleep(500)
  await shot(win, '08-qbank-collapsed.png')
  await js(win, 'open-second-group', "var h=document.querySelectorAll('.qb-header'); if(h[1]) h[1].click(); 1")
  await sleep(350)
  await shot(win, '09-qbank-second-open.png')

  await js(win, 'show-start', "window.__pinia._s.get('ui').showScreen('start'); 1")
  await sleep(500)
  await shot(win, '10-strategy-card.png')
  await js(win, 'expand-tags', "var t=document.querySelector('.tag-col-toggle'); if(t) t.click(); 1")
  await sleep(350)
  await shot(win, '11-tags-expanded.png')

  await js(win, 'dark', "document.documentElement.classList.add('dark-mode'); 1")
  await sleep(300)
  await shot(win, '12-start-dark.png')
  await js(win, 'light', "document.documentElement.classList.remove('dark-mode'); 1")

  win.setSize(390, 844)
  await sleep(400)
  await shot(win, '13-mobile-start.png')
  await js(win, 'mobile-sidebar', "window.__pinia._s.get('ui').toggleSidebar(); 1")
  await sleep(400)
  await shot(win, '14-mobile-sidebar.png')
  await js(win, 'mobile-settings', "window.__pinia._s.get('ui').openSettings(); 1")
  await sleep(500)
  await shot(win, '15-mobile-settings.png')

  app.exit(0)
})
