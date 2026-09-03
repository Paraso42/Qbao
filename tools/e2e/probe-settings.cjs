// 复现"设置打开后空白"：openSettings() 无参数 + DOM 转储
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const SEED = `(function(){
  var now = Date.now();
  var st = {
    subjects:{s1:{id:'s1',name:'高等数学',chapterIds:['c1'],collapsed:false}},
    currentSubjectId:'s1', subjectOrder:['s1'],
    chapters:{c1:{id:'c1',name:'第一章 极限与连续',questions:[{id:1,type:'single',question:'求极限 $\\lim_{x\\to 0}\\frac{\\sin x}{x}$',options:['0','1','∞','不存在'],answer:1,tag:'极限'}],userAnswers:[undefined],currentIdx:0,quizSets:[],createdAt:now,strategy:{errPct:30,reviewPct:40,newPct:30,typeCounts:{single:4,judge:3,term:2,short:1},errorTags:[],reviewTags:[],newTopicTags:[],tagMeta:{}}}},
    currentChapterId:'c1', history:[], lastScreen:'start',
    settings:{quizFontSize:17,sidebarFontSize:13,topbarFontSize:14,mainFontSize:17,darkMode:false,showNoticeBar:true},
    aiEnabled:true, aiConfig:{}, chapterMaterials:{}, aiTaskQueue:[], srsData:{}, generatedExams:{}, achievements:{unlocked:[],history:[]}, ignoredQuestions:[]
  };
  localStorage.setItem('quizEngineState_v7', JSON.stringify(st));
  return true;
})()`

async function dump(win, name) {
  const d = await win.webContents.executeJavaScript(`JSON.stringify({
    tab: window.__pinia._s.get('ui').settingsTab,
    so: window.__pinia._s.get('ui').settingsOpen,
    ov: document.querySelectorAll('.dialog-overlay').length,
    bx: document.querySelectorAll('.dialog-box').length,
    tabs: document.querySelectorAll('.sm-tab').length,
    personal: (document.querySelector('.sm-content')||{}).innerHTML ? document.querySelector('.sm-content').innerHTML.length : -1,
    ch: document.querySelector('.sm-content') ? document.querySelector('.sm-content').scrollHeight : -1
  })`)
  console.log('DUMP ' + name + ' ' + d)
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, 'qa-shots2', name), img.toPNG())
}

app.whenReady().then(async () => {
  fs.mkdirSync(path.join(__dirname, 'out', 'qa-shots2'), { recursive: true })
  const win = new BrowserWindow({ width: 1280, height: 800, show: true, x: 0, y: 0,
    webPreferences: { preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await win.loadFile(DIST)
  await win.webContents.executeJavaScript(SEED)
  await sleep(700)
  await win.webContents.executeJavaScript('window.__pinia._s.get("ui").openSettings()')
  await sleep(600)
  await dump(win, 'probe-settings-open-noarg.png')
  await win.webContents.executeJavaScript('window.__pinia._s.get("ui").setSettingsTab("personalize")')
  await sleep(400)
  await dump(win, 'probe-settings-after-personalize.png')
  app.exit(0)
})
