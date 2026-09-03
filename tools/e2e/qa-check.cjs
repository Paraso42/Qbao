// QA 检查脚本：加载构建产物，输出布局/暗色/溢出/控制台错误检查报告（无需读图）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')
const OUT = path.join(__dirname, 'out', 'qa-report.json')

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

const SEED = `(function(){
  var now = Date.now();
  var qs = [
    {id:1,type:'single',question:'求极限 $\\lim_{x\\to 0}\\frac{\\sin x}{x}$ 的值',options:['0','1','∞','不存在'],answer:1,tag:'极限',strategy:'error',explanation:'重要极限：$\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$'},
    {id:2,type:'single',question:'下列哪项是洛必达法则的适用条件',options:['0/0 或 ∞/∞ 型','任意形式','仅 0/0 型','仅无穷大型'],answer:0,tag:'洛必达',strategy:'error',explanation:'洛必达法则适用于 0/0 与 ∞/∞ 未定式'},
    {id:3,type:'judge',question:'可导函数必连续',options:['正确','错误'],answer:0,tag:'导数',strategy:'review',explanation:'可导 ⇒ 连续；连续不一定可导'},
    {id:4,type:'judge',question:'若函数在某点连续，则该点一定可导',options:['正确','错误'],answer:1,tag:'导数',strategy:'review',explanation:'如 y=|x| 在 x=0 处连续但不可导'},
    {id:5,type:'term',question:'解释什么是函数的可去间断点',tag:'极限',strategy:'new',explanation:'左右极限存在且相等，但不等于该点函数值或该点无定义'},
    {id:6,type:'short',question:'简述泰勒公式的用途',tag:'泰勒展开',strategy:'new',explanation:'用多项式近似函数，用于极限计算、近似估值与误差分析'}
  ];
  var st = {
    subjects:{s1:{id:'s1',name:'高等数学',chapterIds:['c1'],collapsed:false}},
    currentSubjectId:'s1', subjectOrder:['s1'],
    chapters:{c1:{id:'c1',name:'第一章 极限与连续',questions:qs,userAnswers:[undefined,0,1,undefined,'答',undefined],currentIdx:0,quizSets:[{questions:qs,userAnswers:[undefined,0,1,undefined,'答',undefined],currentIdx:1,createdAt:now}],currentQuizSetIdx:0,createdAt:now,strategy:{errPct:30,reviewPct:40,newPct:30,typeCounts:{single:4,judge:3,term:2,short:1},errorTags:['极限','洛必达'],reviewTags:['导数'],newTopicTags:['泰勒展开'],tagMeta:{}}}},
    currentChapterId:'c1', history:[], lastScreen:'start',
    settings:{quizFontSize:17,sidebarFontSize:13,topbarFontSize:14,mainFontSize:17,darkMode:false,showNoticeBar:true},
    aiEnabled:true, aiConfig:{provider:'deepseek',model:'deepseek-v4-pro',systemPrompt:'',streamMode:true,streamThreshold:3,selfCheck:false,useServerQueue:false,apiKeySet:false,modelByProvider:{}},
    chapterMaterials:{c1:[{name:'高数笔记.pdf',size:123456,addedAt:now,id:'mat_1'}]},
    aiTaskQueue:[], srsData:{}, generatedExams:{}, achievements:{unlocked:[],history:[]}, ignoredQuestions:[]
  };
  localStorage.setItem('quizEngineState_v7', JSON.stringify(st));
  return true;
})()`;

app.whenReady().then(async () => {
  const consoleErrors = []
  const report = { checks: [], consoleErrors }

  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message)
  })

  async function runChecks(label) {
    const r = await win.webContents.executeJavaScript(`(function(){
      var out = {};
      out.bodyBg = getComputedStyle(document.body).backgroundColor;
      out.docScrollW = document.documentElement.scrollWidth;
      out.innerW = window.innerWidth;
      out.hasTopbar = !!document.querySelector('#topbar');
      out.hasSidebar = !!document.querySelector('#sidebar');
      out.hasMain = !!document.querySelector('#main');
      out.overflowX = document.documentElement.scrollWidth > window.innerWidth;
      var els = document.querySelectorAll('*');
      var bad = 0;
      for (var i = 0; i < els.length && i < 4000; i++) {
        var el = els[i];
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 40 && !el.closest('pre,code')) { bad++; }
      }
      out.hOverflowCount = bad;
      var q = document.querySelector('.quiz-question');
      out.quizQFont = q ? getComputedStyle(q).fontSize : null;
      return out;
    })()`);
    report.checks.push({ label, ...r })
    console.log(label + ':', JSON.stringify(r))
  }

  await win.loadFile(DIST)
  await win.webContents.executeJavaScript(SEED)
  await sleep(800)
  await runChecks('desktop-light')

  await win.webContents.executeJavaScript('document.documentElement.classList.add("dark-mode")')
  await sleep(200)
  await runChecks('desktop-dark')

  win.setSize(390, 844)
  await sleep(500)
  await runChecks('mobile-dark')

  await win.webContents.executeJavaScript('document.documentElement.classList.remove("dark-mode")')
  await sleep(200)
  await runChecks('mobile-light')

  win.setSize(1280, 800)
  await sleep(300)
  await win.webContents.executeJavaScript('window.__pinia._s.get("quiz").openQuiz("quiz")')
  await sleep(400)
  await runChecks('quiz-desktop')

  win.setSize(390, 844)
  await sleep(400)
  await runChecks('quiz-mobile')

  win.setSize(1280, 800)
  await sleep(300)
  await win.webContents.executeJavaScript('window.__pinia._s.get("ui").openSettings("aiconfig")')
  await sleep(400)
  await runChecks('settings-ai')

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log('REPORT_SAVED', OUT)
  app.exit(0)
})
