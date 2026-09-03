// QA 截图脚本：加载 app/dist 构建产物，播种演示数据，输出桌面/手机 × 亮/暗截图
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, 'out', 'qa-shots')
const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')

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
    currentSubjectId:'s1',
    subjectOrder:['s1'],
    chapters:{c1:{id:'c1',name:'第一章 极限与连续',questions:qs,userAnswers:[undefined,0,1,undefined,'左右极限存在且相等，但函数值不符或未定义',undefined],currentIdx:0,quizSets:[{questions:qs,userAnswers:[undefined,0,1,undefined,'左右极限存在且相等，但函数值不符或未定义',undefined],currentIdx:1,createdAt:now}],currentQuizSetIdx:0,createdAt:now,strategy:{errPct:30,reviewPct:40,newPct:30,typeCounts:{single:4,judge:3,term:2,short:1},errorTags:['极限','洛必达'],reviewTags:['导数'],newTopicTags:['泰勒展开'],tagMeta:{'极限':{totalQ:5,correct:3},'洛必达':{totalQ:3,correct:1},'导数':{totalQ:4,correct:4},'泰勒展开':{totalQ:0,correct:0}}}}},
    currentChapterId:'c1',
    history:[],
    lastScreen:'start',
    settings:{quizFontSize:17,sidebarFontSize:13,topbarFontSize:14,mainFontSize:17,darkMode:false,showNoticeBar:true},
    aiEnabled:true,
    aiConfig:{provider:'deepseek',model:'deepseek-v4-pro',systemPrompt:'',streamMode:true,streamThreshold:3,selfCheck:false,useServerQueue:false,apiKeySet:false,modelByProvider:{deepseek:'deepseek-v4-pro'}},
    chapterMaterials:{c1:[{name:'高数笔记.pdf',size:123456,addedAt:now,id:'mat_1'},{name:'习题课.pptx',size:456789,addedAt:now,id:'mat_2'}]},
    aiTaskQueue:[], srsData:{}, generatedExams:{}, achievements:{unlocked:[],history:[]}, ignoredQuestions:[]
  };
  localStorage.setItem('quizEngineState_v7', JSON.stringify(st));
  return true;
})()`;

async function shot(win, name) {
  await sleep(500)
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, name), img.toPNG())
  console.log('shot:', name)
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  })

  await win.loadFile(DIST)
  await win.webContents.executeJavaScript(SEED)
  await sleep(600)
  await shot(win, '01-start-desktop-light.png')

  await win.webContents.executeJavaScript('document.documentElement.classList.add("dark-mode")')
  await shot(win, '02-start-desktop-dark.png')

  win.setSize(390, 844)
  await sleep(400)
  await shot(win, '03-start-mobile-dark.png')

  await win.webContents.executeJavaScript('document.documentElement.classList.remove("dark-mode")')
  await shot(win, '04-start-mobile-light.png')

  win.setSize(1280, 800)
  await sleep(300)
  await win.webContents.executeJavaScript('window.__pinia._s.get("quiz").openQuiz("quiz")')
  await shot(win, '05-quiz-desktop.png')

  win.setSize(390, 844)
  await sleep(300)
  await shot(win, '06-quiz-mobile.png')

  win.setSize(1280, 800)
  await sleep(300)
  await win.webContents.executeJavaScript('window.__pinia._s.get("ui").openSettings("aiconfig")')
  await shot(win, '07-settings-ai.png')

  app.exit(0)
})
