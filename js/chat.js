// =============================================================================
//  chat.js — Chat & Friend System (v3.9)
//  QQ-style layout: left sidebar (280px) + right chat area
//  Dependencies: api.js, utils.js, state.js, feedback.js (fbPreviewImage)
// =============================================================================

// =============================================================================
//  Global State
// =============================================================================
var chatPollTimer = null;
var chatOpenRoomId = null;
var chatRoomsCache = [];
var chatFriendsCache = [];
var chatRequestsCache = [];
var chatActiveTab = 'rooms'; // rooms | friends | requests
var chatPendingImages = [];   // { url, name, size }
var chatPendingFile = null;   // { url, name, size, mimeType }
var chatPendingQuiz = null;   // { questions[], setName, chapterName } (deprecated, use _chatQuizCart)
var _chatQuizCart = [];          // [{ question, path, flatIdx }] — batch share cart
var chatSelectedMemberIds = []; // for group creation
var chatIsMobileShowingRoom = false; // for mobile view switching

// =============================================================================
//  Modal Management
// =============================================================================

function openChatModal() {
  if (!isOnlineMode || !authUser) {
    if (typeof showToast === 'function') showToast('请先登录');
    return;
  }
  closeAllModals();
  var modal = document.getElementById('chat-modal');
  if (!modal) return;
  modal.classList.add('active');
  chatOpenRoomId = null;
  chatIsMobileShowingRoom = false;
  document.getElementById('chat-active').style.display = 'none';
  document.getElementById('chat-placeholder').style.display = 'flex';
  document.getElementById('chat-back-btn').style.display = 'none';
  document.getElementById('chat-modal').querySelector('.chat-modal-body').classList.remove('chat-showing-room');
  chatActiveTab = 'rooms';
  chatLoadRooms();
  chatUpdateTabUI();
  chatStartPolling();
}

function closeChatModal() {
  chatOpenRoomId = null;
  chatIsMobileShowingRoom = false;
  chatStopPolling();
  var modal = document.getElementById('chat-modal');
  if (modal) modal.classList.remove('active');
}

function chatBackToList() {
  chatOpenRoomId = null;
  chatIsMobileShowingRoom = false;
  _chatLastMsgCount = 0;
  _chatLastMsgHash = '';
  document.getElementById('chat-active').style.display = 'none';
  document.getElementById('chat-placeholder').style.display = 'flex';
  document.getElementById('chat-back-btn').style.display = 'none';
  document.getElementById('chat-modal').querySelector('.chat-modal-body').classList.remove('chat-showing-room');
  chatLoadRooms();
}

// =============================================================================
//  Tab Switching
// =============================================================================

function chatSwitchTab(tab) {
  chatActiveTab = tab;
  chatOpenRoomId = null;
  chatIsMobileShowingRoom = false;
  document.getElementById('chat-active').style.display = 'none';
  document.getElementById('chat-placeholder').style.display = 'flex';
  document.getElementById('chat-back-btn').style.display = 'none';
  document.getElementById('chat-modal').querySelector('.chat-modal-body').classList.remove('chat-showing-room');
  chatUpdateTabUI();
  if (tab === 'rooms') chatLoadRooms();
  else if (tab === 'friends') chatLoadFriends();
  else if (tab === 'requests') chatLoadFriendRequests();
}

function chatUpdateTabUI() {
  var tabs = document.querySelectorAll('.chat-tab-btn');
  tabs.forEach(function(t) { t.classList.remove('active'); });
  var activeTab = document.getElementById('chat-tab-' + chatActiveTab);
  if (activeTab) activeTab.classList.add('active');

  if (chatActiveTab === 'rooms') {
    document.getElementById('chat-search-input').placeholder = '搜索会话...';
  } else if (chatActiveTab === 'friends') {
    document.getElementById('chat-search-input').placeholder = '搜索好友...';
  } else {
    document.getElementById('chat-search-input').placeholder = '';
  }
}

// =============================================================================
//  Room List
// =============================================================================

async function chatLoadRooms() {
  try {
    var res = await fetchWithAuth('/chat/rooms');
    if (!res || !res.ok) return;
    var data = await res.json();
    chatRoomsCache = data.rooms || [];
    chatRenderRoomList();
  } catch(e) {}
}

function chatRenderRoomList() {
  var list = document.getElementById('chat-room-list');
  if (!list) return;

  if (chatActiveTab === 'friends') {
    chatRenderFriendList(list);
    return;
  }
  if (chatActiveTab === 'requests') {
    chatRenderRequestList(list);
    return;
  }

  if (!chatRoomsCache || chatRoomsCache.length === 0) {
    list.innerHTML = '<div class="chat-room-empty">暂无会话<br>添加好友开始聊天吧</div>';
    return;
  }

  var searchText = (document.getElementById('chat-search-input')?.value || '').trim().toLowerCase();
  var filtered = chatRoomsCache;
  if (searchText) {
    filtered = chatRoomsCache.filter(function(r) {
      return chatGetRoomName(r).toLowerCase().indexOf(searchText) !== -1;
    });
  }

  var html = '';
  filtered.forEach(function(room) {
    var name = chatGetRoomName(room);
    var avatarInitial = name.charAt(0).toUpperCase();
    var avatarClass = room.type === 'direct' ? 'direct' : 'group';
    var lastMsg = room.last_message || null;
    var lastMsgPreview = '';
    if (lastMsg) {
      if (lastMsg.msg_type === 'image') lastMsgPreview = '[图片]';
      else if (lastMsg.msg_type === 'file') lastMsgPreview = '[文件]';
      else if (lastMsg.msg_type === 'quiz_share') lastMsgPreview = '[分享题目]';
      else lastMsgPreview = (lastMsg.content || '').substring(0, 30);
    }
    var timeStr = lastMsg ? chatFormatTime(lastMsg.created_at) : '';
    var unread = parseInt(room.unread_count) || 0;
    var activeClass = chatOpenRoomId === room.id ? ' active' : '';

    html += '<div class="chat-room-item' + activeClass + '" onclick="chatOpenRoom(' + room.id + ')">';
    html += '<div class="chat-room-avatar ' + avatarClass + '">' + avatarInitial + '</div>';
    html += '<div class="chat-room-info">';
    html += '<div class="chat-room-name">' + escapeHtml(name) + '</div>';
    if (lastMsgPreview) html += '<div class="chat-room-last-msg">' + escapeHtml(lastMsgPreview) + '</div>';
    html += '</div>';
    html += '<div class="chat-room-meta">';
    if (timeStr) html += '<div class="chat-room-time">' + timeStr + '</div>';
    if (unread > 0) html += '<div class="chat-room-badge">' + (unread > 99 ? '99+' : unread) + '</div>';
    html += '</div>';
    html += '</div>';
  });

  list.innerHTML = html || '<div class="chat-room-empty">无匹配的会话</div>';
}

function chatFilterRooms() {
  if (chatActiveTab === 'rooms') chatRenderRoomList();
  else if (chatActiveTab === 'friends') chatRenderFriendList();
}

// =============================================================================
//  Open Room / Load Messages
// =============================================================================

async function chatOpenRoom(roomId) {
  chatOpenRoomId = roomId;
  chatIsMobileShowingRoom = true;
  _chatLastMsgCount = 0;
  _chatLastMsgHash = '';
  // Poll immediately for new messages
  chatPoll();

  // Mobile: hide sidebar, show chat area
  document.getElementById('chat-placeholder').style.display = 'none';
  document.getElementById('chat-active').style.display = 'flex';
  document.getElementById('chat-back-btn').style.display = (window.innerWidth <= 768) ? 'flex' : 'none';
  document.getElementById('chat-modal').querySelector('.chat-modal-body').classList.add('chat-showing-room');

  await chatLoadMessages(roomId, false);
  chatRenderRoomList();
  setTimeout(function() { chatScrollToBottom(); }, 300); // update active state

  // Mark as read — clear badge and refresh immediately
  try {
    await fetchWithAuth('/chat/rooms/' + roomId + '/read', { method: 'POST' });
    // Re-fetch updates to get correct badge count
    var updRes = await fetchWithAuth('/chat/updates');
    if (updRes && updRes.ok) {
      var updData = await updRes.json();
      chatUpdateBadge(updData.totalUnread || 0);
      chatLoadRooms();
    }
  } catch(e) {}
}

var _chatLastMsgCount = 0;
var _chatLastMsgHash = '';

async function chatLoadMessages(roomId, isPollingRefresh) {
  var container = document.getElementById('chat-messages');
  if (!container) return;
  var prevScrollTop = container.scrollTop;
  var wasAtBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 50;

  // Update header
  var room = chatRoomsCache.find(function(r) { return r.id === roomId; });
  if (room) {
    document.getElementById('chat-header-name').textContent = chatGetRoomName(room);
    if (room.type === 'group') {
      document.getElementById('chat-header-status').textContent = room.members.length + ' 人';
    } else {
      var otherMember = (room.members || []).find(function(m) { return m.id !== authUser.id; });
      if (otherMember && otherMember.last_seen_at) {
        var diff = Date.now() - new Date(otherMember.last_seen_at).getTime();
        if (diff < 5 * 60 * 1000) document.getElementById('chat-header-status').textContent = '在线';
        else document.getElementById('chat-header-status').textContent = '离线';
      } else {
        document.getElementById('chat-header-status').textContent = '';
      }
    }
    // Header actions: group management
    if (room.type === 'group') {
      document.getElementById('chat-header-actions').innerHTML =
        '<button class="chat-friend-action-btn" onclick="chatShowAddMembers(' + roomId + ')">+ 邀请</button>' +
        '<button class="chat-friend-action-btn danger" onclick="chatLeaveGroup(' + roomId + ')">退出</button>';
    } else {
      document.getElementById('chat-header-actions').innerHTML = '';
    }
  }

  // Show/hide quiz share button (only for direct chats)
  var quizBtn = document.getElementById('chat-tool-share-quiz');
  if (quizBtn) {
    quizBtn.style.display = (room && room.type === 'direct') ? '' : 'none';
  }

  try {
    var res = await fetchWithAuth('/chat/rooms/' + roomId + '/messages?limit=50');
    if (!res || !res.ok) return;
    var data = await res.json();
    var messages = data.messages || [];
    // Compute a quick hash of last message to detect content changes (e.g. quiz_data update)
    var lastHash = '';
    if (messages.length > 0) {
      var last = messages[messages.length - 1];
      var lastQuiz = last.quiz_data ? JSON.stringify(last.quiz_data) : '';
      var lastRev = last.is_revoked ? '1' : '0';
      lastHash = last.id + ':' + lastRev + ':' + lastQuiz + ':' + (last.content || '').substring(0, 50);
    }
    if (isPollingRefresh && messages.length === _chatLastMsgCount && lastHash === _chatLastMsgHash) {
      container.scrollTop = prevScrollTop;
      return;
    }
    _chatLastMsgCount = messages.length;
    _chatLastMsgHash = lastHash;
    container.innerHTML = '';
    messages.forEach(function(msg) { chatRenderMessage(msg); });
    if (wasAtBottom || !isPollingRefresh) { chatScrollToBottom(); } else { container.scrollTop = prevScrollTop; }
  } catch(e) {}
}

function chatRenderMessage(msg) {
  var container = document.getElementById('chat-messages');
  if (!container) return;

  var isMine = msg.user_id === authUser.id;
  var html = '';

  if (msg.is_revoked) {
    html += '<div class="chat-msg chat-msg-system"><div class="chat-msg-bubble revoked">' +
      (isMine ? '你撤回了一条消息' : (escapeHtml(msg.sender_name || '') + ' 撤回了一条消息')) +
      '</div></div>';
    container.insertAdjacentHTML('beforeend', html);
    return;
  }

  var wrapperClass = isMine ? 'chat-msg-mine' : 'chat-msg-other';
  html += '<div class="chat-msg ' + wrapperClass + '">';

  // Sender name for others in group
  if (!isMine && msg.sender_name) {
    html += '<div class="chat-msg-sender">' + escapeHtml(msg.sender_name) + '</div>';
  }

  // Render based on message type
  if (msg.msg_type === 'image') {
    // Image message
    html += '<div class="chat-msg-image-wrap">';
    var images = msg.images || [];
    images.forEach(function(url) {
      if (url) {
        html += '<img src="' + url + '" class="chat-msg-image" onclick="fbPreviewImage(\'' + url + '\')" loading="lazy">';
      }
    });
    html += '</div>';
    // Also show text content if exists
    if (msg.content && msg.content.trim()) {
      html += '<div class="chat-msg-bubble">' + escapeHtml(msg.content) + '</div>';
    }
  } else if (msg.msg_type === 'file') {
    // File message
    var fileInfo = msg.file_info || {};
    html += '<div class="chat-msg-bubble">';
    html += '<div class="chat-msg-file" onclick="window.open(\'' + (fileInfo.url || '') + '\', \'_blank\')">';
    html += '<div class="chat-msg-file-icon">📄</div>';
    html += '<div class="chat-msg-file-info">';
    html += '<div class="chat-msg-file-name">' + escapeHtml(fileInfo.name || '文件') + '</div>';
    if (fileInfo.size) html += '<div class="chat-msg-file-size">' + formatFileSize(fileInfo.size) + '</div>';
    html += '</div></div></div>';
    if (msg.content && msg.content.trim()) {
      html += '<div class="chat-msg-bubble" style="margin-top:4px;">' + escapeHtml(msg.content) + '</div>';
    }
  } else if (msg.msg_type === 'quiz_share' || msg.msg_type === 'bank_share') {
    // Inline quiz share — question rendered directly in chat
    var quizData = msg.quiz_data || {};
    var questions = quizData.questions || [];
    var question = questions[0]; // Single question
    var quizResult = quizData._result; // { answered: bool, correct: bool, chosenAnswer: string, answeredBy: string }

    html += '<div class="chat-msg-bubble" style="background:none;border:none;padding:0;color:var(--text-primary);">';
    html += '<div class="chat-msg-quiz-share" id="quiz-share-' + msg.id + '" data-quiz-data=\'' + JSON.stringify(quizData).replace(/'/g, '&#39;') + '\'>';

    if (question) {
      var typeMap = { single: '单选题', judge: '判断题', term: '名词解释', short: '简答题' };
      var typeName = typeMap[question.type] || question.type || '';
      html += '<div class="chat-quiz-share-header">';
      html += '<span class="chat-quiz-share-icon">📝</span>';
      html += '<span class="chat-quiz-share-title">' + typeName + '</span>';
      html += '</div>';
      html += '<div class="chat-quiz-share-from">来自：' + escapeHtml(quizData.fromUserName || '好友') + '</div>';

      // Question tag (if present)
      if (question.tag) {
        html += '<div style="margin:6px 0 2px;"><span style="font-size:10px;padding:1px 6px;background:var(--surface-hover);border-radius:10px;color:var(--text-secondary);">🏷️ ' + escapeHtml(question.tag) + '</span></div>';
      }
      // Question text
      html += '<div style="font-size:13px;color:var(--text-primary);margin:6px 0;line-height:1.6;">' + escapeHtml(question.question || '') + '</div>';

      if (quizResult && quizResult.answered) {
        // Already answered — show full result matching quiz system format
        var resultLabels = ['A','B','C','D','E','F'];
        var resultCorrect = quizResult.correct;
        if (question.type === 'single' || question.type === 'judge') {
        html += '<div style="margin-top:8px;padding:10px;border-radius:8px;';
        html += resultCorrect ? 'background:rgba(46,168,86,0.08);border:1px solid rgba(46,168,86,0.25);">' : 'background:rgba(220,53,69,0.06);border:1px solid rgba(220,53,69,0.2);">';
        html += '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">' + (resultCorrect ? '✅ 回答正确！' : '❌ 回答错误') + '</div>';

        // Show all options with highlights
        if (question.options && (question.type === 'single' || question.type === 'judge')) {
          html += '<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px;">';
          question.options.forEach(function(opt, oi) {
            var optLabel = resultLabels[oi] || String(oi);
            var optStyle = 'font-size:11px;padding:3px 6px;border-radius:4px;';
            if (quizResult.chosenAnswerIdx === oi && quizResult.correctAnswerIdx === oi) {
              optStyle += 'background:rgba(46,168,86,0.15);border:1px solid rgba(46,168,86,0.4);color:#2ea856;';
            } else if (quizResult.chosenAnswerIdx === oi) {
              optStyle += 'background:rgba(220,53,69,0.12);border:1px solid rgba(220,53,69,0.3);color:#dc3545;';
            } else if (quizResult.correctAnswerIdx === oi) {
              optStyle += 'background:rgba(46,168,86,0.1);border:1px solid rgba(46,168,86,0.3);color:#2ea856;';
            } else {
              optStyle += 'color:var(--text-secondary);';
            }
            html += '<div style="' + optStyle + '">' + optLabel + '. ' + escapeHtml(opt) + '</div>';
          });
          html += '</div>';
        }

        // Your answer / Standard answer (matching quiz report format)
        html += '<div style="font-size:11px;margin-top:4px;">';
        var yourOptLabel = (quizResult.chosenAnswerIdx !== undefined && quizResult.chosenAnswerIdx >= 0) ? resultLabels[quizResult.chosenAnswerIdx] : '';
        var correctOptLabel = (quizResult.correctAnswerIdx !== undefined && quizResult.correctAnswerIdx >= 0) ? resultLabels[quizResult.correctAnswerIdx] : '';
        var yourMark2 = resultCorrect ? '✓' : '✗';
        html += '<div style="margin-bottom:3px;">' + yourMark2 + ' <b>你的答案：</b>' + yourOptLabel + '. ' + escapeHtml(quizResult.chosenAnswerText || quizResult.chosenAnswer || '') + '</div>';
        html += '<div style="margin-bottom:3px;color:#2ea856;">✓ <b>标准答案：</b>' + correctOptLabel + '. ' + escapeHtml(quizResult.correctAnswerText || '') + '</div>';
        html += '</div>';
        html += '</div>';
        } else if (question.type === 'term' || question.type === 'short') {
        html += '<div style="margin-top:8px;padding:10px;border-radius:8px;background:rgba(46,168,86,0.08);border:1px solid rgba(46,168,86,0.25);">';
        html += '<div style="font-size:13px;font-weight:600;margin-bottom:6px;">✅ 已作答（主观题）</div>';
        html += '<div style="font-size:11px;margin-bottom:3px;"><b>你的答案：</b>' + escapeHtml(quizResult.chosenAnswerText || quizResult.chosenAnswer || '') + '</div>';
        if (quizResult.correctAnswerText) {
          html += '<div style="font-size:11px;margin-bottom:3px;color:#2ea856;"><b>参考答案：</b>' + escapeHtml(quizResult.correctAnswerText) + '</div>';
        }
        html += '</div>';
        }

        // Meta info
        html += '<div style="font-size:10px;color:var(--text-muted);margin-top:6px;">作答人：' + escapeHtml(quizResult.answeredBy || '好友') + ' · 来自：' + escapeHtml(quizData.fromUserName || '好友') + '</div>';

        // Explanation
        if (question.explanation) {
          html += '<div style="font-size:10px;color:var(--text-muted);margin-top:6px;padding:6px;background:rgba(0,0,0,0.03);border-radius:4px;">📖 ' + escapeHtml(question.explanation) + '</div>';
        }
      } else if (!isMine) {
        // Recipient hasn't answered yet — show answer interface
        html += '<div id="quiz-answer-area-' + msg.id + '" style="margin-top:8px;">';
        if (question.type === 'single' && question.options && question.options.length > 0) {
          html += '<div style="display:flex;flex-direction:column;gap:4px;">';
          var labels = ['A', 'B', 'C', 'D', 'E', 'F'];
          question.options.forEach(function(opt, oi) {
            html += '<button class="chat-quiz-option-btn" onclick="chatAnswerSharedQuiz(' + msg.id + ',' + oi + ')" style="text-align:left;padding:6px 10px;border:1px solid var(--border-default);border-radius:6px;background:var(--surface-bg);cursor:pointer;font-family:inherit;font-size:12px;color:var(--text-primary);">' + labels[oi] + '. ' + escapeHtml(opt) + '</button>';
          });
          html += '</div>';
        } else if (question.type === 'judge') {
          html += '<div style="display:flex;gap:8px;">';
          html += '<button class="chat-quiz-option-btn" onclick="chatAnswerSharedQuiz(' + msg.id + ',0)" style="flex:1;padding:6px 10px;border:1px solid var(--border-default);border-radius:6px;background:var(--surface-bg);cursor:pointer;font-family:inherit;font-size:12px;color:var(--text-primary);">✅ 正确</button>';
          html += '<button class="chat-quiz-option-btn" onclick="chatAnswerSharedQuiz(' + msg.id + ',1)" style="flex:1;padding:6px 10px;border:1px solid var(--border-default);border-radius:6px;background:var(--surface-bg);cursor:pointer;font-family:inherit;font-size:12px;color:var(--text-primary);">❌ 错误</button>';
          html += '</div>';
        } else {
          // Term/short answer — text input
          html += '<div style="display:flex;gap:6px;">';
          html += '<input type="text" id="quiz-answer-input-' + msg.id + '" placeholder="输入答案..." style="flex:1;padding:6px 10px;border:1px solid var(--border-default);border-radius:6px;font-size:12px;font-family:inherit;color:var(--text-primary);background:var(--surface-bg);">';
          html += '<button onclick="chatAnswerSharedQuizText(' + msg.id + ')" style="padding:6px 12px;border:none;border-radius:6px;background:var(--color-primary);color:#fff;cursor:pointer;font-family:inherit;font-size:12px;">提交</button>';
          html += '</div>';
        }
        html += '</div>';
      } else {
        // Sender — waiting for friend to answer
        html += '<div style="margin-top:8px;font-size:11px;color:var(--text-muted);padding:6px 8px;background:var(--surface-hover);border-radius:6px;">⏳ 等待好友作答...</div>';
      }
    }

    html += '</div></div>';
  } else {
    // Text message (default)
    if (msg.reply_to) {
      html += '<div class="chat-msg-bubble" style="font-size:10px;opacity:0.7;margin-bottom:4px;padding:4px 8px;">' +
        '回复 ' + escapeHtml(msg.reply_to.userName || '') + '：' +
        escapeHtml((msg.reply_to.content || '').substring(0, 30)) + '</div>';
    }
    html += '<div class="chat-msg-bubble">' + escapeHtml(msg.content || '') + '</div>';
  }

  // Time
  html += '<div class="chat-msg-time">' + chatFormatTime(msg.created_at) + '</div>';

  // Revoke button for own messages (within 2 min)
  if (isMine && !msg.is_revoked) {
    var elapsed = Date.now() - new Date(msg.created_at).getTime();
    if (elapsed < 2 * 60 * 1000) {
      html += '<div class="chat-msg-time" style="cursor:pointer;text-decoration:underline;" onclick="chatRevokeMessage(' + msg.id + ')">撤回</div>';
    }
  }

  html += '</div>';
  container.insertAdjacentHTML('beforeend', html);
}

function chatScrollToBottom() {
  requestAnimationFrame(function() {
    var chat = document.getElementById('chat-messages');
    if (chat) chat.scrollTop = chat.scrollHeight;
  });
}

// =============================================================================
//  Send Message
// =============================================================================

async function chatSendMessage() {
  if (!chatOpenRoomId) return;
  var input = document.getElementById('chat-input');
  if (!input) return;

  var content = input.value.trim();
  var hasImages = chatPendingImages.length > 0;
  var hasFile = chatPendingFile !== null;
  var hasQuiz = chatPendingQuiz !== null;

  if (!content && !hasImages && !hasFile && !hasQuiz) return;

  // Determine message type
  var msgType = 'text';
  var images = [];
  var fileInfo = null;
  var quizData = null;

  if (hasQuiz) {
    msgType = 'quiz_share';
    quizData = chatPendingQuiz;
  } else if (hasFile) {
    msgType = 'file';
    fileInfo = chatPendingFile;
  } else if (hasImages) {
    msgType = 'image';
    images = chatPendingImages.map(function(img) { return img.url; });
  }

  input.value = '';
  chatPendingImages = [];
  chatPendingFile = null;
  chatPendingQuiz = null;
  chatClearPreviews();

  try {
    var res = await fetchWithAuth('/chat/rooms/' + chatOpenRoomId + '/messages', {
      method: 'POST',
      body: JSON.stringify({
        content: content,
        msg_type: msgType,
        images: images,
        file_info: fileInfo,
        quiz_data: quizData
      })
    });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '发送失败');
      return;
    }
    await chatLoadMessages(chatOpenRoomId, true);
    chatLoadRooms(); // refresh room list
    // Clear badge for current room since user acknowledged by replying
    try { await fetchWithAuth("/chat/rooms/" + chatOpenRoomId + "/read", { method: "POST" }); } catch(e) {}
    // Refocus input
    setTimeout(function() {
      var inp = document.getElementById('chat-input');
      if (inp) inp.focus();
    }, 150);
  } catch(err) {
    if (typeof showToast === 'function') showToast('发送失败: ' + err.message);
  }
}

function chatHandleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatSendMessage();
  }
}

// =============================================================================
//  Message Revoke
// =============================================================================

async function chatRevokeMessage(msgId) {
  if (!confirm('确定撤回此消息？')) return;
  try {
    var res = await fetchWithAuth('/chat/messages/' + msgId + '/revoke', { method: 'POST' });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '撤回失败');
      return;
    }
    if (chatOpenRoomId) await chatLoadMessages(chatOpenRoomId);
  } catch(err) {
    if (typeof showToast === 'function') showToast('撤回失败: ' + err.message);
  }
}

// =============================================================================
//  Image Upload
// =============================================================================

function chatTriggerImage() {
  document.getElementById('chat-image-input').click();
}

async function chatHandleImageSelect(event) {
  var files = event.target.files;
  if (!files || files.length === 0) return;
  for (var i = 0; i < files.length; i++) {
    await chatUploadFileToServer(files[i], 'image');
  }
  event.target.value = '';
}

function chatHandlePaste(e) {
  var items = (e.clipboardData || e.originalEvent.clipboardData).items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      var blob = items[i].getAsFile();
      chatUploadFileToServer(blob, 'image');
      return;
    }
  }
}

// =============================================================================
//  File Upload
// =============================================================================

function chatTriggerFile() {
  document.getElementById('chat-file-input').click();
}

async function chatHandleFileSelect(event) {
  var file = event.target.files[0];
  if (!file) return;
  await chatUploadFileToServer(file, 'file');
  event.target.value = '';
}

async function chatUploadFileToServer(file, category) {
  var preview = category === 'image' ? document.getElementById('chat-img-preview') : document.getElementById('chat-file-preview');
  if (!preview) return;

  // Show uploading indicator
  var tmpId = 'upload_tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  preview.style.display = 'flex';
  var tmpHtml = '<div class="' + (category === 'image' ? 'chat-img-preview-item' : 'chat-file-preview-item') + '" id="' + tmpId + '" style="opacity:0.5;">';
  tmpHtml += '<div style="font-size:11px;color:var(--text-muted);">上传中...</div>';
  tmpHtml += '</div>';
  preview.insertAdjacentHTML('beforeend', tmpHtml);

  try {
    var formData = new FormData();
    formData.append('file', file);
    var res = await fetch(API_BASE + '/chat/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: formData
    });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast('上传失败: ' + (e.error || '请重试'));
      chatRemovePreviewItem(tmpId);
      return;
    }
    var data = await res.json();

    if (category === 'image') {
      chatPendingImages.push(data);
      // Replace with preview
      var el = document.getElementById(tmpId);
      if (el) {
        el.style.opacity = '1';
        el.className = 'chat-img-preview-item';
        el.innerHTML = '<img src="' + data.url + '" onclick="fbPreviewImage(\'' + data.url + '\')">' +
          '<button class="chat-img-preview-remove" onclick="event.stopPropagation();chatRemovePendingImage(\'' + data.url + '\',\'' + tmpId + '\')">✕</button>';
      }
    } else {
      chatPendingFile = data;
      var fel = document.getElementById(tmpId);
      if (fel) {
        fel.style.opacity = '1';
        fel.className = 'chat-file-preview-item';
        fel.innerHTML = '<span>📄 ' + escapeHtml(data.name) + '</span>' +
          '<button class="chat-file-preview-remove" onclick="event.stopPropagation();chatRemovePendingFile();chatRemovePreviewItem(\'' + tmpId + '\')">✕</button>';
      }
    }
  } catch(err) {
    chatRemovePreviewItem(tmpId);
    if (typeof showToast === 'function') showToast('上传失败: ' + err.message);
  }
}

function chatRemovePreviewItem(tmpId) {
  var el = document.getElementById(tmpId);
  if (el) el.remove();
  chatUpdatePreviewVisibility();
}

function chatRemovePendingImage(url, tmpId) {
  chatPendingImages = chatPendingImages.filter(function(img) { return img.url !== url; });
  chatRemovePreviewItem(tmpId);
}

function chatRemovePendingFile() {
  chatPendingFile = null;
  chatUpdatePreviewVisibility();
}

function chatUpdatePreviewVisibility() {
  var imgPreview = document.getElementById('chat-img-preview');
  var filePreview = document.getElementById('chat-file-preview');
  if (imgPreview && imgPreview.querySelectorAll('.chat-img-preview-item').length === 0) {
    imgPreview.style.display = 'none';
  }
  if (filePreview && filePreview.querySelectorAll('.chat-file-preview-item').length === 0) {
    filePreview.style.display = 'none';
  }
}

function chatClearPreviews() {
  var imgPreview = document.getElementById('chat-img-preview');
  var filePreview = document.getElementById('chat-file-preview');
  if (imgPreview) { imgPreview.innerHTML = ''; imgPreview.style.display = 'none'; }
  if (filePreview) { filePreview.innerHTML = ''; filePreview.style.display = 'none'; }
}

// =============================================================================
//  Friend Management
// =============================================================================

async function chatLoadFriends() {
  try {
    var res = await fetchWithAuth('/chat/friends');
    if (!res || !res.ok) return;
    var data = await res.json();
    chatFriendsCache = data.friends || [];
    chatActiveTab = 'friends';
    chatUpdateTabUI();
    chatRenderRoomList(); // will call chatRenderFriendList via chatActiveTab check
  } catch(e) {}
}

function chatRenderFriendList(list) {
  if (!list) list = document.getElementById('chat-room-list');
  if (!list) return;

  if (!chatFriendsCache || chatFriendsCache.length === 0) {
    list.innerHTML = '<div class="chat-room-empty">暂无好友<br>点击左上角 ➕ 添加好友</div>';
    return;
  }

  var searchText = (document.getElementById('chat-search-input')?.value || '').trim().toLowerCase();
  var filtered = chatFriendsCache;
  if (searchText) {
    filtered = chatFriendsCache.filter(function(f) {
      return (f.display_name || f.username || '').toLowerCase().indexOf(searchText) !== -1;
    });
  }

  var html = '';
  filtered.forEach(function(friend) {
    var initial = (friend.display_name || friend.username || '?').charAt(0).toUpperCase();
    var diff = friend.last_seen_at ? (Date.now() - new Date(friend.last_seen_at).getTime()) : Infinity;
    var online = diff < 5 * 60 * 1000;
    html += '<div class="chat-friend-item">';
    html += '<div class="chat-friend-avatar">' + initial + '</div>';
    html += '<div class="chat-friend-info">';
    html += '<div class="chat-friend-name">' + escapeHtml(friend.display_name || friend.username) + '</div>';
    html += '<div class="chat-friend-status">' + (online ? '在线' : '离线') + '</div>';
    html += '</div>';
    html += '<span class="chat-friend-online ' + (online ? 'online' : 'offline') + '"></span>';
    html += '<div class="chat-friend-actions">';
    html += '<button class="chat-friend-action-btn" onclick="event.stopPropagation();chatOpenDirectChat(' + friend.id + ')">发消息</button>';
    html += '<button class="chat-friend-action-btn danger" onclick="event.stopPropagation();chatDeleteFriend(' + friend.id + ',\'' + escapeHtml(friend.display_name || friend.username) + '\')">删除</button>';
    html += '</div>';
    html += '</div>';
  });

  list.innerHTML = html || '<div class="chat-room-empty">无匹配的好友</div>';
}

async function chatOpenDirectChat(friendId) {
  try {
    var res = await fetchWithAuth('/chat/rooms', {
      method: 'POST',
      body: JSON.stringify({ type: 'direct', friendId: friendId })
    });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '创建会话失败');
      return;
    }
    var data = await res.json();
    chatActiveTab = 'rooms';
    chatUpdateTabUI();
    await chatLoadRooms();
    chatOpenRoom(data.roomId);
  } catch(err) {
    if (typeof showToast === 'function') showToast('操作失败: ' + err.message);
  }
}

async function chatDeleteFriend(friendId, friendName) {
  if (!confirm('确定删除好友「' + (friendName || friendId) + '」？')) return;
  try {
    var res = await fetchWithAuth('/chat/friends/' + friendId, { method: 'DELETE' });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '删除失败');
      return;
    }
    if (typeof showToast === 'function') showToast('已删除好友');
    chatLoadFriends();
    chatLoadRooms();
  } catch(err) {
    if (typeof showToast === 'function') showToast('删除失败: ' + err.message);
  }
}

// =============================================================================
//  Friend Requests
// =============================================================================

async function chatLoadFriendRequests() {
  try {
    var res = await fetchWithAuth('/chat/friends/requests');
    if (!res || !res.ok) return;
    var data = await res.json();
    chatRequestsCache = data.requests || [];
    chatActiveTab = 'requests';
    chatUpdateTabUI();
    chatUpdateRequestsBadge();
    chatRenderRoomList(); // will call chatRenderRequestList
  } catch(e) {}
}

function chatRenderRequestList(list) {
  if (!list) list = document.getElementById('chat-room-list');
  if (!list) return;

  if (!chatRequestsCache || chatRequestsCache.length === 0) {
    list.innerHTML = '<div class="chat-room-empty">暂无好友申请</div>';
    return;
  }

  var html = '';
  chatRequestsCache.forEach(function(req) {
    var initial = (req.display_name || req.username || '?').charAt(0).toUpperCase();
    html += '<div class="chat-request-item">';
    html += '<div class="chat-friend-avatar">' + initial + '</div>';
    html += '<div class="chat-request-info">';
    html += '<div class="chat-request-name">' + escapeHtml(req.display_name || req.username) + '</div>';
    if (req.message) html += '<div class="chat-request-message">' + escapeHtml(req.message) + '</div>';
    html += '</div>';
    html += '<div class="chat-request-actions">';
    html += '<button class="chat-request-accept" onclick="chatAcceptRequest(' + req.id + ')">接受</button>';
    html += '<button class="chat-request-reject" onclick="chatRejectRequest(' + req.id + ')">拒绝</button>';
    html += '</div>';
    html += '</div>';
  });

  list.innerHTML = html;
}

async function chatAcceptRequest(requestId) {
  try {
    var res = await fetchWithAuth('/chat/friends/requests/' + requestId + '/accept', { method: 'POST' });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '操作失败');
      return;
    }
    if (typeof showToast === 'function') showToast('已添加为好友');
    chatLoadFriendRequests();
    chatLoadFriends();
    chatLoadRooms();
  } catch(err) {
    if (typeof showToast === 'function') showToast('操作失败: ' + err.message);
  }
}

async function chatRejectRequest(requestId) {
  try {
    var res = await fetchWithAuth('/chat/friends/requests/' + requestId + '/reject', { method: 'POST' });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '操作失败');
      return;
    }
    chatLoadFriendRequests();
  } catch(err) {
    if (typeof showToast === 'function') showToast('操作失败: ' + err.message);
  }
}

function chatUpdateRequestsBadge() {
  var badge = document.getElementById('chat-requests-badge');
  if (!badge) return;
  var count = chatRequestsCache.length;
  if (count > 0) {
    badge.style.display = 'inline';
    badge.textContent = count;
  } else {
    badge.style.display = 'none';
  }
}

// =============================================================================
//  Add Friend Dialog
// =============================================================================

function chatShowAddFriend() {
  var dialog = document.getElementById('chat-search-user-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'chat-search-user-dialog';
    dialog.className = 'dialog-overlay';
    dialog.setAttribute('onclick', 'if(event.target===this)chatCloseAddFriend()');
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = '<div class="dialog-box chat-sub-dialog-box" onclick="event.stopPropagation()">' +
    '<h3 class="chat-sub-dialog-title">➕ 添加好友</h3>' +
    '<input type="text" class="chat-user-search-input" id="chat-add-friend-input" placeholder="搜索用户名或显示名..." oninput="chatSearchUsers()">' +
    '<div class="chat-user-search-results" id="chat-add-friend-results">' +
    '<div class="chat-user-search-empty">输入关键词搜索用户</div>' +
    '</div>' +
    '<div class="dialog-actions" style="margin-top:10px;">' +
    '<button class="btn btn-secondary btn-small" onclick="chatCloseAddFriend()">关闭</button>' +
    '</div></div>';
  dialog.classList.add('active');

  setTimeout(function() {
    var input = document.getElementById('chat-add-friend-input');
    if (input) input.focus();
  }, 100);
}

function chatCloseAddFriend() {
  var d = document.getElementById('chat-search-user-dialog');
  if (d) d.classList.remove('active');
}

var chatSearchTimer = null;
async function chatSearchUsers() {
  if (chatSearchTimer) clearTimeout(chatSearchTimer);
  chatSearchTimer = setTimeout(async function() {
    var input = document.getElementById('chat-add-friend-input');
    if (!input) return;
    var q = input.value.trim();
    var container = document.getElementById('chat-add-friend-results');
    if (!container) return;

    if (!q || q.length < 1) {
      container.innerHTML = '<div class="chat-user-search-empty">输入关键词搜索用户</div>';
      return;
    }

    try {
      var res = await fetchWithAuth('/chat/users/search?q=' + encodeURIComponent(q));
      if (!res || !res.ok) return;
      var data = await res.json();
      var users = data.users || [];
      if (users.length === 0) {
        container.innerHTML = '<div class="chat-user-search-empty">未找到用户</div>';
        return;
      }
      var html = '';
      users.forEach(function(user) {
        html += '<div class="chat-user-search-item">';
        html += '<div style="display:flex;align-items:center;gap:8px;">';
        var initial = (user.display_name || user.username || '?').charAt(0).toUpperCase();
        html += '<div class="chat-friend-avatar">' + initial + '</div>';
        html += '<div class="chat-user-search-info">';
        html += '<div class="chat-user-search-name">' + escapeHtml(user.display_name || user.username) + '</div>';
        html += '<div class="chat-user-search-username">@' + escapeHtml(user.username) + '</div>';
        html += '</div></div>';
        html += '<button class="chat-user-search-add" onclick="chatSendFriendRequest(' + user.id + ',this)">添加</button>';
        html += '</div>';
      });
      container.innerHTML = html;
    } catch(e) {}
  }, 300);
}

var _chatRequestUserId = null;
var _chatRequestBtn = null;

function chatSendFriendRequest(userId, btn) {
  _chatRequestUserId = userId;
  _chatRequestBtn = btn;
  chatShowFriendRequestDialog();
}

function chatShowFriendRequestDialog() {
  var dialog = document.getElementById('chat-request-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'chat-request-dialog';
    dialog.className = 'dialog-overlay';
    dialog.setAttribute('onclick', 'if(event.target===this)chatCloseFriendRequestDialog()');
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = '<div class="dialog-box" style="max-width:420px;" onclick="event.stopPropagation()">' +
    '<h3 style="margin:0 0 12px;">➕ 发送好友申请</h3>' +
    '<textarea id="chat-request-message" placeholder="附言（可选，最多200字）" maxlength="200" style="width:100%;padding:8px 12px;border:1px solid var(--border-default);border-radius:8px;font-size:13px;font-family:inherit;color:var(--text-primary);background:var(--surface-bg);resize:vertical;min-height:60px;box-sizing:border-box;"></textarea>' +
    '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;"><span id="chat-request-count">0</span>/200</div>' +
    '<div class="dialog-actions" style="margin-top:14px;">' +
    '<button class="btn btn-secondary btn-small" onclick="chatCloseFriendRequestDialog()">取消</button>' +
    '<button class="btn btn-primary btn-small" onclick="chatDoSendFriendRequest()">发送申请</button>' +
    '</div></div>';
  dialog.classList.add('active');
  var textarea = document.getElementById('chat-request-message');
  textarea.focus();
  textarea.addEventListener('input', function() {
    document.getElementById('chat-request-count').textContent = textarea.value.length;
  });
}

function chatCloseFriendRequestDialog() {
  var d = document.getElementById('chat-request-dialog');
  if (d) d.classList.remove('active');
  _chatRequestUserId = null;
  _chatRequestBtn = null;
}

async function chatDoSendFriendRequest() {
  var userId = _chatRequestUserId;
  var btn = _chatRequestBtn;
  var message = (document.getElementById('chat-request-message')?.value || '').trim();

  chatCloseFriendRequestDialog();

  try {
    var res = await fetchWithAuth('/chat/friends/request', {
      method: 'POST',
      body: JSON.stringify({ friendId: userId, message: message || '' })
    });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '发送失败');
      return;
    }
    var data = await res.json();
    if (data.accepted) {
      if (typeof showToast === 'function') showToast('已添加为好友（对方已向你发送过申请）');
      chatLoadFriends();
      chatLoadRooms();
    } else {
      if (typeof showToast === 'function') showToast('好友申请已发送');
    }
    if (btn) {
      btn.textContent = '已发送';
      btn.className = 'chat-user-search-add sent';
      btn.disabled = true;
    }
  } catch(err) {
    if (typeof showToast === 'function') showToast('发送失败: ' + err.message);
  }
}

// =============================================================================
//  Group Management
// =============================================================================

async function chatShowCreateGroup() {
  // Load friends for member selection
  if (chatFriendsCache.length === 0) {
    try {
      var res = await fetchWithAuth('/chat/friends');
      if (res && res.ok) {
        var data = await res.json();
        chatFriendsCache = data.friends || [];
      }
    } catch(e) {}
  }

  if (chatFriendsCache.length === 0) {
    if (typeof showToast === 'function') showToast('请先添加好友');
    return;
  }

  chatSelectedMemberIds = [];

  var dialog = document.getElementById('chat-create-group-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'chat-create-group-dialog';
    dialog.className = 'dialog-overlay';
    dialog.setAttribute('onclick', 'if(event.target===this)chatCloseCreateGroup()');
    document.body.appendChild(dialog);
  }

  var memberHtml = '';
  chatFriendsCache.forEach(function(friend) {
    memberHtml += '<div class="chat-member-select-item" id="chat-group-member-' + friend.id + '" onclick="chatToggleGroupMember(' + friend.id + ')">' +
      '<div class="chat-member-select-check"></div>' +
      '<span>' + escapeHtml(friend.display_name || friend.username) + '</span>' +
      '</div>';
  });

  dialog.innerHTML = '<div class="dialog-box chat-sub-dialog-box" onclick="event.stopPropagation()">' +
    '<h3 class="chat-sub-dialog-title">👥 创建群聊</h3>' +
    '<input type="text" class="chat-user-search-input" id="chat-group-name-input" placeholder="群聊名称（可选）" maxlength="128">' +
    '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">选择好友：</div>' +
    '<div class="chat-member-select-list">' + memberHtml + '</div>' +
    '<div class="dialog-actions" style="margin-top:10px;">' +
    '<button class="btn btn-secondary btn-small" onclick="chatCloseCreateGroup()">取消</button>' +
    '<button class="btn btn-primary btn-small" onclick="chatCreateGroup()">创建</button>' +
    '</div></div>';
  dialog.classList.add('active');
}

function chatCloseCreateGroup() {
  var d = document.getElementById('chat-create-group-dialog');
  if (d) d.classList.remove('active');
}

function chatToggleGroupMember(userId) {
  var idx = chatSelectedMemberIds.indexOf(userId);
  if (idx === -1) chatSelectedMemberIds.push(userId);
  else chatSelectedMemberIds.splice(idx, 1);
  var el = document.getElementById('chat-group-member-' + userId);
  if (el) el.classList.toggle('selected');
}

async function chatCreateGroup() {
  if (chatSelectedMemberIds.length === 0) {
    if (typeof showToast === 'function') showToast('请至少选择一位好友');
    return;
  }

  var name = (document.getElementById('chat-group-name-input')?.value || '').trim();

  try {
    var res = await fetchWithAuth('/chat/rooms', {
      method: 'POST',
      body: JSON.stringify({ type: 'group', name: name || '群聊', memberIds: chatSelectedMemberIds })
    });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '创建失败');
      return;
    }
    var data = await res.json();
    chatCloseCreateGroup();
    if (typeof showToast === 'function') showToast('群聊已创建');
    chatActiveTab = 'rooms';
    chatUpdateTabUI();
    await chatLoadRooms();
    chatOpenRoom(data.roomId);
  } catch(err) {
    if (typeof showToast === 'function') showToast('创建失败: ' + err.message);
  }
}

async function chatShowAddMembers(roomId) {
  if (chatFriendsCache.length === 0) {
    try {
      var res = await fetchWithAuth('/chat/friends');
      if (res && res.ok) {
        var data = await res.json();
        chatFriendsCache = data.friends || [];
      }
    } catch(e) {}
  }

  chatSelectedMemberIds = [];

  var dialog = document.getElementById('chat-add-members-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'chat-add-members-dialog';
    dialog.className = 'dialog-overlay';
    dialog.setAttribute('onclick', 'if(event.target===this)chatCloseAddMembers()');
    document.body.appendChild(dialog);
  }

  var memberHtml = '';
  chatFriendsCache.forEach(function(friend) {
    memberHtml += '<div class="chat-member-select-item" id="chat-add-member-' + friend.id + '" onclick="chatToggleGroupMember(' + friend.id + ')">' +
      '<div class="chat-member-select-check"></div>' +
      '<span>' + escapeHtml(friend.display_name || friend.username) + '</span>' +
      '</div>';
  });

  dialog.innerHTML = '<div class="dialog-box chat-sub-dialog-box" onclick="event.stopPropagation()">' +
    '<h3 class="chat-sub-dialog-title">👥 邀请好友</h3>' +
    '<div class="chat-member-select-list">' + memberHtml + '</div>' +
    '<div class="dialog-actions" style="margin-top:10px;">' +
    '<button class="btn btn-secondary btn-small" onclick="chatCloseAddMembers()">取消</button>' +
    '<button class="btn btn-primary btn-small" onclick="chatDoAddMembers(' + roomId + ')">邀请</button>' +
    '</div></div>';
  dialog.classList.add('active');
}

function chatCloseAddMembers() {
  var d = document.getElementById('chat-add-members-dialog');
  if (d) d.classList.remove('active');
}

async function chatDoAddMembers(roomId) {
  if (chatSelectedMemberIds.length === 0) {
    if (typeof showToast === 'function') showToast('请至少选择一位好友');
    return;
  }
  try {
    var res = await fetchWithAuth('/chat/rooms/' + roomId + '/add-members', {
      method: 'POST',
      body: JSON.stringify({ userIds: chatSelectedMemberIds })
    });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '邀请失败');
      return;
    }
    chatCloseAddMembers();
    if (typeof showToast === 'function') showToast('已邀请');
    if (chatOpenRoomId) chatLoadMessages(chatOpenRoomId);
  } catch(err) {
    if (typeof showToast === 'function') showToast('邀请失败: ' + err.message);
  }
}

async function chatLeaveGroup(roomId) {
  if (!confirm('确定退出群聊？')) return;
  try {
    var res = await fetchWithAuth('/chat/rooms/' + roomId + '/leave', { method: 'POST' });
    if (!res.ok) {
      var e = await res.json().catch(function(){ return {}; });
      if (typeof showToast === 'function') showToast(e.error || '退出失败');
      return;
    }
    chatBackToList();
    chatLoadRooms();
  } catch(err) {
    if (typeof showToast === 'function') showToast('退出失败: ' + err.message);
  }
}

// =============================================================================
// Drill-down quiz share picker (v3.9.4)
// Subject → Chapter → QuizSet → Question step-by-step selection
// =============================================================================

var _chatShareTree = [];       // [{ id, name, chapters: [{ id, name, quizSets: [{ name, qsIdx, questions: [{ question, qIndex, flatIdx }] }] }] }]
var _chatShareFlat = [];       // Flat search list: [{ question, qIndex, path, sid, cid, qsIdx }]
var _chatShareDrill = {        // Current drill-down position
  level: 'subject',            // 'subject' | 'chapter' | 'quizset' | 'question'
  subjectId: null,
  chapterId: null,
  quizSetIdx: null
};

function chatShowShareQuiz() {
  _chatShareTree = [];
  _chatShareFlat = [];
  _chatShareDrill = { level: 'subject', subjectId: null, chapterId: null, quizSetIdx: null };

  Object.keys(state.subjects).forEach(function(sid) {
    var subj = state.subjects[sid];
    var treeSubj = { id: sid, name: subj.name, chapters: [] };
    (subj.chapterIds || []).forEach(function(cid) {
      var ch = state.chapters[cid];
      if (!ch) return;
      var treeCh = { id: cid, name: ch.name, quizSets: [] };
      (ch.quizSets || []).forEach(function(qs, qsIdx) {
        if (!qs.questions || qs.questions.length === 0) return;
        var treeQs = { name: '第' + (qsIdx + 1) + '轮', qsIdx: qsIdx, questions: [] };
        qs.questions.forEach(function(q, qi) {
          var fi = _chatShareFlat.length;
          _chatShareFlat.push({
            question: q, qIndex: qi,
            path: subj.name + ' > ' + ch.name + ' > 第' + (qsIdx + 1) + '轮 > Q' + (qi + 1),
            sid: sid, cid: cid, qsIdx: qsIdx
          });
          treeQs.questions.push({ question: q, qIndex: qi, flatIdx: fi });
        });
        treeCh.quizSets.push(treeQs);
      });
      if ((!ch.quizSets || ch.quizSets.length === 0) && ch.questions && ch.questions.length > 0) {
        var treeQs = { name: '章节题目', qsIdx: -1, questions: [] };
        ch.questions.forEach(function(q, qi) {
          var fi = _chatShareFlat.length;
          _chatShareFlat.push({
            question: q, qIndex: qi,
            path: subj.name + ' > ' + ch.name + ' > Q' + (qi + 1),
            sid: sid, cid: cid, qsIdx: -1
          });
          treeQs.questions.push({ question: q, qIndex: qi, flatIdx: fi });
        });
        treeCh.quizSets.push(treeQs);
      }
      if (treeCh.quizSets.length > 0) treeSubj.chapters.push(treeCh);
    });
    if (treeSubj.chapters.length > 0) _chatShareTree.push(treeSubj);
  });

  if (_chatShareFlat.length === 0) {
    if (typeof showToast === 'function') showToast('暂无题目可分享，请先创建题目');
    return;
  }

  _chatRenderShareDialog();
  _chatRenderDrillView();
}

function _chatRenderShareDialog() {
  var dialog = document.getElementById('chat-share-quiz-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.id = 'chat-share-quiz-dialog';
    dialog.className = 'dialog-overlay';
    dialog.setAttribute('onclick', 'if(event.target===this)chatCloseShareQuiz()');
    document.body.appendChild(dialog);
  }

  var html = '<div class="dialog-box chat-sub-dialog-box" onclick="event.stopPropagation()" style="max-width:480px;max-height:75vh;display:flex;flex-direction:column;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
    '<h3 class="chat-sub-dialog-title" style="margin:0;" id="chat-share-title">选择科目</h3>' +
    '<button onclick="chatCloseShareQuiz()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted);padding:0 4px;line-height:1;">&times;</button>' +
    '</div>' +
    '<div id="chat-share-breadcrumb" style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;min-height:18px;"></div>' +
    '<input type="text" class="chat-user-search-input" id="chat-share-filter" placeholder="搜索题目（可在任意层级搜索）..." oninput="_chatOnShareFilter()" style="margin-bottom:8px;">' +
    '<div class="chat-quiz-select-list" id="chat-share-list" style="max-height:380px;flex:1;"></div>' +
    '</div>';

  dialog.innerHTML = html;
  dialog.classList.add('active');

  setTimeout(function() {
    var inp = document.getElementById('chat-share-filter');
    if (inp) inp.focus();
  }, 100);
}

function _chatDrillChapter(el) {
  var subjId = el.getAttribute('data-subj-id');
  _chatShareDrill.level = 'chapter';
  _chatShareDrill.subjectId = subjId;
  _chatShareDrill.chapterId = null;
  _chatShareDrill.quizSetIdx = null;
  var filterInput = document.getElementById('chat-share-filter');
  if (filterInput) filterInput.value = '';
  _chatRenderDrillView();
}

function _chatDrillQuizSet(el) {
  var chId = el.getAttribute('data-ch-id');
  _chatShareDrill.level = 'quizset';
  _chatShareDrill.chapterId = chId;
  _chatShareDrill.quizSetIdx = null;
  var filterInput = document.getElementById('chat-share-filter');
  if (filterInput) filterInput.value = '';
  _chatRenderDrillView();
}

function _chatDrillQuestion(el) {
  var qsIdx = parseInt(el.getAttribute('data-qs-idx'));
  _chatShareDrill.level = 'question';
  _chatShareDrill.quizSetIdx = qsIdx;
  var filterInput = document.getElementById('chat-share-filter');
  if (filterInput) filterInput.value = '';
  _chatRenderDrillView();
}

function _chatDrillBack() {
  if (_chatShareDrill.level === 'chapter') {
    _chatShareDrill.level = 'subject';
    _chatShareDrill.subjectId = null;
    _chatShareDrill.chapterId = null;
    _chatShareDrill.quizSetIdx = null;
  } else if (_chatShareDrill.level === 'quizset') {
    _chatShareDrill.level = 'chapter';
    _chatShareDrill.chapterId = null;
    _chatShareDrill.quizSetIdx = null;
  } else if (_chatShareDrill.level === 'question') {
    _chatShareDrill.level = 'quizset';
    _chatShareDrill.quizSetIdx = null;
  }
  var filterInput = document.getElementById('chat-share-filter');
  if (filterInput) filterInput.value = '';
  _chatRenderDrillView();
}

function _chatRenderDrillView(filterText) {
  var listEl = document.getElementById('chat-share-list');
  if (!listEl) return;
  var filter = (filterText || '').trim().toLowerCase();
  var level = _chatShareDrill.level;
  var typeMap = { single: '单选题', judge: '判断题', term: '名词解释', short: '简答题' };
  var typeIcon = { single: '📋', judge: '⚖️', term: '📖', short: '✍️' };

  // Update title
  var titleEl = document.getElementById('chat-share-title');
  var levelLabels = { subject: '选择科目', chapter: '选择章节', quizset: '选择轮次', question: '选择题目' };
  if (titleEl) titleEl.textContent = (levelLabels[level] || '选择题目');

  // Render breadcrumb
  _chatRenderBreadcrumb();

  var html = '';
  var totalShown = 0;

  if (filter) {
    // Search mode: show matching questions from flat list
    _chatShareFlat.forEach(function(item, i) {
      var q = item.question;
      var qText = (q.question || '').toLowerCase();
      if (qText.indexOf(filter) === -1 && item.path.toLowerCase().indexOf(filter) === -1) return;
      totalShown++;
      var icon = typeIcon[q.type] || '📝';
      var typeName = typeMap[q.type] || q.type;
      html += '<div class="chat-quiz-select-item" data-flat-idx="' + i + '" onclick="chatSelectSingleQuiz(' + i + ')">';
      html += '<div class="chat-quiz-select-info">';
      html += '<div class="chat-quiz-select-name">' + icon + ' ' + escapeHtml((q.question || '').substring(0, 50)) + '</div>';
      html += '<div class="chat-quiz-select-meta">' + typeName + ' · ' + escapeHtml(item.path) + '</div>';
      html += '</div></div>';
    });
  } else if (level === 'subject') {
    // Level 1: Show subjects — click to drill into chapters
    _chatShareTree.forEach(function(subj) {
      var totalQ = 0;
      subj.chapters.forEach(function(ch) { ch.quizSets.forEach(function(qs) { totalQ += qs.questions.length; }); });
      html += '<div class="chat-quiz-select-item" data-subj-id="' + subj.id + '" onclick="_chatDrillChapter(this)" style="display:flex;align-items:center;">';
      html += '<div class="chat-quiz-select-info" style="flex:1;">';
      html += '<div class="chat-quiz-select-name">📚 ' + escapeHtml(subj.name) + '</div>';
      html += '<div class="chat-quiz-select-meta">' + subj.chapters.length + ' 个章节 · ' + totalQ + ' 题</div>';
      html += '</div>';
      html += '<span style="color:var(--text-muted);font-size:16px;">▶</span>';
      html += '</div>';
      totalShown++;
    });
  } else if (level === 'chapter') {
    // Level 2: Show chapters for selected subject — click to drill into quizsets
    var subj = null;
    for (var i = 0; i < _chatShareTree.length; i++) {
      if (_chatShareTree[i].id === _chatShareDrill.subjectId) { subj = _chatShareTree[i]; break; }
    }
    if (!subj) { html = '<div class="chat-user-search-empty">科目不存在</div>'; }
    else {
      subj.chapters.forEach(function(ch) {
        var totalQ = 0;
        ch.quizSets.forEach(function(qs) { totalQ += qs.questions.length; });
        html += '<div class="chat-quiz-select-item" data-ch-id="' + ch.id + '" onclick="_chatDrillQuizSet(this)" style="display:flex;align-items:center;">';
        html += '<div class="chat-quiz-select-info" style="flex:1;">';
        html += '<div class="chat-quiz-select-name">📖 ' + escapeHtml(ch.name) + '</div>';
        html += '<div class="chat-quiz-select-meta">' + ch.quizSets.length + ' 个轮次 · ' + totalQ + ' 题</div>';
        html += '</div>';
        html += '<span style="color:var(--text-muted);font-size:16px;">▶</span>';
        html += '</div>';
        totalShown++;
      });
    }
  } else if (level === 'quizset') {
    // Level 3: Show quizSets for selected chapter — click to drill into questions
    var subj2 = null, ch2 = null;
    for (var j = 0; j < _chatShareTree.length; j++) {
      if (_chatShareTree[j].id === _chatShareDrill.subjectId) { subj2 = _chatShareTree[j]; break; }
    }
    if (subj2) {
      for (var k = 0; k < subj2.chapters.length; k++) {
        if (subj2.chapters[k].id === _chatShareDrill.chapterId) { ch2 = subj2.chapters[k]; break; }
      }
    }
    if (!ch2) { html = '<div class="chat-user-search-empty">章节不存在</div>'; }
    else {
      ch2.quizSets.forEach(function(qs, qi) {
        html += '<div class="chat-quiz-select-item" data-qs-idx="' + qi + '" onclick="_chatDrillQuestion(this)" style="display:flex;align-items:center;">';
        html += '<div class="chat-quiz-select-info" style="flex:1;">';
        html += '<div class="chat-quiz-select-name">📝 ' + escapeHtml(qs.name) + '</div>';
        html += '<div class="chat-quiz-select-meta">' + qs.questions.length + ' 题</div>';
        html += '</div>';
        html += '<span style="color:var(--text-muted);font-size:16px;">▶</span>';
        html += '</div>';
        totalShown++;
      });
    }
  } else if (level === 'question') {
    // Level 4: Show questions — click to select
    var subj3 = null, ch3 = null;
    for (var m = 0; m < _chatShareTree.length; m++) {
      if (_chatShareTree[m].id === _chatShareDrill.subjectId) { subj3 = _chatShareTree[m]; break; }
    }
    if (subj3) {
      for (var n = 0; n < subj3.chapters.length; n++) {
        if (subj3.chapters[n].id === _chatShareDrill.chapterId) { ch3 = subj3.chapters[n]; break; }
      }
    }
    if (!ch3 || !ch3.quizSets[_chatShareDrill.quizSetIdx]) { html = '<div class="chat-user-search-empty">轮次不存在</div>'; }
    else {
      var qs = ch3.quizSets[_chatShareDrill.quizSetIdx];
      qs.questions.forEach(function(qw) {
        var q = qw.question;
        var icon = typeIcon[q.type] || '📝';
        var typeName = typeMap[q.type] || q.type;
        html += '<div class="chat-quiz-select-item" data-flat-idx="' + qw.flatIdx + '" onclick="chatSelectSingleQuiz(' + qw.flatIdx + ')">';
        html += '<div class="chat-quiz-select-info">';
        html += '<div class="chat-quiz-select-name">' + icon + ' Q' + (qw.qIndex + 1) + '. ' + escapeHtml((q.question || '').substring(0, 60)) + '</div>';
        html += '<div class="chat-quiz-select-meta">' + typeName + '</div>';
        html += '</div></div>';
        totalShown++;
      });
    }
  }

  if (totalShown === 0) {
    html = '<div class="chat-user-search-empty">' + (filter ? '无匹配的题目' : '暂无内容') + '</div>';
  }
  listEl.innerHTML = html;
}

function _chatOnShareFilter() {
  var inp = document.getElementById('chat-share-filter');
  var filter = inp ? inp.value : '';
  _chatRenderDrillView(filter);
}

function _chatRenderBreadcrumb() {
  var el = document.getElementById('chat-share-breadcrumb');
  if (!el) return;
  var level = _chatShareDrill.level;
  var html = '';

  if (level !== 'subject') {
    // Back button
    html += '<span onclick="_chatDrillBack()" style="cursor:pointer;color:var(--color-primary);text-decoration:underline;margin-right:6px;">← 返回</span> ';
  }

  // Build path display
  var subjName = '';
  for (var i = 0; i < _chatShareTree.length; i++) {
    if (_chatShareTree[i].id === _chatShareDrill.subjectId) { subjName = _chatShareTree[i].name; break; }
  }

  if (level === 'subject') {
    html += '<span style="color:var(--color-primary);">📚 全部科目</span>';
  } else if (subjName) {
    html += '<span style="color:var(--text-secondary);">📚 ' + escapeHtml(subjName) + '</span>';

    var chName = '';
    var subjRef = null;
    for (var j = 0; j < _chatShareTree.length; j++) {
      if (_chatShareTree[j].id === _chatShareDrill.subjectId) { subjRef = _chatShareTree[j]; break; }
    }
    if (subjRef && _chatShareDrill.chapterId) {
      for (var k = 0; k < subjRef.chapters.length; k++) {
        if (subjRef.chapters[k].id === _chatShareDrill.chapterId) { chName = subjRef.chapters[k].name; break; }
      }
    }

    if (level === 'chapter') {
      html += ' <span style="color:var(--text-muted);">›</span> <span style="color:var(--color-primary);">选择章节</span>';
    } else if (chName && (level === 'quizset' || level === 'question')) {
      html += ' <span style="color:var(--text-muted);">›</span> <span style="color:var(--text-secondary);">📖 ' + escapeHtml(chName) + '</span>';

      var qsName = '';
      if (subjRef && _chatShareDrill.quizSetIdx !== null && _chatShareDrill.quizSetIdx !== undefined) {
        for (var m = 0; m < subjRef.chapters.length; m++) {
          if (subjRef.chapters[m].id === _chatShareDrill.chapterId) {
            var ch = subjRef.chapters[m];
            if (ch.quizSets[_chatShareDrill.quizSetIdx]) qsName = ch.quizSets[_chatShareDrill.quizSetIdx].name;
            break;
          }
        }
      }

      if (level === 'quizset') {
        html += ' <span style="color:var(--text-muted);">›</span> <span style="color:var(--color-primary);">选择轮次</span>';
      } else if (qsName) {
        html += ' <span style="color:var(--text-muted);">›</span> <span style="color:var(--text-secondary);">📝 ' + escapeHtml(qsName) + '</span>';
        html += ' <span style="color:var(--text-muted);">›</span> <span style="color:var(--color-primary);">选择题目</span>';
      }
    }
  }

  el.innerHTML = html;
}

function chatSelectSingleQuiz(index) {
  var item = _chatShareFlat[index];
  if (!item) return;

  // Check for duplicates
  for (var i = 0; i < _chatQuizCart.length; i++) {
    if (_chatQuizCart[i].flatIdx === index) {
      if (typeof showToast === 'function') showToast('该题已在分享车中');
      return;
    }
  }

  _chatQuizCart.push({ question: item.question, path: item.path, flatIdx: index, qIndex: item.qIndex });

  if (typeof showToast === 'function') showToast('已加入分享车 (' + _chatQuizCart.length + '题)');
  _chatRenderCart();

  // Keep picker open for more selections
  // Close only via the × button or clicking outside
}


// =============================================================================
//  Quiz Cart — batch question sharing (v3.9.5)
// =============================================================================

function _chatRenderCart() {
  var cartEl = document.getElementById('chat-quiz-cart');
  if (!cartEl) return;
  if (_chatQuizCart.length === 0) {
    cartEl.style.display = 'none';
    return;
  }
  cartEl.style.display = 'block';
  var itemsHtml = '';
  var typeIcon = { single: '📋', judge: '⚖️', term: '📖', short: '✍️' };
  _chatQuizCart.forEach(function(item, i) {
    var q = item.question;
    var icon = typeIcon[q.type] || '📝';
    itemsHtml += '<div class="chat-cart-item">' +
      '<span class="chat-cart-item-icon">' + icon + '</span>' +
      '<span class="chat-cart-item-text">' + escapeHtml((q.question || '').substring(0, 30)) + '</span>' +
      '<button class="chat-cart-item-remove" onclick="_chatRemoveCartItem(' + i + ')">×</button>' +
      '</div>';
  });
  var countEl = document.getElementById('chat-cart-count');
  var itemsEl = document.getElementById('chat-cart-items');
  if (countEl) countEl.textContent = _chatQuizCart.length;
  if (itemsEl) itemsEl.innerHTML = itemsHtml;
}

function _chatRemoveCartItem(index) {
  _chatQuizCart.splice(index, 1);
  _chatRenderCart();
}

function chatShareCart() {
  if (_chatQuizCart.length === 0) return;
  if (!chatOpenRoomId) {
    if (typeof showToast === 'function') showToast('请先打开一个对话');
    return;
  }

  // Send each question as a separate quiz_share message
  var sendPromises = [];
  _chatQuizCart.forEach(function(item) {
    var quizData = {
      questions: [item.question],
      setName: (item.question.question || '').substring(0, 30),
      chapterName: '',
      fromUserName: authUser.displayName || authUser.username,
      fromUserId: authUser.id
    };
    sendPromises.push(
      fetchWithAuth('/chat/rooms/' + chatOpenRoomId + '/messages', {
        method: 'POST',
        body: JSON.stringify({
          content: '',
          msg_type: 'quiz_share',
          quiz_data: quizData
        })
      })
    );
  });

  Promise.all(sendPromises).then(function() {
    _chatQuizCart = [];
    _chatRenderCart();
    chatLoadMessages(chatOpenRoomId, false);
    chatLoadRooms();
  }).catch(function(err) {
    if (typeof showToast === 'function') showToast('分享失败: ' + (err.message || '请重试'));
  });
}

function _chatClearCart() {
  _chatQuizCart = [];
  _chatRenderCart();
}


function chatCloseShareQuiz() {
  var d = document.getElementById('chat-share-quiz-dialog');
  if (d) d.classList.remove('active');
}

function chatRemovePendingQuiz() {
  chatPendingQuiz = null;
  var filePreview = document.getElementById('chat-file-preview');
  if (filePreview) { filePreview.innerHTML = ''; filePreview.style.display = 'none'; }
}

//  Share from Report (called from quiz-report.js)
// =============================================================================

function chatShareCurrentQuizSet() {
  var as = getActiveSet();
  if (!as || !as.questions || as.questions.length === 0) {
    if (typeof showToast === 'function') showToast('暂无题目可分享');
    return;
  }

  // Need to be in a chat with a friend first
  if (chatFriendsCache.length === 0) {
    if (typeof showToast === 'function') showToast('请先添加好友，然后在聊天中分享');
    return;
  }

  chatPendingQuiz = {
    questions: as.questions,
    setName: as.setName || '题目分享',
    chapterName: '',
    fromUserName: authUser.displayName || authUser.username,
    fromUserId: authUser.id
  };

  // Open chat modal
  closeQuizModal();
  openChatModal();

  if (typeof showToast === 'function') showToast('题目已准备分享，选择好友并发送消息即可');
}

// =============================================================================
//  Polling
// =============================================================================

var _chatPollBackoff = 0;

function chatStartPolling() {
  chatStopPolling();
  chatPoll();
  _chatPollBackoff = 0;
  chatPollTimer = setInterval(chatPoll, 5000);
}

function chatStopPolling() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  _chatPollBackoff = 0;
}

async function chatPoll() {
  if (!isOnlineMode || !getToken()) return;
  try {
    var res = await fetchWithAuth('/chat/updates');
    if (res && res.status === 429) {
      // Rate limited — back off exponentially
      _chatPollBackoff = Math.min((_chatPollBackoff || 5000) * 2, 60000);
      chatStopPolling();
      chatPollTimer = setInterval(chatPoll, 5000 + _chatPollBackoff);
      console.warn('[chatPoll] 429 rate limited, backing off to ' + (5000 + _chatPollBackoff) + 'ms');
      return;
    }
    if (res && res.ok) {
      _chatPollBackoff = Math.max(0, _chatPollBackoff - 1000);
      var data = await res.json();
      chatHandlePollResult(data);
    }
  } catch(e) {
    console.error('[chatPoll] error:', e.message || e);
  }
}

function chatHandlePollResult(data) {
  // Update topbar badge
  chatUpdateBadge(data.totalUnread || 0);

  // Update requests badge
  var requestsBadge = document.getElementById('chat-requests-badge');
  if (requestsBadge) {
    if (data.pendingRequests > 0) {
      requestsBadge.style.display = 'inline';
      requestsBadge.textContent = data.pendingRequests;
    } else {
      requestsBadge.style.display = 'none';
    }
  }

  // Refresh current room if updated
  var updatedRoomIds = data.updatedRoomIds || [];
  var updatedSet = {};
  updatedRoomIds.forEach(function(id) { updatedSet[id] = true; });
  if (chatOpenRoomId && updatedSet[chatOpenRoomId]) {
    // Always refresh — isPollingRefresh=true preserves scroll position and doesn't touch input
    chatLoadMessages(chatOpenRoomId, true);
  }

  // Refresh room list
  if (updatedRoomIds.length > 0 && document.getElementById('chat-modal').classList.contains('active')) {
    chatLoadRooms();
  }
}

function chatUpdateBadge(count) {
  var badge = document.getElementById('chat-badge');
  if (!badge) return;
  if (count > 0) {
    badge.style.display = 'flex';
    badge.textContent = count > 99 ? '99+' : count;
  } else {
    badge.style.display = 'none';
  }
}


// =============================================================================
//  Shared Quiz Inline Answering (v3.9.3)
// =============================================================================

async function chatAnswerSharedQuiz(msgId, optionIndex) {
  // Disable all option buttons
  var area = document.getElementById('quiz-answer-area-' + msgId);
  if (area) {
    var btns = area.querySelectorAll('button');
    btns.forEach(function(b) { b.disabled = true; b.style.opacity = '0.5'; });
  }

  // Get quiz data from rendered DOM (instant, no server round-trip)
  var quizEl = document.getElementById('quiz-share-' + msgId);
  if (!quizEl) return;
  var quizData = null;
  try { quizData = JSON.parse(quizEl.getAttribute('data-quiz-data')); } catch(e) { return; }
  if (!quizData || !quizData.questions) return;
  var questions = quizData.questions || [];
  var question = questions[0];
  if (!question) return;

  var chosenAnswer = '';
  var correct = false;

  try {

    if (question.type === 'single') {
      var labels = ['A', 'B', 'C', 'D', 'E', 'F'];
      chosenAnswer = labels[optionIndex] || String(optionIndex);
      // question.answer is a numeric index (0,1,2...) matching optionIndex
      var correctIdx = (question.answer !== undefined && question.answer !== null && question.answer !== '') ? Number(question.answer) : -1;
      correct = (optionIndex === correctIdx);
    } else if (question.type === 'judge') {
      // question.answer is 0 (正确) or 1 (错误) — numeric index
      chosenAnswer = optionIndex === 0 ? '正确' : '错误';
      var judgeCorrect = (question.answer !== undefined && question.answer !== null && question.answer !== '') ? Number(question.answer) : -1;
      correct = (optionIndex === judgeCorrect);
    }

    // Save result to the message's quiz_data
    var correctAnswerIdx = (question.type === 'single') ?
      ((question.answer !== undefined && question.answer !== null && question.answer !== '') ? Number(question.answer) : -1) :
      ((question.answer !== undefined && question.answer !== null && question.answer !== '') ? Number(question.answer) : -1);
    var correctAnswerText = question.options && correctAnswerIdx >= 0 ? question.options[correctAnswerIdx] :
      (question.type === 'judge' ? (correctAnswerIdx === 0 ? '正确' : '错误') : String(question.answer || ''));
    var chosenAnswerIdx = optionIndex;
    var chosenAnswerText = question.options ? question.options[optionIndex] : chosenAnswer;

    quizData._result = {
      answered: true,
      correct: correct,
      chosenAnswer: chosenAnswer,
      chosenAnswerIdx: chosenAnswerIdx,
      chosenAnswerText: chosenAnswerText,
      correctAnswerIdx: correctAnswerIdx,
      correctAnswerText: correctAnswerText,
      answeredBy: authUser.displayName || authUser.username
    };

    // Update message on server
    try {
      await fetchWithAuth('/chat/messages/' + msgId + '/update-quiz', {
        method: 'POST',
        body: JSON.stringify({ quiz_data: quizData })
      });
    } catch(e) {
      // If endpoint doesn't exist, send a system message with the result
      var labels2 = ['A','B','C','D','E','F'];
      var fallbackCorrectLabel = correctAnswerIdx >= 0 ? labels2[correctAnswerIdx] : '';
      var fallbackYourLabel = chosenAnswerIdx >= 0 ? labels2[chosenAnswerIdx] : '';
      var resultText = (correct ? '✅ 回答正确！' : '❌ 回答错误') +
        '\n作答人：' + (authUser.displayName || authUser.username) +
        '\n你的答案：' + fallbackYourLabel + '. ' + (chosenAnswerText || '') +
        '\n标准答案：' + fallbackCorrectLabel + '. ' + (correctAnswerText || '');
      await fetchWithAuth('/chat/rooms/' + chatOpenRoomId + '/messages', {
        method: 'POST',
        body: JSON.stringify({ content: resultText, msg_type: 'text' })
      });
    }

    // Refresh messages to show result for both parties
    await chatLoadMessages(chatOpenRoomId, true);
  } catch(e) {
    if (typeof showToast === 'function') showToast('提交失败: ' + e.message);
  }
}

async function chatAnswerSharedQuizText(msgId) {
  var input = document.getElementById('quiz-answer-input-' + msgId);
  if (!input) return;
  var userAnswer = input.value.trim();
  if (!userAnswer) return;

  input.disabled = true;
  var submitBtn = input.nextElementSibling;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中...'; }

  // Get quiz data from rendered DOM (instant, no server round-trip)
  try {
    var quizEl = document.getElementById('quiz-share-' + msgId);
    if (!quizEl) throw new Error('element not found');
    var quizData = JSON.parse(quizEl.getAttribute('data-quiz-data'));
    if (!quizData || !quizData.questions) throw new Error('no quiz_data');
    var question = quizData.questions[0];
    if (!question) throw new Error('no question');
  } catch(e) {
    input.disabled = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交'; }
    return;
  }

  try {

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
// =============================================================================
//  Utility Functions
// =============================================================================

function chatGetRoomName(room) {
  if (room.type === 'group') {
    return room.name || '群聊';
  }
  // Direct chat: show the other person's name
  var members = room.members || [];
  var other = members.find(function(m) { return m.id !== authUser?.id; });
  return other ? (other.display_name || other.username) : '聊天';
}

function chatFormatTime(isoStr) {
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
