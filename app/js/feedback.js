// =============================================================================
//  feedback.js — User Feedback / Issue Reporting System
//  用户反馈系统：右下角气泡 → 提交issue → 管理员处理 → 用户验证
//  依赖: api.js (fetchWithAuth, API_BASE, getUser), utils.js (escapeHtml, showToast)
//        users.js (edgeBubbleHover, authUser), state.js (state)
// =============================================================================

var fbPollTimer = null;
var fbOpenIssueId = null;
var fbBubbleCardKeepOpen = false;
var fbIssuesCache = [];
var fbShowResolved = false;
var fbAdminShowResolved = false;
var fbAdminShowClosed = false;

// =============================================================================
//  气泡卡片 — 入口
// =============================================================================

function fbRenderBubbleCard() {
  if (!isOnlineMode || !authUser) {
    document.getElementById('edge-bubble-card').innerHTML =
      '<div class="fb-card-content"><div class="fb-issue-list-empty">请先登录</div></div>';
    return;
  }
  if (authUser.role === 'admin') {
    fbRenderAdminBubbleCard();
  } else {
    fbRenderUserBubbleCard();
  }
}

// =============================================================================
//  用户端气泡卡片
// =============================================================================

function fbRenderUserBubbleCard() {
  var card = document.getElementById('edge-bubble-card');
  var html = '<div class="fb-card-content">';
  html += '<div class="fb-card-header"><span>我的反馈</span></div>';
  html += '<div class="fb-issue-list" id="fb-user-issue-list"></div>';
  html += '<div class="fb-input-area">';
  html += '<textarea class="fb-input-textarea" id="fb-input-textarea" placeholder="请输入反馈内容..." onfocus="fbOnInputFocus()" onblur="fbOnInputBlur()"></textarea>';
  html += '<button class="fb-input-submit" onclick="fbSubmitIssue()">发送</button>';
  html += '</div></div>';
  card.innerHTML = html;
  fbLoadUserIssues();
}

function fbOnInputFocus() { fbBubbleCardKeepOpen = true; }
function fbOnInputBlur() {
  setTimeout(function() {
    var ta = document.getElementById('fb-input-textarea');
    if (ta && ta.value.trim() === '') fbBubbleCardKeepOpen = false;
  }, 300);
}

async function fbLoadUserIssues() {
  try {
    var res = await fetchWithAuth('/issues');
    if (!res || !res.ok) return;
    fbIssuesCache = await res.json();
    fbRenderUserIssueList();
  } catch(e) {}
}

function fbRenderUserIssueList() {
  var list = document.getElementById('fb-user-issue-list');
  if (!list) return;
  if (!fbIssuesCache || fbIssuesCache.length === 0) {
    list.innerHTML = '<div class="fb-issue-list-empty">暂无反馈记录<br>在下方输入框中提交</div>';
    return;
  }
  var active = fbIssuesCache.filter(function(i) { return i.status === 'unread' || i.status === 'read'; });
  var resolved = fbIssuesCache.filter(function(i) { return i.status === 'resolved'; });
  var closed = fbIssuesCache.filter(function(i) { return i.status === 'closed'; });
  active.sort(function(a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });

  var html = '';
  // 已完成（closed）— 最上方
  if (closed.length > 0) {
    html += '<div class="fb-collapse-section">';
    html += '<div class="fb-collapse-header" onclick="event.stopPropagation();fbToggleClosed()">';
    html += '<span class="fb-collapse-arrow">' + (fbShowClosed ? '▼' : '▶') + '</span>';
    html += '<span>已完成 (' + closed.length + ')</span>';
    html += '</div>';
    if (fbShowClosed) {
      html += '<div class="fb-collapse-body">';
      closed.forEach(function(issue) { html += fbIssueItemHTML(issue); });
      html += '</div>';
    }
    html += '</div>';
  }
  // 处理完毕（resolved）— 中间
  if (resolved.length > 0) {
    html += '<div class="fb-collapse-section">';
    html += '<div class="fb-collapse-header" onclick="event.stopPropagation();fbToggleResolved()">';
    html += '<span class="fb-collapse-arrow">' + (fbShowResolved ? '▼' : '▶') + '</span>';
    html += '<span>处理完毕 · 待验证 (' + resolved.length + ')</span>';
    html += '</div>';
    if (fbShowResolved) {
      html += '<div class="fb-collapse-body">';
      resolved.forEach(function(issue) { html += fbIssueItemHTML(issue); });
      html += '</div>';
    }
    html += '</div>';
  }
  // 活跃（unread/read）— 最下方
  active.forEach(function(issue) { html += fbIssueItemHTML(issue); });
  list.innerHTML = html;
}

function fbIssueItemHTML(issue) {
  var dotClass = (issue.status === 'closed') ? 'fb-dot-resolved' : ('fb-dot-' + issue.status);
  var timeStr = fbFormatTime(issue.updated_at || issue.created_at);
  var isAdmin = authUser && authUser.role === 'admin';
  var hasNew = isAdmin ? issue.has_new_for_admin : issue.has_new_for_user;
  var h = '<div class="fb-issue-item' + (hasNew ? ' fb-issue-item-new' : '') + '" onclick="fbOpenIssueModal(' + issue.id + ')">';
  h += '<span class="fb-issue-item-icon ' + dotClass + '"></span>';
  h += '<span class="fb-issue-item-title">' + escapeHtml(issue.title) + '</span>';
  if (hasNew) h += '<span class="fb-issue-new-dot"></span>';
  h += '<span class="fb-issue-item-time">' + timeStr + '</span>';
  h += '<span class="fb-issue-item-actions">';
  if (isAdmin && issue.status !== 'closed') {
    h += '<button class="fb-btn-delete" onclick="event.stopPropagation();fbAdminDeleteIssue(' + issue.id + ')" title="删除">🗑</button>';
  }
  if (!isAdmin && (issue.status === 'unread' || issue.status === 'read')) {
    h += '<button onclick="event.stopPropagation();fbShowRenameDialog(' + issue.id + ')" title="重命名">✏️</button>';
  }
  h += '</span></div>';
  return h;
}

var fbShowClosed = false;
function fbToggleClosed() {
  fbShowClosed = !fbShowClosed;
  fbRenderUserIssueList();
}
function fbToggleResolved() {
  fbShowResolved = !fbShowResolved;
  fbRenderUserIssueList();
}

// =============================================================================
//  管理员端气泡卡片
// =============================================================================

function fbRenderAdminBubbleCard() {
  var card = document.getElementById('edge-bubble-card');
  var html = '<div class="fb-card-content">';
  html += '<div class="fb-card-header"><span>用户反馈</span></div>';
  html += '<div class="fb-issue-list" id="fb-admin-bubble-list"></div>';
  html += '</div>';
  card.innerHTML = html;
  fbLoadAdminBubbleIssues();
}

async function fbLoadAdminBubbleIssues() {
  try {
    var res = await fetchWithAuth('/issues/admin');
    if (!res || !res.ok) return;
    fbIssuesCache = await res.json();
    fbRenderAdminBubbleList();
  } catch(e) {}
}

function fbRenderAdminBubbleList() {
  var list = document.getElementById('fb-admin-bubble-list');
  if (!list) return;
  if (!fbIssuesCache || fbIssuesCache.length === 0) {
    list.innerHTML = '<div class="fb-issue-list-empty">暂无用户反馈 🎉</div>';
    return;
  }
  var active = fbIssuesCache.filter(function(i) { return i.status === 'unread' || i.status === 'read'; });
  var resolved = fbIssuesCache.filter(function(i) { return i.status === 'resolved'; });
  var closed = fbIssuesCache.filter(function(i) { return i.status === 'closed'; });
  // 最新消息的在最下面 → updated_at 升序
  active.sort(function(a, b) { return new Date(a.updated_at) - new Date(b.updated_at); });

  var html = '';
  // 已完成（closed）— 最上方
  if (closed.length > 0) {
    html += '<div class="fb-collapse-section">';
    html += '<div class="fb-collapse-header" onclick="event.stopPropagation();fbAdminToggleClosed()">';
    html += '<span class="fb-collapse-arrow" id="fb-admin-closed-arrow">' + (fbAdminShowClosed ? '▼' : '▶') + '</span>';
    html += '<span>已完成 (' + closed.length + ')</span>';
    html += '</div>';
    if (fbAdminShowClosed) {
      html += '<div class="fb-collapse-body" id="fb-admin-closed-body">';
      closed.forEach(function(issue) { html += fbIssueItemHTML(issue); });
      html += '</div>';
    }
    html += '</div>';
  }
  // 处理完毕（resolved）— 中间
  if (resolved.length > 0) {
    html += '<div class="fb-collapse-section">';
    html += '<div class="fb-collapse-header" onclick="event.stopPropagation();fbAdminToggleResolved()">';
    html += '<span class="fb-collapse-arrow" id="fb-admin-resolved-arrow">' + (fbAdminShowResolved ? '▼' : '▶') + '</span>';
    html += '<span>处理完毕 · 待用户验证 (' + resolved.length + ')</span>';
    html += '</div>';
    if (fbAdminShowResolved) {
      html += '<div class="fb-collapse-body" id="fb-admin-resolved-body">';
      resolved.forEach(function(issue) { html += fbIssueItemHTML(issue); });
      html += '</div>';
    }
    html += '</div>';
  }
  // 活跃（unread/read）— 最下方，离气泡最近
  active.forEach(function(issue) { html += fbIssueItemHTML(issue); });
  list.innerHTML = html;
}

function fbAdminToggleResolved() {
  fbAdminShowResolved = !fbAdminShowResolved;
  fbRenderAdminBubbleList();
}

function fbAdminToggleClosed() {
  fbAdminShowClosed = !fbAdminShowClosed;
  fbRenderAdminBubbleList();
}

async function fbAdminDeleteIssue(issueId) {
  if (!confirm('确定删除此反馈？删除后用户端将同步移除。')) return;
  try {
    var res = await fetchWithAuth('/issues/' + issueId, { method: 'DELETE' });
    if (!res.ok) { var e = await res.json().catch(function(){ return {}; }); alert(e.error || '删除失败'); return; }
    if (fbOpenIssueId === issueId) fbCloseIssueModal();
    fbLoadAdminBubbleIssues();
    if (typeof showToast === 'function') showToast('反馈已删除');
  } catch(err) { alert('删除失败: ' + err.message); }
}

// =============================================================================
//  重命名弹窗（自定义，替代浏览器 prompt）
// =============================================================================

function fbShowRenameDialog(issueId) {
  var issue = fbIssuesCache.find(function(i) { return i.id === issueId; });
  if (!issue) return;
  var dialog = document.getElementById('fb-rename-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'fb-rename-dialog';
    dialog.className = 'dialog-overlay';
    dialog.setAttribute('onclick', 'if(event.target===this)fbCloseRenameDialog()');
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = '<div class="dialog-box" style="max-width:420px;">' +
    '<h3 style="margin:0 0 12px;">✏️ 修改标题</h3>' +
    '<input type="text" id="fb-rename-input" value="' + escapeHtml(issue.title) + '" maxlength="500" style="width:100%;padding:8px 12px;border:1px solid #dee2e6;border-radius:8px;font-size:13px;font-family:inherit;box-sizing:border-box;">' +
    '<div style="font-size:11px;color:#999;margin-top:4px;"><span id="fb-rename-count">' + issue.title.length + '</span>/500</div>' +
    '<div class="dialog-actions" style="margin-top:14px;">' +
    '<button class="btn btn-secondary btn-small" onclick="fbCloseRenameDialog()">取消</button>' +
    '<button class="btn btn-primary btn-small" onclick="fbDoRename(' + issueId + ')">保存</button>' +
    '</div></div>';
  dialog.classList.add('active');
  var input = document.getElementById('fb-rename-input');
  input.focus();
  input.setSelectionRange(0, input.value.length);
  input.addEventListener('input', function() {
    document.getElementById('fb-rename-count').textContent = input.value.length;
  });
}

function fbCloseRenameDialog() {
  var d = document.getElementById('fb-rename-dialog');
  if (d) d.classList.remove('active');
}

async function fbDoRename(issueId) {
  var input = document.getElementById('fb-rename-input');
  if (!input) return;
  var newTitle = input.value.trim();
  if (!newTitle) { alert('标题不能为空'); return; }
  if (newTitle.length > 500) { alert('标题不能超过500字'); return; }
  try {
    var res = await fetchWithAuth('/issues/' + issueId, {
      method: 'PUT', body: JSON.stringify({ title: newTitle })
    });
    if (!res.ok) { var e = await res.json().catch(function(){ return {}; }); alert(e.error || '重命名失败'); return; }
    fbCloseRenameDialog();
    if (typeof showToast === 'function') showToast('标题已更新');
    fbRefreshBubbleList();
  } catch(err) { alert('重命名失败: ' + err.message); }
}

// =============================================================================
//  Issue 详情弹窗
// =============================================================================

async function fbOpenIssueModal(issueId) {
  fbOpenIssueId = issueId;
  var modal = document.getElementById('issue-modal');
  if (!modal) return;
  modal.classList.add('active');
  document.getElementById('issue-modal-body').innerHTML =
    '<div style="text-align:center;padding:40px;color:#999;">加载中...</div>';
  await fbLoadIssueDetail(issueId);
}

function fbCloseIssueModal() {
  fbOpenIssueId = null;
  var modal = document.getElementById('issue-modal');
  if (modal) modal.classList.remove('active');
}

async function fbLoadIssueDetail(issueId) {
  try {
    var res = await fetchWithAuth('/issues/' + issueId);
    if (!res || !res.ok) {
      document.getElementById('issue-modal-body').innerHTML =
        '<div style="text-align:center;padding:40px;color:#e94560;">加载失败</div>';
      return;
    }
    var issue = await res.json();
    fbRenderIssueDetail(issue);
  } catch(e) {
    document.getElementById('issue-modal-body').innerHTML =
      '<div style="text-align:center;padding:40px;color:#e94560;">加载失败</div>';
  }
}

function fbRenderIssueDetail(issue) {
  var isAdmin = authUser && authUser.role === 'admin';
  var body = document.getElementById('issue-modal-body');
  if (!body) return;
  document.getElementById('issue-modal-title').textContent = issue.title;

  var html = '';
  html += '<div class="issue-header-bar">';
  html += '<span class="issue-status-badge issue-status-' + issue.status + '">' + fbStatusLabel(issue.status) + '</span>';
  html += '<span class="issue-header-meta">' + escapeHtml(issue.user_display_name || '用户') + ' · ' + fbFormatTime(issue.created_at) + '</span>';
  html += '</div>';

  html += '<div class="issue-chat-area" id="issue-chat-area">';
  html += fbRenderMessagesHTML(issue.messages, issue.user_id);
  html += '</div>';

  html += '<div class="issue-action-bar" id="issue-action-bar">';
  html += fbRenderActionBar(issue, isAdmin);
  html += '</div>';

  if (issue.status !== 'closed') {
    html += '<div class="issue-chat-input-area">';
    html += '<div style="flex:1;display:flex;flex-direction:column;gap:6px;">';
    // 图片预览区
    html += '<div class="issue-img-preview" id="issue-img-preview" style="display:none;"></div>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<input class="issue-chat-input" id="issue-chat-input" placeholder="输入消息...（可直接粘贴图片）" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();fbSendMessage();}" onpaste="fbHandlePaste(event)">';
    html += '<button class="issue-chat-send" onclick="fbSendMessage()">➤</button>';
    html += '</div></div>';
    html += '</div>';
  }

  body.innerHTML = html;
  fbScrollChatToBottom();
}

function fbRenderMessagesHTML(messages, issueOwnerId) {
  if (!messages || messages.length === 0) return '';
  var html = '';
  var currentUserId = authUser ? authUser.id : null;
  messages.forEach(function(msg) {
    if (msg.is_system) {
      html += '<div class="issue-message issue-message-system"><div class="issue-message-bubble">' + escapeHtml(msg.content) + '<div class="issue-message-time">' + fbFormatTime(msg.created_at) + '</div></div></div>';
    } else {
      var isMine = msg.user_id === currentUserId;
      var imagesHtml = fbRenderImagesHTML(msg.images, isMine);
      var textHtml = (msg.content && msg.content.trim()) ? '<div class="issue-message-bubble">' + escapeHtml(msg.content) + '</div>' : '';
      var timeHtml = '<div class="issue-message-time">' + fbFormatTime(msg.created_at) + '</div>';
      if (isMine) {
        html += '<div class="issue-message issue-message-mine"><div class="issue-msg-mine-wrap">' + imagesHtml + textHtml + timeHtml + '</div></div>';
      } else {
        var senderName = msg.sender_name || (msg.user_id === issueOwnerId ? '用户' : '管理员');
        html += '<div class="issue-message issue-message-other"><div class="issue-msg-other-wrap"><div class="issue-message-sender">' + escapeHtml(senderName) + '</div>' + imagesHtml + textHtml + timeHtml + '</div></div>';
      }
    }
  });
  return html;
}

function fbRenderImagesHTML(images, isMine) {
  if (!images || !Array.isArray(images) || images.length === 0) return '';
  var h = '<div class="issue-images' + (isMine ? ' issue-images-mine' : '') + '">';
  images.forEach(function(url) {
    if (!url) {
      h += '<div class="issue-img-deleted">图片已删除</div>';
    } else {
      h += '<img src="' + url + '" class="issue-img-msg" onclick="fbPreviewImage(\'' + url + '\')" loading="lazy">';
    }
  });
  h += '</div>';
  return h;
}

// 轮询时刷新（不重建输入框）
function fbRefreshIssueDetail(issueId) {
  var chatInput = document.getElementById("issue-chat-input");
  if (chatInput && document.activeElement === chatInput) return;
  fbLoadIssueDetail(issueId);
}

function fbRenderActionBar(issue, isAdmin) {
  var html = '';
  if (isAdmin) {
    if (issue.status === 'unread') {
      html += '<button class="issue-action-btn primary" onclick="fbMarkRead(' + issue.id + ')">✅ 标记为已读</button>';
    } else if (issue.status === 'read') {
      html += '<button class="issue-action-btn success" onclick="fbMarkResolved(' + issue.id + ')">✅ 标记为处理完毕</button>';
    }
  } else {
    if (issue.status === 'resolved') {
      html += '<button class="issue-action-btn success" onclick="fbMarkFixed(' + issue.id + ')">✅ 已修复</button>';
      html += '<button class="issue-action-btn danger" onclick="fbShowNotFixedInput(' + issue.id + ')">❌ 未修复</button>';
    }
  }
  if (!html) {
    html += '<span style="font-size:12px;color:#999;">' + fbStatusHint(issue.status, isAdmin) + '</span>';
  }
  return html;
}

// =============================================================================
//  状态操作
// =============================================================================

async function fbMarkRead(issueId) { await fbChangeStatus(issueId, 'read'); }
async function fbMarkResolved(issueId) { await fbChangeStatus(issueId, 'resolved'); }

async function fbMarkFixed(issueId) {
  await fbChangeStatus(issueId, 'closed');
  fbCloseIssueModal();
}

async function fbChangeStatus(issueId, status, reason) {
  try {
    var body = { status: status };
    if (reason) body.reason = reason;
    var res = await fetchWithAuth('/issues/' + issueId + '/status', {
      method: 'PATCH', body: JSON.stringify(body)
    });
    if (!res.ok) { var e = await res.json().catch(function(){ return {}; }); alert(e.error || '操作失败'); return; }
    if (fbOpenIssueId === issueId && status !== 'closed') {
      await fbLoadIssueDetail(issueId);
    }
    fbRefreshBubbleList();
  } catch(err) { alert('操作失败: ' + err.message); }
}

function fbShowNotFixedInput(issueId) {
  var bar = document.getElementById('issue-action-bar');
  if (!bar) return;
  bar.innerHTML = '<div class="issue-notfixed-reason">' +
    '<input type="text" id="fb-notfixed-reason-input" placeholder="请说明未修复的具体情况..." onkeydown="if(event.key===\'Enter\')fbMarkNotFixed(' + issueId + ')">' +
    '<button onclick="fbMarkNotFixed(' + issueId + ')">提交</button>' +
    '<button class="issue-action-btn" onclick="fbLoadIssueDetail(' + issueId + ')">取消</button></div>';
  setTimeout(function() {
    var input = document.getElementById('fb-notfixed-reason-input');
    if (input) input.focus();
  }, 100);
}

async function fbMarkNotFixed(issueId) {
  var reasonInput = document.getElementById('fb-notfixed-reason-input');
  var reason = reasonInput ? reasonInput.value.trim() : '';
  if (!reason) { alert('请说明未修复的具体情况'); return; }
  await fbChangeStatus(issueId, 'unread', reason);
}

// =============================================================================
//  图片粘贴 / 上传
// =============================================================================

var fbPendingImages = []; // { url, name, size }

function fbHandlePaste(e) {
  var items = (e.clipboardData || e.originalEvent.clipboardData).items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      var blob = items[i].getAsFile();
      fbUploadImage(blob);
      return;
    }
  }
}

async function fbUploadImage(blob) {
  var preview = document.getElementById('issue-img-preview');
  if (!preview) return;
  // 显示上传中
  var tmpId = 'img_tmp_' + Date.now();
  preview.style.display = 'flex';
  var tmpHtml = '<div class="issue-img-thumb" id="' + tmpId + '" style="opacity:0.5;">';
  tmpHtml += '<div style="width:80px;height:80px;background:#f0f0f0;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#999;">上传中...</div>';
  tmpHtml += '</div>';
  preview.insertAdjacentHTML('beforeend', tmpHtml);

  try {
    var formData = new FormData();
    formData.append('image', blob, 'paste_' + Date.now() + '.png');
    var res = await fetch(API_BASE + '/issues/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: formData
    });
    if (!res.ok) { var e = await res.json().catch(function(){ return {}; }); alert('图片上传失败: ' + (e.error || '请重试')); fbRemovePreviewImg(tmpId); return; }
    var data = await res.json();
    fbPendingImages.push(data);
    // 替换为预览图
    var el = document.getElementById(tmpId);
    if (el) {
      el.style.opacity = '1';
      el.innerHTML = '<div style="position:relative;display:inline-block;">' +
        '<img src="' + data.url + '" style="width:80px;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="fbPreviewImage(\'' + data.url + '\')">' +
        '<span onclick="event.stopPropagation();fbRemovePendingImage(\'' + data.url + '\',\'' + tmpId + '\')" style="position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:#e94560;color:#fff;font-size:12px;line-height:20px;text-align:center;cursor:pointer;">✕</span>' +
        '</div>';
    }
  } catch(err) {
    fbRemovePreviewImg(tmpId);
    alert('上传失败: ' + err.message);
  }
}

function fbRemovePreviewImg(tmpId) {
  var el = document.getElementById(tmpId);
  if (el) el.remove();
  // 如果全部移除了，隐藏预览区
  var preview = document.getElementById('issue-img-preview');
  if (preview && preview.querySelectorAll('.issue-img-thumb').length === 0) {
    preview.style.display = 'none';
  }
}

function fbRemovePendingImage(url, tmpId) {
  fbPendingImages = fbPendingImages.filter(function(img) { return img.url !== url; });
  fbRemovePreviewImg(tmpId);
}

function fbPreviewImage(url) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
  overlay.onclick = function() { overlay.remove(); };
  var img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
}

// =============================================================================
//  发送消息（含图片）
// =============================================================================

async function fbSendMessage() {
  if (!fbOpenIssueId) return;
  var input = document.getElementById('issue-chat-input');
  if (!input) return;
  var content = input.value.trim();
  // 无文字且无图片则忽略
  if (!content && fbPendingImages.length === 0) return;
  input.value = '';
  var images = fbPendingImages.map(function(img) { return img.url; });
  fbPendingImages = [];
  // 隐藏预览区
  var preview = document.getElementById('issue-img-preview');
  if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
  try {
    var res = await fetchWithAuth('/issues/' + fbOpenIssueId + '/messages', {
      method: 'POST', body: JSON.stringify({ content: content, images: images })
    });
    if (!res.ok) { var e = await res.json().catch(function(){ return {}; }); alert(e.error || '发送失败'); return; }
    await fbLoadIssueDetail(fbOpenIssueId);
    fbRefreshBubbleList();
    // 重新聚焦输入框，方便连续发消息
    setTimeout(function() {
      var inp = document.getElementById('issue-chat-input');
      if (inp) inp.focus();
    }, 150);
  } catch(err) { alert('发送失败: ' + err.message); }
}

// =============================================================================
//  Issue 提交
// =============================================================================

async function fbSubmitIssue() {
  var ta = document.getElementById('fb-input-textarea');
  if (!ta) return;
  var content = ta.value.trim();
  if (!content) return;
  var lines = content.split('\n');
  var title = lines[0].substring(0, 80);
  if (lines.length > 1 || content.length > 80) title += '...';

  try {
    var res = await fetchWithAuth('/issues', {
      method: 'POST', body: JSON.stringify({ title: title, content: content })
    });
    if (!res.ok) { var e = await res.json().catch(function(){ return {}; }); alert(e.error || '提交失败'); return; }
    ta.value = '';
    fbBubbleCardKeepOpen = false;
    if (typeof showToast === 'function') showToast('反馈已提交');
    await fbLoadUserIssues();
  } catch(err) { alert('提交失败: ' + err.message); }
}

// =============================================================================
//  轮询
// =============================================================================

function fbStartPolling() {
  fbStopPolling();
  fbPoll();
  fbPollTimer = setInterval(fbPoll, 15000);
}

function fbStopPolling() {
  if (fbPollTimer) { clearInterval(fbPollTimer); fbPollTimer = null; }
}

async function fbPoll() {
  if (!isOnlineMode || !getToken()) return;
  try {
    var res = await fetchWithAuth('/issues/updates');
    if (!res || !res.ok) return;
    var data = await res.json();
    fbHandlePollResult(data);
  } catch(e) {}
}

function fbHandlePollResult(data) {
  var isAdmin = authUser && authUser.role === 'admin';
  if (isAdmin && data.admin) {
    fbUpdateBadge(data.admin.unreadCount);
    if (fbOpenIssueId && data.admin.updatedIssues && data.admin.updatedIssues.indexOf(fbOpenIssueId) !== -1) {
      fbRefreshIssueDetail(fbOpenIssueId);
    }
  }
  if (!isAdmin && data.user) {
    fbUpdateBadge(data.user.unreadCount);
    if (fbOpenIssueId && data.user.updatedIssues && data.user.updatedIssues.indexOf(fbOpenIssueId) !== -1) {
      fbRefreshIssueDetail(fbOpenIssueId);
    }
  }
}

function fbRefreshBubbleList() {
  if (!authUser) return;
  if (authUser.role === 'admin') { fbLoadAdminBubbleIssues(); }
  else { fbLoadUserIssues(); }
}

// =============================================================================
//  红点 Badge（用户和管理员共用）
// =============================================================================

function fbUpdateBadge(count) {
  var badge = document.getElementById('fb-badge');
  if (!badge) return;
  if (count > 0) {
    badge.style.display = 'flex';
    badge.textContent = count > 99 ? '99+' : count;
  } else {
    badge.style.display = 'none';
  }
}

// =============================================================================
//  气泡展开/收起（移动端点击 + 桌面端备用）
// =============================================================================

function fbToggleBubble() {
  var bubble = document.getElementById('edge-bubble');
  var card = document.getElementById('edge-bubble-card');
  if (!bubble || !card) return;
  var isExpanded = bubble.classList.contains('edge-bubble--expanded');
  if (isExpanded) {
    bubble.classList.remove('edge-bubble--expanded');
    card.classList.remove('edge-bubble-card--visible');
    fbBubbleCardKeepOpen = false;
  } else {
    fbRenderBubbleCard();
    bubble.classList.add('edge-bubble--expanded');
    card.classList.add('edge-bubble-card--visible');
  }
}

// =============================================================================
//  点击卡片外部关闭（全局监听）
// =============================================================================

document.addEventListener('click', function(e) {
  var card = document.getElementById('edge-bubble-card');
  var bubble = document.getElementById('edge-bubble');
  var trigger = document.getElementById('edge-bubble-trigger');
  if (!card || !bubble) return;
  if (!card.classList.contains('edge-bubble-card--visible')) return;
  // 点击在气泡区域外 → 关闭
  if (!trigger.contains(e.target)) {
    bubble.classList.remove('edge-bubble--expanded');
    card.classList.remove('edge-bubble-card--visible');
    fbBubbleCardKeepOpen = false;
  }
});

// =============================================================================
//  工具函数
// =============================================================================

function fbStatusLabel(status) {
  var map = { unread: '未读', read: '已读', resolved: '处理完毕', closed: '已关闭' };
  return map[status] || status;
}

function fbStatusHint(status, isAdmin) {
  if (isAdmin) {
    if (status === 'unread') return '点击"标记为已读"通知用户';
    if (status === 'read') return '修复完成后点击"标记为处理完毕"';
    if (status === 'resolved') return '等待用户验证修复结果';
    if (status === 'closed') return '此 Issue 已关闭';
  } else {
    if (status === 'unread') return '等待管理员处理中...';
    if (status === 'read') return '管理员正在处理中...';
    if (status === 'resolved') return '请验证修复结果';
    if (status === 'closed') return '此 Issue 已关闭';
  }
  return '';
}

function fbFormatTime(isoStr) {
  if (!isoStr) return '';
  try {
    var d = new Date(isoStr);
    var now = new Date();
    var diffMs = now - d;
    if (diffMs < 60000) return '刚刚';
    if (diffMs < 3600000) return Math.floor(diffMs / 60000) + '分钟前';
    if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + '小时前';
    if (diffMs < 604800000) return Math.floor(diffMs / 86400000) + '天前';
    return (d.getMonth() + 1) + '/' + d.getDate();
  } catch(e) { return ''; }
}

function fbScrollChatToBottom() {
  requestAnimationFrame(function() {
    var chat = document.getElementById('issue-chat-area');
    if (chat) chat.scrollTop = chat.scrollHeight;
  });
}
