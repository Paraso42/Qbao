const { app, BrowserWindow } = require('electron')
const path = require('path')
const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
const SEED = `(function(){
  var st = {
    subjects:{s1:{id:'s1',name:'高等数学',chapterIds:['c1'],collapsed:false},s2:{id:'s2',name:'线性代数',chapterIds:['c2'],collapsed:false}},
    currentSubjectId:'s1', subjectOrder:['s1','s2'],
    chapters:{
      c1:{id:'c1',name:'第一章 极限与连续',questions:[],userAnswers:[],currentIdx:0,quizSets:[],strategy:{}},
      c2:{id:'c2',name:'第一章 行列式',questions:[],userAnswers:[],currentIdx:0,quizSets:[],strategy:{}}
    },
    currentChapterId:'c1', history:[], lastScreen:'start',
    settings:{quizFontSize:17,sidebarFontSize:13,topbarFontSize:14,mainFontSize:17,darkMode:false,showNoticeBar:true},
    aiEnabled:true, aiConfig:{}, chapterMaterials:{}, aiTaskQueue:[], srsData:{}, generatedExams:{}, achievements:{unlocked:[],history:[]}, ignoredQuestions:[]
  };
  localStorage.setItem('quizEngineState_v7', JSON.stringify(st));
  return true;
})()`
async function js(win, code) { try { return await win.webContents.executeJavaScript(code) } catch (e) { return 'FAIL ' + e.message } }
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 800, show: true, x: 0, y: 0,
    webPreferences: { preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await win.loadFile(DIST)
  await js(win, SEED)
  await sleep(800)
  const before = await js(win, "JSON.stringify({ h1: document.querySelectorAll('.subject-header')[0].offsetHeight, h2: document.querySelectorAll('.subject-header')[1].offsetHeight, gap2top: document.querySelectorAll('.subject-group')[1].offsetTop })")
  console.log('BEFORE', before)
  const rect = await js(win, "JSON.stringify((function(){ var r = document.querySelectorAll('.subject-header')[0].getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })())")
  const p = JSON.parse(rect)
  win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
  await sleep(500)
  const after = await js(win, "JSON.stringify({ h1: document.querySelectorAll('.subject-header')[0].offsetHeight, h2: document.querySelectorAll('.subject-header')[1].offsetHeight, gap2top: document.querySelectorAll('.subject-group')[1].offsetTop, actionsDisplay: getComputedStyle(document.querySelectorAll('.subject-header')[0].querySelector('.subj-actions')).display })")
  console.log('AFTER', after)
  // chapter hover check
  win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x + 30, y: p.y + 80 })
  await sleep(500)
  const chAfter = await js(win, "JSON.stringify({ chH: document.querySelectorAll('.chapter-item')[0].offsetHeight, chActions: getComputedStyle(document.querySelectorAll('.chapter-item')[0].querySelector('.ch-actions')).display })")
  console.log('CHAPTER-HOVER', chAfter)
  app.exit(0)
})
