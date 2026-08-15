# 题库修复 — 实施计划

> ⚠️ **归档说明（2026-07）**：本计划为历史实施记录，文中路径为旧目录结构（前端在仓库根、后端在 backend/）。当前结构见 docs/ARCHITECTURE.md（前端 app/、后端 server/）。

> **给执行者:** 请使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐任务执行本计划。每步使用 checkbox (`- [ ]`) 追踪进度。

**目标:** 修复 Qbao 题库、聊天题目分享、实时同步的 7 个问题。

**架构:** 前端修复（index.html, dashboard.js, history.js, subjects.js, app.js, chat.js），聊天分享重写（chat.js），后端数据库迁移 + API 修复（chat.routes.js）。无新依赖。

**技术栈:** 纯 JS 前端 / Node.js Express 后端 / PostgreSQL。无框架，无构建工具。

---

## 涉及文件

| 文件 | 作用 | 操作 |
|------|------|------|
| `index.html` | SPA 入口 — 所有页面和弹窗 DOM | 修改 |
| `js/history.js` | 历史记录保存/显示、章节历史弹窗 | 修改 |
| `js/subjects.js` | 侧栏渲染 | 修改 |
| `js/dashboard.js` | 科目仪表盘、题库 Tab、分享 | 修改 |
| `js/chat.js` | 聊天系统、题目分享、轮询 | 修改 |
| `js/app.js` | 弹窗管理、路由 | 修改 |
| `backend/src/routes/chat.routes.js` | 聊天 API | 修改 |
| `backend/sql/migration_v3.10.sql` | 数据库变更 | 新建 |

---

## 执行纪律

**以下规则每个任务都必须遵守，无一例外：**

| 规则 | 要求 |
|------|------|
| **语法检查** | 每次改完文件立刻跑 `node --check <file>`，通过才能继续 |
| **验证证据** | 声称任何任务完成前，必须有刚跑出来的验证输出 |
| **不许假设** | "应该没问题" = 没验证。只有命令输出才算证据 |
| **先测后产** | 只部署到测试服（qbao_test/、backend-test/、8080 端口）。绝不自动同步生产，等你确认 |
| **逐任务执行** | 完成一个任务（含验证）再开始下一个 |

### 执行方式（你选择后再开始实施）

**方式 A — 子代理模式（推荐）:** 调用 `superpowers:subagent-driven-development`。每个任务派给独立 agent。每个任务完成后审查。适合独立任务，更快更可靠。

**方式 B — 内联模式:** 调用 `superpowers:executing-plans`。在当前会话逐步执行全部 9 个任务，阶段性暂停审查。

### 每个任务的验证命令

| 任务 | 验证命令 |
|------|---------|
| 1 | `node --check D:/Qbao/js/history.js` |
| 2 | `node --check D:/Qbao/js/dashboard.js` |
| 3 | `node --check D:/Qbao/js/subjects.js && node --check D:/Qbao/js/history.js` |
| 4 | `node --check D:/Qbao/js/app.js` |
| 5 | `node --check D:/Qbao/js/dashboard.js` |
| 6 | `node --check D:/Qbao/js/chat.js` |
| 7 | `node --check D:/Qbao/js/chat.js` |
| 8 | `node --check D:/Qbao/js/chat.js` |
| 9 | `node --check D:/Qbao/backend/src/routes/chat.routes.js && node --check D:/Qbao/js/chat.js` |
| 部署 | 浏览器测试 `http://SERVER_IP:8080` — 逐项跑验证清单 |

---

### 任务 1: 修复历史记录 — 补存 `q.answer` 字段

**文件:** 修改 `D:\Qbao\js\history.js:1`

- [ ] **步骤 1: 在历史记录中加 `answer` 字段**

`saveQuizHistory()` 中，`questions` 映射当前存储了: `question, type, tag, userAnswer, explanation, options, isCorrect` — 但**没有 `answer`**。这导致 `showQDetailFromBank` 调用 `getCi(q, q.userAnswer)` 重新判断对错时，`q.answer` 为 `undefined`，永远返回 `false`，正确的题也显示 ❌。

```js
// 旧代码（第 1 行）:
questions: ch.questions.map((q,i)=>({question:q.question,type:q.type,tag:q.tag,userAnswer:ch.userAnswers[i],explanation:q.explanation,options:q.options,isCorrect:getCi(q,ch.userAnswers[i])}))

// 新代码:
questions: ch.questions.map((q,i)=>({
  question: q.question, type: q.type, tag: q.tag,
  userAnswer: ch.userAnswers[i],
  answer: q.answer,
  explanation: q.explanation, options: q.options,
  isCorrect: getCi(q, ch.userAnswers[i])
}))
```

- [ ] **步骤 2: 验证语法**

运行: `node --check D:/Qbao/js/history.js`
预期: 无输出（无错误）

---

### 任务 2: 题目详情弹窗加"正确答案"行

**文件:** 修改 `D:\Qbao\js\dashboard.js:74`

- [ ] **步骤 1: 在"你的答案"和"解析"之间插入正确答案行**

在 `showQDetailFromBank()` 中，`if(q.userAnswer!==undefined){...}` 代码块之后、`if(q.explanation){...}` 之前插入：

```js
// 新增 — 为客观题显示正确答案
if (q.answer !== undefined && q.answer !== null && (q.type === 'single' || q.type === 'judge')) {
  var lbs = ['A','B','C','D','E','F'];
  var cl = lbs[q.answer] || String(q.answer);
  html += '<div class="qd-answer"><strong>✅ 正确答案：</strong>' + cl + '. '
    + escapeHtml(String((q.options && q.options[q.answer]) || '')) + '</div>';
}
```

（主观题跳过 — 解析就是答案。）

- [ ] **步骤 2: 验证语法**

运行: `node --check D:/Qbao/js/dashboard.js`
预期: 无输出

---

### 任务 3: 删除章节题库

**文件:** 修改 `D:\Qbao\index.html:296-301`, `D:\Qbao\js/subjects.js:107`, `D:\Qbao\js/history.js:7`

- [ ] **步骤 1: 从 index.html 删除章节历史弹窗**

删除第 296–301 行:
```html
<!-- 删除这个代码块 -->
<div class="dialog-overlay" id="chapter-history-dialog">
  <div class="dialog-box">
    <h3>📜 章节答题历史</h3>
    <div id="chapter-history-content" style="max-height:360px;overflow-y:auto;"></div>
    <div class="dialog-actions"><button class="btn btn-secondary btn-small" onclick="document.getElementById('chapter-history-dialog').classList.remove('active')">关闭</button></div>
  </div>
</div>
```

- [ ] **步骤 2: 删除侧栏章节项的 📜 按钮**

在 `subjects.js` 第 107 行，从章节 html 字符串中删除:
```html
<button class="ch-btn ch-hist" title="答题历史" onclick="event.stopPropagation();showChapterHistory(\'' + cid + '\')">📜</button>
```

- [ ] **步骤 3: 删除 showChapterHistory() 函数**

在 `history.js` 中，删除整个 `showChapterHistory()` 函数（第 7 行）。

- [ ] **步骤 4: 验证语法**

运行:
```bash
node --check D:/Qbao/js/subjects.js
node --check D:/Qbao/js/history.js
```
预期: 两个命令都无输出

---

### 任务 4: 修复弹窗遮罩关闭

**文件:** 修改 `D:\Qbao\index.html:318`, `D:\Qbao\js/app.js:19-21`

- [ ] **步骤 1: 给 qdetail-dialog 加遮罩点击关闭**

```html
<!-- 旧代码（第 318 行）: -->
<div class="qdetail-overlay" id="qdetail-dialog">

<!-- 新代码: -->
<div class="qdetail-overlay" id="qdetail-dialog" onclick="if(event.target===this)this.classList.remove('active')">
```

- [ ] **步骤 2: closeAllModals 加入 qdetail-dialog（ESC 键也会触发）**

在 `js/app.js` 中修改 `closeAllModals()`:
```js
// 旧代码:
function closeAllModals() {
  document.querySelectorAll('.dialog-overlay.active').forEach(function(el){ el.classList.remove('active'); });
}

// 新代码:
function closeAllModals() {
  document.querySelectorAll('.dialog-overlay.active').forEach(function(el){ el.classList.remove('active'); });
  var qd = document.getElementById('qdetail-dialog');
  if (qd) qd.classList.remove('active');
}
```

- [ ] **步骤 3: 验证语法**

运行:
```bash
node --check D:/Qbao/js/app.js
```
预期: 无输出

---

### 任务 5: 新建科目题库分享车

**文件:** 修改 `D:\Qbao\index.html`, `D:\Qbao\js/dashboard.js`

这是最大的改动。当前状态: `renderSubjQuestionBank()` 有一个残破的全局 checkbox + 不完整的分享栏。我们要: (a) 删掉旧残破代码，(b) 在 index.html 加静态分享车 DOM，(c) 每题加勾选框，(d) 添加分享车管理函数。

- [ ] **步骤 1: 在 index.html 加静态分享车 DOM**

在 `#screen-subject-dash` 内，`#subj-tab-srs-review` 代码块之后、screen 结束 `</div>` 之前插入:

```html
<div id="qbank-cart" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:998;
  background:var(--surface-card);border-top:2px solid var(--color-primary);padding:8px 16px;
  box-shadow:0 -2px 12px rgba(0,0,0,0.1);">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
    <span style="font-weight:600;font-size:14px;">🛒 分享车 (<span id="qbank-cart-count">0</span>题)</span>
    <div>
      <button class="btn btn-secondary btn-small" onclick="_qbankClearCart()">清空</button>
      <button class="btn btn-primary btn-small" onclick="_qbankShareCart()" style="margin-left:6px;">📤 分享给好友</button>
    </div>
  </div>
  <div id="qbank-cart-items" style="max-height:100px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:4px;"></div>
</div>
```

- [ ] **步骤 2: 清理 dashboard.js — 删除旧残破分享代码**

在 `renderSubjQuestionBank()`（第 72 行）中，从工具栏 innerHTML 删除全局 `#qbank-select-mode` checkbox。旧工具栏包含:
```html
<label style="margin-left:8px;cursor:pointer;" id="qbank-select-label"><input type="checkbox" id="qbank-select-mode" onchange="_qbankToggleSelectMode()"> ☑ 选择分享</label>
```
删除这个 `<label>` 元素。工具栏只保留"仅显示错题"checkbox 和搜索框。

同时删除 `_qbankToggleSelectMode`、`_qbankInjectAttrs` 两个函数，以及第 99-113 行的委托 click handler。

- [ ] **步骤 3: 在 renderSubjQuestionBankContent 中每题加勾选框**

在 `renderSubjQuestionBankContent()` 中，历史轮次循环和未答题循环里，每个 `roundHtml` 的 q-detail `<p>` 之后追加:

```js
roundHtml += '<label class="qbank-check-label" onclick="event.stopPropagation();" style="display:inline-flex;align-items:center;gap:3px;margin-left:8px;font-size:11px;color:var(--text-muted);">'
  + '<input type="checkbox" class="qbank-check" onchange="_qbankOnCheck(this)" data-qdata=\''
  + JSON.stringify(q).replace(/'/g, '&#39;') + '\'> 加入分享车</label>';
```

（未答题代码块的 `pendingHtml` 同样追加。）

- [ ] **步骤 4: 在 dashboard.js 添加分享车管理函数**

新增以下函数:

```js
var _qbankCart = {};  // { key: questionObject }

function _qbankOnCheck(cb) {
  try {
    var q = JSON.parse(cb.getAttribute('data-qdata'));
    var key = q.question || ('q_' + Date.now() + '_' + Math.random());
    if (cb.checked) { _qbankCart[key] = q; }
    else { delete _qbankCart[key]; }
    _qbankRenderCart();
  } catch(e) {}
}

function _qbankRenderCart() {
  var cart = document.getElementById('qbank-cart');
  if (!cart) return;
  var keys = Object.keys(_qbankCart);
  if (keys.length === 0) { cart.style.display = 'none'; return; }
  cart.style.display = 'block';
  document.getElementById('qbank-cart-count').textContent = keys.length;
  var html = '';
  keys.forEach(function(k) {
    var q = _qbankCart[k];
    html += '<span style="display:inline-flex;align-items:center;gap:3px;background:var(--surface-hover);padding:2px 8px;border-radius:12px;font-size:11px;">'
      + escapeHtml((q.question||'').substring(0,25)) + '… '
      + '<button onclick="event.stopPropagation();delete _qbankCart[\''
      + k.replace(/'/g, "\\'") + '\'];_qbankRenderCart();" style="cursor:pointer;border:none;background:none;padding:0;font-size:13px;">×</button></span>';
  });
  document.getElementById('qbank-cart-items').innerHTML = html;
}

function _qbankClearCart() {
  _qbankCart = {};
  _qbankRenderCart();
  document.querySelectorAll('.qbank-check').forEach(function(cb) { cb.checked = false; });
}
```

- [ ] **步骤 5: 接线分享按钮**

新增 `_qbankShareCart()` 函数 — 从 `_qbankCart` 收集题目，调用 `_qbankShowShareDialog()`:

```js
function _qbankShareCart() {
  var questions = Object.values(_qbankCart);
  if (questions.length === 0) {
    if (typeof showToast === 'function') showToast('请先选择题目');
    return;
  }
  _qbankShowShareDialog(questions);
}
```

`_qbankShowShareDialog` 和 `_qbankDoShare` 已有现成实现，只需确保它们接收的 question 对象包含完整字段（question, type, options, answer, tag, explanation）。

- [ ] **步骤 6: 验证语法**

运行: `node --check D:/Qbao/js/dashboard.js`
预期: 无输出

---

### 任务 6: 重写 chatAnswerSharedQuizText

**文件:** 修改 `D:\Qbao\js/chat.js:1849-1866`

- [ ] **步骤 1: 替换残破函数**

删除现有 `chatAnswerSharedQuizText()`，替换为以下代码。完全参照 `chatAnswerSharedQuiz()` 的模式：

```js
async function chatAnswerSharedQuizText(msgId) {
  var input = document.getElementById('quiz-answer-input-' + msgId);
  if (!input) return;
  var userAnswer = input.value.trim();
  if (!userAnswer) return;

  input.disabled = true;
  var submitBtn = input.nextElementSibling;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中...'; }

  try {
    var res = await fetchWithAuth('/chat/rooms/' + chatOpenRoomId + '/messages?limit=50');
    if (!res || !res.ok) { input.disabled = false; if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交'; } return; }
    var data = await res.json();
    var messages = data.messages || [];
    var msg = null;
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].id === msgId) { msg = messages[i]; break; }
    }
    if (!msg || !msg.quiz_data) { input.disabled = false; if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交'; } return; }

    var quizData = msg.quiz_data;
    var question = quizData.questions[0];
    if (!question) { input.disabled = false; if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交'; } return; }

    quizData._result = {
      answered: true,
      correct: true,
      chosenAnswer: userAnswer,
      chosenAnswerIdx: -1,
      chosenAnswerText: userAnswer,
      correctAnswerIdx: -1,
      correctAnswerText: question.answer || '',
      answeredBy: authUser.displayName || authUser.username
    };

    await fetchWithAuth('/chat/messages/' + msgId + '/update-quiz', {
      method: 'POST',
      body: JSON.stringify({ quiz_data: quizData })
    });

    await chatLoadMessages(chatOpenRoomId, true);
  } catch(e) {
    if (typeof showToast === 'function') showToast('提交失败: ' + e.message);
    input.disabled = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交'; }
  }
}
```

- [ ] **步骤 2: 验证语法**

运行: `node --check D:/Qbao/js/chat.js`
预期: 无输出

---

### 任务 7: 聊天消息中主观题已回答的渲染

**文件:** 修改 `D:\Qbao\js/chat.js`（chatRenderMessage 中 quiz_share 分支，约第 355-402 行）

- [ ] **步骤 1: 处理 term/short 类型的已回答状态**

在 `chatRenderMessage()` 函数中，`if (quizResult && quizResult.answered)` 代码块内，在已有的 single/judge 渲染之后，加一个 `else if` 处理 term/short:

```js
} else if (question.type === 'term' || question.type === 'short') {
  // 主观题 — 显示用户文字答案 + 参考答案
  html += '<div style="margin-top:8px;padding:10px;border-radius:8px;background:rgba(46,168,86,0.08);border:1px solid rgba(46,168,86,0.25);">';
  html += '<div style="font-size:13px;font-weight:600;margin-bottom:6px;">✅ 已作答（主观题）</div>';
  html += '<div style="font-size:11px;margin-bottom:3px;"><b>你的答案：</b>' + escapeHtml(quizResult.chosenAnswerText || quizResult.chosenAnswer || '') + '</div>';
  if (quizResult.correctAnswerText) {
    html += '<div style="font-size:11px;margin-bottom:3px;color:#2ea856;"><b>参考答案：</b>' + escapeHtml(quizResult.correctAnswerText) + '</div>';
  }
  if (question.explanation) {
    html += '<div style="font-size:10px;color:var(--text-muted);margin-top:6px;padding:6px;background:rgba(0,0,0,0.03);border-radius:4px;">📖 ' + escapeHtml(question.explanation) + '</div>';
  }
  html += '<div style="font-size:10px;color:var(--text-muted);margin-top:6px;">作答人：' + escapeHtml(quizResult.answeredBy || '好友') + '</div>';
  html += '</div>';
}
```

插入在已作答代码块的 `html += '</div>';` 闭合之前。

- [ ] **步骤 2: 验证语法**

运行: `node --check D:/Qbao/js/chat.js`
预期: 无输出

---

### 任务 8: 修复作答后自动滚到底部

**文件:** 修改 `D:\Qbao\js/chat.js:1843`

- [ ] **步骤 1: 修改 isPollingRefresh 参数**

```js
// 旧代码（第 1843 行，chatAnswerSharedQuiz 函数内）:
await chatLoadMessages(chatOpenRoomId, false);

// 新代码:
await chatLoadMessages(chatOpenRoomId, true);
```

任务 6 的新 `chatAnswerSharedQuizText()` 已使用 `true`。

- [ ] **步骤 2: 验证语法**

运行: `node --check D:/Qbao/js/chat.js`
预期: 无输出

---

### 任务 9: 后端 — 加 updated_at 列 + 修复轮询

**文件:** 新建 `D:\Qbao\backend\sql\migration_v3.10.sql`，修改 `D:\Qbao\backend\src\routes\chat.routes.js`

- [ ] **步骤 1: 创建迁移文件**

新建 `D:\Qbao\backend\sql\migration_v3.10.sql`:

```sql
-- 迁移 v3.10: 为聊天消息加 updated_at 列以支持题目作答实时同步
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_chat_messages_updated ON chat_messages(room_id, updated_at DESC);
```

- [ ] **步骤 2: update-quiz 端点同步更新 updated_at**

在 `chat.routes.js` 中，找到 update-quiz 端点（约第 825 行）。修改:
```js
// 旧代码:
'UPDATE chat_messages SET quiz_data = $1 WHERE id = $2'

// 新代码:
'UPDATE chat_messages SET quiz_data = $1, updated_at = NOW() WHERE id = $2'
```

- [ ] **步骤 3: 轮询查询改用 updated_at**

在 `chat.routes.js` 中，找到轮询端点检测更新房间的查询（约第 876 行）。修改:
```sql
-- 旧代码:
WHERE cm.created_at > NOW() - INTERVAL '30 seconds'

-- 新代码:
WHERE cm.updated_at > NOW() - INTERVAL '30 seconds'
```

- [ ] **步骤 4: 前端轮询加速**

在 `js/chat.js` 第 1695 行:
```js
// 旧代码:
chatPollTimer = setInterval(chatPoll, 5000);

// 新代码:
chatPollTimer = setInterval(chatPoll, 2000);
```

- [ ] **步骤 5: 验证语法**

运行:
```bash
node --check D:/Qbao/backend/src/routes/chat.routes.js
node --check D:/Qbao/js/chat.js
```
预期: 两个命令都无输出

---

## 部署

所有改动都是标准文件编辑，无需构建（纯 JS SPA）。

```bash
# 1. 语法检查全部修改文件
node --check D:/Qbao/js/history.js
node --check D:/Qbao/js/subjects.js
node --check D:/Qbao/js/dashboard.js
node --check D:/Qbao/js/chat.js
node --check D:/Qbao/js/app.js
node --check D:/Qbao/backend/src/routes/chat.routes.js

# 2. 部署前端到测试服
scp -i ~/.ssh/ai_qbao_key01.pem \
  D:/Qbao/index.html \
  D:/Qbao/js/history.js \
  D:/Qbao/js/subjects.js \
  D:/Qbao/js/dashboard.js \
  D:/Qbao/js/chat.js \
  D:/Qbao/js/app.js \
  root@SERVER_IP:/var/www/qbao_test/

# 3. 部署后端到测试服
scp -i ~/.ssh/ai_qbao_key01.pem \
  D:/Qbao/backend/src/routes/chat.routes.js \
  root@SERVER_IP:/home/qbao/backend-test/src/routes/

scp -i ~/.ssh/ai_qbao_key01.pem \
  D:/Qbao/backend/sql/migration_v3.10.sql \
  root@SERVER_IP:/home/qbao/backend-test/sql/

# 4. 测试数据库执行迁移
ssh -i ~/.ssh/ai_qbao_key01.pem root@SERVER_IP \
  "psql -U qbao -d qbao -f /home/qbao/backend-test/sql/migration_v3.10.sql"

# 5. 重启测试后端
ssh -i ~/.ssh/ai_qbao_key01.pem root@SERVER_IP "pm2 restart qbao-api-test"

# 6. 浏览器验证 http://SERVER_IP:8080
# 7. ⏸️  你确认后 → 同步生产（不自动执行）
```

---

## 验证清单

- [ ] 侧栏章节: 无 📜 按钮，点击章节正常跳转
- [ ] 科目仪表盘 → 📚 题库: 每题显示 ☐ 勾选框
- [ ] 勾选 2-3 题 → 底部分享车显示计数 + 题目预览
- [ ] 分享车: 可移除单项、清空全部、点分享按钮弹出好友/群选择
- [ ] 分享给好友: quiz_share 消息正常到达聊天
- [ ] 题库点题目 → 详情弹窗在"你的答案"和"📖 解析"之间显示"✅ 正确答案: X. ..."
- [ ] 点击详情弹窗外部遮罩 → 弹窗关闭
- [ ] 按 ESC → 所有弹窗（含 qdetail-dialog）关闭
- [ ] 题库中答对的题目 → 详情显示 ✅（不是 ❌）
- [ ] 分享名词解释给好友 → 好友输入答案提交 → 双方看到文字答案 + 参考答案 + 解析
- [ ] 好友在聊天中答题 → 页面不自动滚到底部
- [ ] 作答方提交 → 发题方 2 秒内看到消息更新
