// QA probe P3 — 错题本 + 批量编辑 + 导入导出 UI 冒烟（v3.33）
// 播种含错题的 history → 科目页：错题本 tab 渲染/AI 讲解按钮、
// 题库 tab 批量/导入/导出入口、选择模式可进入。
// 用法：cd desktop && npx electron ../tools/e2e/probe-p3-wrongbook.cjs
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')
const OUT = path.join(__dirname, 'out', 'probe-p3-wrongbook-result.json')
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
const RES = {}
async function js(win, label, code) {
  try {
    const r = await win.webContents.executeJavaScript(code, true)
    RES[label] = r
    console.log(label, '=>', JSON.stringify(r).substring(0, 400))
  } catch (e) { RES[label] = 'ERR: ' + e.message; console.log(label, 'FAIL', e.message) }
}

const SEED = "(function(){" +
  "localStorage.clear();" +
  "var now = Date.now();" +
  "var st = {" +
    "subjects:{s1:{id:'s1',name:'高数',chapterIds:['c1'],collapsed:false}}, subjectOrder:['s1']," +
    "currentSubjectId:'s1', currentChapterId:'c1'," +
    "chapters:{" +
      "c1:{id:'c1',name:'第一章',questions:[" +
        "{id:1,question:'错题一：极限定义',type:'single',options:['A','B','C','D'],answer:0,tag:'极限',strategy:'error',explanation:''}," +
        "{id:2,question:'对题二：导数',type:'single',options:['A','B','C','D'],answer:1,tag:'导数',strategy:'new',explanation:''}," +
        "{id:3,question:'错题三：积分',type:'judge',options:['正确','错误'],answer:0,tag:'积分',strategy:'error',explanation:''}" +
      "],userAnswers:[1,1,0],currentIdx:0,quizSets:[],strategy:{typeCounts:{single:2,judge:1,term:0,short:0},errPct:20,reviewPct:50,newPct:30,errorTags:[],reviewTags:[],newTopicTags:[],tagMeta:{}}}" +
    "}," +
    "history:[{id:'h1',chapterId:'c1',chapterName:'第一章',date:'2026-09-03 10:00',total:3,correct:1,wrong:2,rate:33," +
      "questions:[" +
        "{question:'错题一：极限定义',type:'single',tag:'极限',userAnswer:1,answer:0,isCorrect:false,explanation:''}," +
        "{question:'对题二：导数',type:'single',tag:'导数',userAnswer:1,answer:1,isCorrect:true,explanation:''}," +
        "{question:'错题三：积分',type:'judge',tag:'积分',userAnswer:1,answer:0,isCorrect:false,explanation:''}" +
      "]}]," +
    "lastScreen:'start', settings:{darkMode:false}," +
    "aiConfig:{provider:'ecnu',model:'ecnu-plus',apiKeySet:false}," +
    "chapterMaterials:{}, aiTaskQueue:[], srsData:{}, generatedExams:{}," +
    "achievements:{unlocked:[],history:[]}, ignoredQuestions:[], wrongBook:{}" +
  "};" +
  "localStorage.setItem('quizEngineState_v7', JSON.stringify(st));" +
  "return true;" +
"})()"

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 800, show: true,
    webPreferences: { preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await win.loadFile(DIST)
  await sleep(1500)
  await js(win, 'ready', 'JSON.stringify({ pinia: !!window.__pinia })')
  await js(win, 'seed', SEED)
  await js(win, 'reload', 'window.location.reload(); 1')
  await sleep(2000)

  await js(win, 'goto-dash', "window.__pinia._s.get('ui').showScreen('subject-dash'); 1")
  await sleep(700)
  await js(win, 'click-wrongbook', "(function(){" +
    "var els = Array.from(document.querySelectorAll('.sd-tabs *')).filter(function(x){return x.textContent && x.textContent.indexOf('错题本') !== -1});" +
    "if (els.length) { els[0].click(); return 'clicked' }" +
    "return 'no-tab-el';" +
  "})()")
  await sleep(700)
  await js(win, 'wrongbook-view', "(function(){" +
    "var txt = document.body.innerText || '';" +
    "return JSON.stringify({" +
      "hasWrongTitle: txt.indexOf('错题一：极限定义') !== -1," +
      "hasExplainBtn: Array.from(document.querySelectorAll('button')).some(function(b){ return b.textContent.indexOf('AI 讲解') !== -1 })," +
      "hasStdAnswer: txt.indexOf('标准答案') !== -1," +
      "hasMyAnswer: txt.indexOf('我的答案') !== -1" +
    "});" +
  "})()")

  await js(win, 'goto-questionbank', "(function(){" +
    "var els = Array.from(document.querySelectorAll('.sd-tabs *')).filter(function(x){return x.textContent && x.textContent.indexOf('题库') !== -1});" +
    "if (els.length) { els[0].click(); return 1 }" +
    "return 0;" +
  "})()")
  await sleep(600)
  await js(win, 'qbank-entries', "(function(){" +
    "var btns = Array.from(document.querySelectorAll('button')).map(function(b){return b.textContent.trim()});" +
    "return JSON.stringify({" +
      "hasImport: btns.indexOf('导入') !== -1," +
      "hasExport: btns.indexOf('导出') !== -1," +
      "hasBulk: btns.indexOf('批量') !== -1," +
      "wrongItems: Array.from(document.querySelectorAll('.qb-item.wrong')).length" +
    "});" +
  "})()")
  await js(win, 'enter-bulk', "(function(){" +
    "var el = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent.trim() === '批量' });" +
    "if (el) { el.click(); return 1 }" +
    "return 0;" +
  "})()")
  await sleep(500)
  await js(win, 'bulk-view', "(function(){" +
    "var txt = document.body.innerText || '';" +
    "return JSON.stringify({ hasSelBox: !!document.querySelector('.qb-sel-box'), hasDeleteBtn: txt.indexOf('删除') !== -1, hasExit: txt.indexOf('退出') !== -1 });" +
  "})()")

  fs.writeFileSync(OUT, JSON.stringify(RES, null, 2))
  console.log('REPORT_WRITTEN', OUT)
  app.exit(0)
}).catch((e) => { try { fs.writeFileSync(OUT, JSON.stringify({ fatal: e.message })) } catch (e2) {}; console.error('FATAL', e); app.exit(1) })