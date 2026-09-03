const { app, BrowserWindow } = require('electron')
const path = require('path')
const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
const SEED = `(function(){
  var mkHist = function(id, cid, cname, n) {
    var arr = [];
    for (var k = 0; k < n; k++) {
      arr.push({id:id+'_'+k, chapterId:cid, chapterName:cname, date:'2025-08-'+(10+k)+' 14:30:00', total:3, correct:2, wrong:1, rate:67,
        questions: [{question:'题A', type:'single', tag:'极限', userAnswer:0, answer:0, isCorrect:true, explanation:'解析A'}]});
    }
    return arr;
  };
  var st = {
    subjects:{s1:{id:'s1',name:'高等数学',chapterIds:['c1','c2'],collapsed:false}},
    currentSubjectId:'s1', subjectOrder:['s1'],
    chapters:{c1:{id:'c1',name:'第一章',questions:[],userAnswers:[],currentIdx:0,quizSets:[],strategy:{}},c2:{id:'c2',name:'第二章',questions:[],userAnswers:[],currentIdx:0,quizSets:[],strategy:{}}},
    currentChapterId:'c1', history: mkHist('h1','c1','第一章',4).concat(mkHist('h2','c2','第二章',2)), lastScreen:'start',
    settings:{quizFontSize:17,sidebarFontSize:13,topbarFontSize:14,mainFontSize:17,darkMode:false,showNoticeBar:true},
    aiEnabled:true, aiConfig:{}, chapterMaterials:{}, aiTaskQueue:[], srsData:{}, generatedExams:{}, achievements:{unlocked:[],history:[]}, ignoredQuestions:[]
  };
  localStorage.setItem('quizEngineState_v7', JSON.stringify(st));
  return true;
})()`
async function js(win, code) { try { return await win.webContents.executeJavaScript(code) } catch (e) { return 'FAIL: ' + e.message } }
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 800, show: true, x: 0, y: 0,
    webPreferences: { preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await win.loadFile(DIST)
  await js(win, SEED)
  await js(win, 'location.reload(); 1')
  await sleep(1500)
  await js(win, "window.__pinia._s.get('ui').showScreen('history'); 1")
  await sleep(500)
  console.log('options', await js(win, "JSON.stringify((function(){var s=document.querySelector('.hs-chapter-pick select'); return s ? {n: s.options.length, vals: Array.from(s.options).map(function(o){return o.value})} : null})())"))
  console.log('before', await js(win, "JSON.stringify({hs: document.querySelectorAll('.hs-session').length, h2: (document.querySelector('.hs-chapter-info h2')||{}).textContent})"))
  console.log('switch', await js(win, "var s = document.querySelector('.hs-chapter-pick select'); s.value='c2'; s.dispatchEvent(new Event('change',{bubbles:true})); s.value"))
  await sleep(500)
  console.log('after', await js(win, "JSON.stringify({hs: document.querySelectorAll('.hs-session').length, h2: (document.querySelector('.hs-chapter-info h2')||{}).textContent, sel: (document.querySelector('.hs-chapter-pick select')||{}).value})"))
  app.exit(0)
})
