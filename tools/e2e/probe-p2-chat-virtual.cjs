// QA probe P2.4 — 聊天消息虚拟滚动（窗口化渲染）回归
// 播种 1000 条文本消息 → 打开聊天弹窗 → 断言：
//  1) DOM 中实际渲染的消息节点远少于 1000（窗口化生效）
//  2) 顶部/底部 spacer 撑开滚动区（scrollHeight 覆盖全部消息）
//  3) 滚动到底后可见最后一条消息；向上滚动可回到更早消息
// 用法：cd desktop && npx electron ../tools/e2e/probe-p2-chat-virtual.cjs
// 输出：tools/e2e/out/probe-p2-chat-virtual-result.json
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const DIST = path.join(__dirname, '..', '..', 'app', 'dist', 'index.html')
const OUT = path.join(__dirname, 'out', 'probe-p2-chat-virtual-result.json')
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const RES = {}
async function js(win, label, code) {
  try {
    const r = await win.webContents.executeJavaScript(code, true)
    RES[label] = r
    console.log(label, '=>', typeof r === 'string' ? r.substring(0, 400) : JSON.stringify(r).substring(0, 400))
  } catch (e) { RES[label] = 'ERR: ' + e.message; console.log(label, 'FAIL', e.message) }
}

// 播种登录态 + 注入 1000 条消息到 chat store（绕过网络层）
const SEED = `(function(){
  localStorage.clear();
  localStorage.setItem('qbao_user', JSON.stringify({id:'u1',username:'alice',displayName:'Alice'}));
  localStorage.setItem('qbao_token', 'tok-local-probe');
  return true;
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 800, show: true,
    webPreferences: { preload: path.join(__dirname, '..', '..', 'desktop', 'preload.js'),
      additionalArguments: ['--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: '', isDesktop: false }))],
      contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await win.loadFile(DIST)
  await sleep(1500)
  await js(win, 't0-ready', 'JSON.stringify({ pinia: !!window.__pinia })')
  await js(win, 'seed', SEED)
  await js(win, 'reload', 'window.location.reload(); 1')
  await sleep(2000)

  // 注入会话与 1000 条消息，打开聊天
  await js(win, 'inject', `(function(){
    try {
      var chat = window.__pinia._s.get('chat');
      chat.roomsCache = [{ id: 'r1', type: 'direct', members: [{ id: 'u1', display_name: 'Alice' }, { id: 'u2', display_name: 'Bob' }], last_message: null, unread_count: 0 }];
      var msgs = [];
      var now = Date.now();
      for (var i = 1; i <= 1000; i++) {
        msgs.push({ id: 'm' + i, user_id: i % 3 === 0 ? 'u1' : 'u2', sender_name: i % 3 === 0 ? 'Alice' : 'Bob',
          content: '消息 #' + i + '：这是一条用于虚拟滚动回归的中等长度文本消息，包含一些说明文字用于撑高内容区。',
          msg_type: 'text', created_at: new Date(now - (1000 - i) * 60000).toISOString(), is_revoked: false });
      }
      chat.messages = msgs;
      chat.openRoomId = 'r1';
      chat.modalOpen = true;
      window.__qbaoProbe = { total: msgs.length };
      return JSON.stringify({ total: chat.messages.length, roomOpen: chat.openRoomId });
    } catch(e){ return JSON.stringify({err: e.message}) }
  })()`)
  await sleep(2500) // 等滚动到底 + rAF 窗口更新

  // 断言 1/2：DOM 节点数 << 1000 + spacer 存在
  await js(win, 'v1-window', `(function(){
    var list = document.querySelector('.chat-msg-list') || document.querySelector('.chat-messages');
    if (!list) return JSON.stringify({ err: 'no chat container', body: (document.body.innerText||'').substring(0,120) });
    var rendered = list.querySelectorAll('.chat-msg, .chat-msg-system').length;
    var pads = list.querySelectorAll('.chat-virt-pad');
    var firstTxt = list.querySelector('.chat-msg, .chat-msg-system');
    var lastTxt = null;
    var all = list.querySelectorAll('.chat-msg, .chat-msg-system');
    if (all.length) lastTxt = all[all.length - 1].innerText;
    var padHeights = Array.from(pads).map(function(p){ return p.style.height });
    return JSON.stringify({ rendered, padCount: pads.length, padHeights, first: firstTxt ? firstTxt.innerText.substring(0, 16) : null, last: lastTxt ? lastTxt.substring(0, 16) : null, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, scrollTop: list.scrollTop });
  })()`)
  // 断言 3a：当前可见最后一条（#1000 附近）——只查聊天容器内部文本
  await js(win, 'v2-bottom-visible', `(function(){
    var list = document.querySelector('.chat-messages');
    var txt = list ? list.innerText : '';
    return JSON.stringify({ hasLast: txt.indexOf('消息 #1000') !== -1, hasFirst: txt.indexOf('消息 #1：') !== -1, len: txt.length });
  })()`)
  // 断言 3b：向上滚动后可见更早消息
  await js(win, 'v3-scroll-up', `(function(){
    var list = document.querySelector('.chat-messages');
    list.scrollTop = 0;
    return 1;
  })()`)
  await sleep(1200)
  await js(win, 'v4-top-visible', `(function(){
    var list = document.querySelector('.chat-messages');
    var txt = list ? list.innerText : '';
    return JSON.stringify({ hasFirst: txt.indexOf('消息 #1：') !== -1, hasLast: txt.indexOf('消息 #1000') !== -1, rendered: list.querySelectorAll('.chat-msg, .chat-msg-system').length });
  })()`)

  fs.writeFileSync(OUT, JSON.stringify(RES, null, 2))
  console.log('REPORT_WRITTEN', OUT)
  app.exit(0)
}).catch((e) => { try { fs.writeFileSync(OUT, JSON.stringify({ fatal: e.message })) } catch (e2) {}; console.error('FATAL', e); app.exit(1) })
