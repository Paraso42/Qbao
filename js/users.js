function openAuthDialog() { document.getElementById('auth-dialog').classList.add('active'); switchAuthTab('login'); }
function closeAuthDialog() { document.getElementById('auth-dialog').classList.remove('active'); clearAuthDialogErrors(); }
function closeLoginGuide() { document.getElementById('login-guide-dialog').classList.remove('active'); }
function clearAuthDialogErrors() {
  ['auth-login-error', 'auth-reg-error'].forEach(id => { const el = document.getElementById(id); if (el) { el.style.display = 'none'; el.textContent = ''; } });
}
function switchAuthTab(tab) {
  document.getElementById('auth-tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('auth-tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('auth-tab-offline').classList.toggle('active', tab === 'offline');
  document.getElementById('auth-login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-register-form').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('auth-offline-form').style.display = tab === 'offline' ? 'block' : 'none';
  clearAuthDialogErrors();
}
function showAuthError(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.style.display = 'block'; }

async function doLogin() {
  const username = document.getElementById('auth-login-username').value.trim();
  const password = document.getElementById('auth-login-password').value;
  if (!username || !password) return showAuthError('auth-login-error', '请输入用户名和密码');
  try {
    await apiLogin(username, password);
    closeAuthDialog();
    updateAuthUI();
    await DataStoreInit();
    fbStartPolling();
    try { if (isOnlineMode && getToken()) chatStartPolling(); } catch(e) {}
    // Safety net: ensure chat polling is always running (badge needs it)
    setTimeout(function() { if (isOnlineMode && getToken() && !chatPollTimer) chatStartPolling(); }, 1000);
    setTimeout(function() { if (isOnlineMode && getToken() && !chatPollTimer) chatStartPolling(); }, 5000);
    // Silently restore quiz progress from server (cross-device, all chapters)
    await restoreQuizFromServer(true);
    renderSubjectList();
    updateSyncStatus();
  } catch(e) { showAuthError('auth-login-error', e.message); }
}

async function doRegister() {
  const username = document.getElementById('auth-reg-username').value.trim();
  const displayName = document.getElementById('auth-reg-displayname').value.trim();
  const password = document.getElementById('auth-reg-password').value;
  const password2 = document.getElementById('auth-reg-password2').value;
  if (!username || username.length < 3) return showAuthError('auth-reg-error', '用户名至少3个字符');
  if (username.length > 30) return showAuthError('auth-reg-error', '用户名不能超过30个字符');
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return showAuthError('auth-reg-error', '用户名只能包含字母、数字和下划线');
  if (displayName && displayName.length > 50) return showAuthError('auth-reg-error', '显示名称不能超过50个字符');
  if (!password || password.length < 6) return showAuthError('auth-reg-error', '密码至少6个字符');
  if (password.length > 128) return showAuthError('auth-reg-error', '密码不能超过128个字符');
  if (/[^\x00-\x7F]/.test(password) && password.length < 8) return showAuthError('auth-reg-error', '包含非ASCII字符的密码至少需要8个字符');
  if (password !== password2) return showAuthError('auth-reg-error', '两次密码不一致');
  try {
    await apiRegister(username, displayName, password);
    closeAuthDialog();
    updateAuthUI();
    await DataStoreInit();
    fbStartPolling();
    renderSubjectList();
    updateSyncStatus();
  } catch(e) {
    showAuthError('auth-reg-error', e.message);
    // Preserve form values (except passwords)
    try {
      document.getElementById('auth-reg-username').value = username;
      document.getElementById('auth-reg-displayname').value = displayName;
    } catch(pe) {}
  }
}

function enterOfflineMode() {
  isOnlineMode = false;
  closeAuthDialog();
  updateAuthUI();
  updateSyncStatus();
}

function doLogout() {
  if (!confirm('确定退出登录？数据将保留在本地。')) return;
  clearAuth();
  isOnlineMode = false;
  updateAuthUI();
  updateSyncStatus();
}

function updateAuthUI() {
  state.userRole = (authUser && authUser.role) ? authUser.role : 'user';
  const container = document.getElementById('auth-user-ui');
  if (container) {
    if (isOnlineMode && authUser) {
      container.innerHTML = '<div style="font-size:11px;color:#777;text-align:center;">👤 ' + escapeHtml(authUser.displayName || authUser.username) + '</div>';
    } else {
      container.innerHTML = '';
    }
  }
  const ta = document.getElementById('topbar-auth-area');
  if (ta) {
    if (isOnlineMode && authUser) {
      var avatarHtml = '';
  if (authUser.avatarUrl || authUser.avatar) {
    avatarHtml = '<span class="tb-icon" style="display:inline-block;width:22px;height:22px;border-radius:50%;overflow:hidden;vertical-align:middle;"><img src="' + (authUser.avatarUrl || authUser.avatar) + '" style="width:100%;height:100%;object-fit:cover;"></span>';
  } else {
    var initial = (authUser.displayName || authUser.username || '?').charAt(0).toUpperCase();
    avatarHtml = '<span class="tb-icon" style="display:inline-block;width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#4facfe,#00f2fe);color:#fff;text-align:center;line-height:22px;font-size:12px;font-weight:700;">' + initial + '</span>';
  }
  ta.innerHTML = '<button class="tb-item" id="topbar-user-btn" onclick="openUserCenterModal()">' + avatarHtml + ' ' + escapeHtml(authUser.displayName || authUser.username) + '</button>';
	  var chatBtn = document.getElementById('topbar-chat-btn'); if (chatBtn) chatBtn.style.display = 'flex';
    } else {
      ta.innerHTML = '<button class="tb-item" onclick="openAuthDialog()"><span class="tb-icon">☁️</span> 登录/注册</button>';
    }
  }
  updateSyncStatus();
}
async function init(){ try{
		document.getElementById('app').style.display='flex';
		/* 恢复登录状态 */
		if (getToken()) {
			authToken = getToken();
			authUser = getUser();
			if (authUser) {
				isOnlineMode = true;
				await DataStoreInit();
				try { chatStartPolling(); } catch(e) {}
			} else {
				clearAuth();
			}
		}
		if (!isOnlineMode) loadState();
		try{await tryAutoRestore();}catch(e){console.warn('auto restore skipped',e);}
		const sids=Object.keys(state.subjects);
		if(sids.length===0){const sid='subj_'+Date.now().toString(36);state.subjects[sid]={id:sid,name:'默认科目',chapterIds:[]};state.currentSubjectId=sid;}
		else if(!state.currentSubjectId||!state.subjects[state.currentSubjectId]) state.currentSubjectId=sids[0];
		const s=getSubj();
		if(s&&(!state.currentChapterId||!state.chapters[state.currentChapterId])) state.currentChapterId=s.chapterIds.length>0?s.chapterIds[0]:null;
		renderSubjectList();
		const saved=state.lastScreen||'start';
		// 静默恢复答题进度（不弹窗，保持"开始答题"入口可用）
		await restoreQuizFromServer(true);
		if (saved === 'quiz') {
			var as2 = getActiveSet();
			if (as2 && as2.questions && as2.questions.length > 0) {
				openQuizModal('quiz'); renderQuestion(); updateProgress();
			} else {
				showScreen('start');
			}
		} else if (saved === 'report') {
			// Don't restore report view on refresh — go to start
			showScreen('start');
		} else {
			showScreen(saved);
		}
			updateChapterProgress();
		updateQuickActions();
		loadChapterStrategyToUI();
		checkAchievements();
		applyAllFontSizes();
		applyDarkMode();
            applyAiModeUi();
		updateAiTaskStatusBar();
		if (state.aiTaskQueue && state.aiTaskQueue.some(function(t){return t.status==='pending';})) { aiTaskRunnerActive=true; aiTaskRunnerLoop(); }
		populateSRSFromHistory();
		updateSrsCard();
		updateAuthUI();
		updateSyncStatus();
		// Check for files nearing expiry and notify
		if (isOnlineMode && getToken()) {
			checkExpiredFilesOnLogin();
		}
		if (!getToken()) { try{ document.getElementById('login-guide-dialog').classList.add('active'); }catch(e){} }
			loadNotices();
		document.addEventListener('click', function(e){ const tt=document.getElementById('ai-mode-tooltip'); if(tt && tt.style.display!=='none' && !tt.contains(e.target) && e.target.id!=='ai-global-toggle') closeAiModeTooltip(); });
		console.log('✅ v2.0 初始化完成');
	}catch(e){console.error('init failed',e);document.getElementById('app').style.display='flex';} }
var edgeBubbleDebounce = null;
function edgeBubbleHover(isHovered) {
  if (edgeBubbleDebounce) { clearTimeout(edgeBubbleDebounce); edgeBubbleDebounce = null; }
  var bubble = document.getElementById('edge-bubble');
  var card = document.getElementById('edge-bubble-card');
  var trigger = document.getElementById('edge-bubble-trigger');
  if (isHovered) {
    if (!card.classList.contains('edge-bubble-card--visible')) {
      fbRenderBubbleCard();
    }
    bubble.classList.add('edge-bubble--expanded');
    card.classList.add('edge-bubble-card--visible');
  } else {
    edgeBubbleDebounce = setTimeout(function() {
      if (fbBubbleCardKeepOpen) return;
      bubble.classList.remove('edge-bubble--expanded');
      card.classList.remove('edge-bubble-card--visible');
    }, 200);
  }
}

// Check for expired/near-expiry files on login, notify user
async function checkExpiredFilesOnLogin() {
  try {
    var res = await fetchWithAuth('/files?pool=true');
    if (!res || !res.ok) return;
    var data = await res.json();
    var files = data.files || [];
    if (files.length === 0) return;
    // Check for files expiring within 24 hours
    var expiringSoon = files.filter(function(f) {
      if (!f.poolExpiresAt) return false;
      var remaining = new Date(f.poolExpiresAt).getTime() - Date.now();
      return remaining > 0 && remaining < 24 * 3600 * 1000;
    });
    if (expiringSoon.length > 0) {
      var msg = expiringSoon.length === 1
        ? '文件池中有 1 个文件将在 24 小时内过期'
        : '文件池中有 ' + expiringSoon.length + ' 个文件将在 24 小时内过期';
      // Use a non-intrusive notice — show in the notice bar area if possible
      console.log('[FileExpiry] ' + msg);
      // Show subtle notification via a temporary banner
      var banner = document.createElement('div');
      banner.className = 'file-expiry-banner';
      banner.textContent = msg + ' — 点击查看';
      banner.onclick = function() { banner.remove(); openUserCenterModal('files'); };
      document.body.appendChild(banner);
      setTimeout(function() { if (banner.parentNode) banner.remove(); }, 8000);
    }
  } catch(e) { /* silent */ }
}

// ===== 用户中心弹窗 =====
function openUserCenterModal(initialTab) {
  if (!authUser) { openAuthDialog(); return; }
  var activeTab = initialTab || 'account';
  // 填充用户信息
  var name = authUser.displayName || authUser.username;
  document.getElementById('ucm-name').textContent = name;
  document.getElementById('ucm-username').textContent = '@' + (authUser.username || '');
  var avatarEl = document.getElementById('ucm-avatar');
  if (authUser.avatar) {
    avatarEl.innerHTML = '<img src="' + authUser.avatar + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
  } else {
    avatarEl.innerHTML = '';
    avatarEl.textContent = name.charAt(0).toUpperCase();
  }
  // 显示/隐藏管理员导航
  var adminNav = document.getElementById('ucm-admin-nav');
  if (adminNav) adminNav.style.display = (authUser.role === 'admin') ? 'flex' : 'none';
  // 显示弹窗
  document.getElementById('user-center-modal').classList.add('active');
  switchUcModalTab(activeTab);
}

function closeUserCenterModal() {
  document.getElementById('user-center-modal').classList.remove('active');
}

function switchUcModalTab(tab) {
  document.querySelectorAll('.ucm-nav-item[data-uc-tab]').forEach(function(el) {
    el.classList.toggle('active', el.dataset.ucTab === tab);
  });
  document.querySelectorAll('.ucm-tab-content').forEach(function(el) {
    el.classList.remove('active');
  });
  var target = document.getElementById('ucm-tab-' + tab);
  if (target) target.classList.add('active');
  // 渲染对应内容
  if (tab === 'account') renderAccountPage();
  else if (tab === 'data') renderDataPage();
  else if (tab === 'files') renderFilesPage();
  else if (tab === 'achievements') renderAchievements();
  else if (tab === 'admin') renderAdminPage();
}
async function renderAccountPage() {
  var body = document.getElementById('ucm-tab-account');
  if (!body) return;
  var html = '';
  // Avatar section
  html += '<div class="account-manage-section">';
  html += '<h4>&#128247; 头像</h4>';
  html += '<div class="avatar-upload-area">';
  html += '<div class="avatar-preview" id="acc-avatar-preview">';
  if (authUser.avatar) {
    html += '<img src="' + authUser.avatar + '" alt="" style="width:100%;height:100%;object-fit:cover;">';
  } else {
    html += '<span style="font-size:24px;color:var(--text-muted);line-height:60px;">' + (authUser.displayName || authUser.username).charAt(0).toUpperCase() + '</span>';
  }
  html += '</div>';
  html += '<div class="avatar-actions">';
  html += '<button class="btn btn-primary btn-small" onclick="uploadAvatar()">上传头像</button>';
  html += '<button class="btn btn-secondary btn-small" onclick="removeAvatar()">移除头像</button>';
  html += '<input type="file" id="avatar-file-input" accept="image/*" style="display:none;" onchange="handleAvatarUpload(event)">';
  html += '</div></div></div>';
  // Display name section
  html += '<div class="account-manage-section">';
  html += '<h4>&#9998;&#65039; 显示名称</h4>';
  html += '<div class="account-field">';
  html += '<input type="text" id="acc-display-name" value="' + escapeHtml(authUser.displayName || '') + '" placeholder="输入显示名称">';
  html += '</div></div>';
  // Password section
  html += '<div class="account-manage-section">';
  html += '<h4>&#128274; 修改密码</h4>';
  html += '<div class="account-field" style="margin-bottom:8px;">';
  html += '<input type="password" id="acc-old-password" placeholder="当前密码">';
  html += '</div>';
  html += '<div class="account-field" style="margin-bottom:8px;">';
  html += '<input type="password" id="acc-new-password" placeholder="新密码（至少6位）">';
  html += '</div>';
  html += '<div class="account-field">';
  html += '<input type="password" id="acc-new-password2" placeholder="确认新密码">';
  html += '</div></div>';
  // Storage points
  html += '<div class="account-manage-section">';
  html += '<h4>&#128230; 存储积分</h4>';
  html += '<div style="display:flex;align-items:center;gap:12px;">';
  html += '<span style="font-size:28px;font-weight:700;color:var(--color-primary);">' + (authUser.storagePoints || 0) + '</span>';
  html += '<span style="font-size:13px;color:var(--text-secondary);">积分可用于延长文件池存储时间（10积分/7天）</span>';
  html += '</div></div>';
  // Save
  html += '<div id="acc-msg" style="font-size:13px;margin-bottom:10px;min-height:20px;"></div>';
  html += '<button class="btn btn-primary" style="width:100%;" onclick="saveAccountChanges()">&#128190; 保存更改</button>';
  body.innerHTML = html;
}

async function uploadAvatar() {
  document.getElementById('avatar-file-input').click();
}

function handleAvatarUpload(e) {
  var file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showAccMsg('请选择图片文件', false); return; }
  if (file.size > 2 * 1024 * 1024) { showAccMsg('图片不能超过 2MB', false); return; }
  var imgUrl = URL.createObjectURL(file);
  initAvatarCrop(imgUrl);
  e.target.value = '';
}

// ===== Avatar Crop Editor =====
var _avatarCropState = null;

function initAvatarCrop(imgSrc) {
  // Remove existing overlay if any
  var old = document.getElementById('avatar-crop-overlay');
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = 'avatar-crop-overlay';
  overlay.className = 'avatar-crop-overlay';
  overlay.innerHTML =
    '<div class="avatar-crop-dialog">' +
    '<div class="avatar-crop-header">' +
    '<h4>裁剪头像</h4>' +
    '<button class="avatar-crop-close-btn" id="avatar-crop-close">&times;</button>' +
    '</div>' +
    '<div class="avatar-crop-body">' +
    '<div class="avatar-crop-viewport" id="avatar-crop-viewport">' +
    '<img id="avatar-crop-img" draggable="false">' +
    '<div class="avatar-crop-mask"></div>' +
    '</div>' +
    '</div>' +
    '<div class="avatar-crop-controls">' +
    '<span>缩放</span>' +
    '<input type="range" id="avatar-crop-zoom" min="80" max="300" value="100" oninput="updateAvatarCropZoom()">' +
    '<span id="avatar-crop-zoom-val">100%</span>' +
    '</div>' +
    '<div class="avatar-crop-actions">' +
    '<button class="btn btn-secondary" id="avatar-crop-cancel">取消</button>' +
    '<button class="btn btn-primary" id="avatar-crop-confirm">确认</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  _avatarCropState = {
    imgSrc: imgSrc,
    zoom: 100,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    origOffsetX: 0,
    origOffsetY: 0
  };

  document.getElementById('avatar-crop-close').onclick = cancelAvatarCrop;
  document.getElementById('avatar-crop-cancel').onclick = cancelAvatarCrop;
  document.getElementById('avatar-crop-confirm').onclick = confirmAvatarCrop;

  var img = document.getElementById('avatar-crop-img');
  img.onload = function() {
    // Center the image initially
    var vp = document.getElementById('avatar-crop-viewport');
    var vpSize = vp.clientWidth;
    var naturalW = img.naturalWidth;
    var naturalH = img.naturalHeight;
    // Fit image so both dimensions cover viewport (cover)
    var scale = Math.max(vpSize / naturalW, vpSize / naturalH);
    var displayW = naturalW * scale;
    var displayH = naturalH * scale;
    img.style.width = displayW + 'px';
    img.style.height = displayH + 'px';
    _avatarCropState.baseScale = scale;
    _avatarCropState.offsetX = (vpSize - displayW) / 2;
    _avatarCropState.offsetY = (vpSize - displayH) / 2;
    img.style.transform = 'translate(' + _avatarCropState.offsetX + 'px,' + _avatarCropState.offsetY + 'px) scale(1)';
  };
  img.src = imgSrc;

  // Drag event bindings
  var vp = document.getElementById('avatar-crop-viewport');
  img.addEventListener('mousedown', function(e) {
    e.preventDefault();
    _avatarCropState.dragging = true;
    _avatarCropState.dragStartX = e.clientX;
    _avatarCropState.dragStartY = e.clientY;
    _avatarCropState.origOffsetX = _avatarCropState.offsetX;
    _avatarCropState.origOffsetY = _avatarCropState.offsetY;
  });
  document.addEventListener('mousemove', function(e) {
    if (!_avatarCropState || !_avatarCropState.dragging) return;
    var dx = e.clientX - _avatarCropState.dragStartX;
    var dy = e.clientY - _avatarCropState.dragStartY;
    _avatarCropState.offsetX = _avatarCropState.origOffsetX + dx;
    _avatarCropState.offsetY = _avatarCropState.origOffsetY + dy;
    applyAvatarCropTransform();
  });
  document.addEventListener('mouseup', function() {
    if (_avatarCropState) _avatarCropState.dragging = false;
  });
  // Touch events
  img.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      _avatarCropState.dragging = true;
      _avatarCropState.dragStartX = e.touches[0].clientX;
      _avatarCropState.dragStartY = e.touches[0].clientY;
      _avatarCropState.origOffsetX = _avatarCropState.offsetX;
      _avatarCropState.origOffsetY = _avatarCropState.offsetY;
    }
  }, { passive: false });
  document.addEventListener('touchmove', function(e) {
    if (!_avatarCropState || !_avatarCropState.dragging) return;
    e.preventDefault();
    var dx = e.touches[0].clientX - _avatarCropState.dragStartX;
    var dy = e.touches[0].clientY - _avatarCropState.dragStartY;
    _avatarCropState.offsetX = _avatarCropState.origOffsetX + dx;
    _avatarCropState.offsetY = _avatarCropState.origOffsetY + dy;
    applyAvatarCropTransform();
  }, { passive: false });
  document.addEventListener('touchend', function() {
    if (_avatarCropState) _avatarCropState.dragging = false;
  });
}

function clampAvatarCropOffset() {
  if (!_avatarCropState) return;
  var vp = document.getElementById('avatar-crop-viewport');
  var img = document.getElementById('avatar-crop-img');
  if (!vp || !img) return;
  var vpSize = vp.clientWidth;
  var s = _avatarCropState.zoom / 100;
  var displayW = img.clientWidth * s;
  var displayH = img.clientHeight * s;
  // Keep viewport center within the image bounds
  var halfVp = vpSize / 2;
  _avatarCropState.offsetX = Math.min(halfVp, Math.max(halfVp - displayW, _avatarCropState.offsetX));
  _avatarCropState.offsetY = Math.min(halfVp, Math.max(halfVp - displayH, _avatarCropState.offsetY));
}

function applyAvatarCropTransform() {
  var img = document.getElementById('avatar-crop-img');
  if (!img || !_avatarCropState) return;
  clampAvatarCropOffset();
  var s = _avatarCropState.zoom / 100;
  img.style.transform = 'translate(' + _avatarCropState.offsetX + 'px,' + _avatarCropState.offsetY + 'px) scale(' + s + ')';
}

function updateAvatarCropZoom() {
  var slider = document.getElementById('avatar-crop-zoom');
  var val = document.getElementById('avatar-crop-zoom-val');
  if (!slider || !_avatarCropState) return;
  _avatarCropState.zoom = parseInt(slider.value);
  if (val) val.textContent = _avatarCropState.zoom + '%';
  applyAvatarCropTransform();
}

function cancelAvatarCrop() {
  var overlay = document.getElementById('avatar-crop-overlay');
  if (overlay) overlay.remove();
  if (_avatarCropState && _avatarCropState.imgSrc) {
    URL.revokeObjectURL(_avatarCropState.imgSrc);
  }
  _avatarCropState = null;
}

function confirmAvatarCrop() {
  if (!_avatarCropState) return;

  var img = document.getElementById('avatar-crop-img');
  var vp = document.getElementById('avatar-crop-viewport');
  if (!img || !vp) return;

  var vpSize = vp.clientWidth;
  var outputSize = 200;
  var canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  var ctx = canvas.getContext('2d');

  // Calculate source region: the circular area in viewport maps to image natural coords
  var s = _avatarCropState.zoom / 100;
  var displayW = img.clientWidth * s;
  var displayH = img.clientHeight * s;
  var naturalW = img.naturalWidth;
  var naturalH = img.naturalHeight;

  // Image center in viewport
  var imgCenterX = _avatarCropState.offsetX + displayW / 2;
  var imgCenterY = _avatarCropState.offsetY + displayH / 2;
  var vpCenter = vpSize / 2;

  // Source rect in natural image space (viewport square → natural square)
  var srcX = (vpCenter - imgCenterX) / displayW * naturalW;
  var srcY = (vpCenter - imgCenterY) / displayH * naturalH;
  var srcSize = vpSize / displayW * naturalW;

  ctx.save();
  // Clip to circle
  ctx.beginPath();
  ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  // Draw the source region (square → square, no distortion)
  ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, outputSize, outputSize);
  ctx.restore();

  var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  authUser.avatar = dataUrl;
  setUser(authUser);
  updateAuthUI();
  var preview = document.getElementById('acc-avatar-preview');
  if (preview) preview.innerHTML = '<img src="' + dataUrl + '" style="width:100%;height:100%;object-fit:cover;">';
  showAccMsg('头像已更新（本地），保存后同步到云端', true);

  cancelAvatarCrop();
}

function removeAvatar() {
  if (authUser) {
    authUser.avatar = null;
    setUser(authUser);
    updateAuthUI();
    document.getElementById('acc-avatar-preview').innerHTML = '<span style="font-size:24px;color:#999;">' + (authUser.displayName || authUser.username).charAt(0).toUpperCase() + '</span>';
    showAccMsg('头像已移除', true);
  }
}

async function saveAccountChanges() {
  var displayName = document.getElementById('acc-display-name').value.trim();
  var oldPw = document.getElementById('acc-old-password').value;
  var newPw = document.getElementById('acc-new-password').value;
  var newPw2 = document.getElementById('acc-new-password2').value;
  if (!displayName) { showAccMsg('显示名称不能为空', false); return; }
  if (oldPw || newPw || newPw2) {
    if (!oldPw) { showAccMsg('修改密码需输入当前密码', false); return; }
    if (newPw.length < 6) { showAccMsg('新密码至少6位', false); return; }
    if (newPw !== newPw2) { showAccMsg('两次输入的新密码不一致', false); return; }
  }
  try {
    // Save avatar fields before server response replaces authUser
    var savedAvatar = authUser.avatar;
    var savedAvatarUrl = authUser.avatarUrl;

    // Upload avatar if changed (data URL from canvas compression)
    if (savedAvatar && savedAvatar.startsWith('data:')) {
      var avRes = await fetchWithAuth('/users/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar: savedAvatar }) });
      if (avRes && avRes.ok) {
        var avJson = await avRes.json().catch(function() { return {}; });
        if (avJson.user) {
          savedAvatarUrl = avJson.user.avatarUrl;
        }
      }
    }
    var res = await fetchWithAuth('/users/me', { method: 'PUT', body: JSON.stringify({ displayName: displayName, password: oldPw || undefined, newPassword: newPw || undefined }) });
    if (!res) { showAccMsg('请求失败，请检查网络', false); return; }
    var json = await res.json().catch(function() { return {}; });
    if (!res.ok) { showAccMsg(json.error || '保存失败', false); return; }
    if (json.user) {
      authUser = json.user;
      // Restore avatar fields that server response may not include
      if (savedAvatarUrl) authUser.avatarUrl = savedAvatarUrl;
      if (savedAvatar && savedAvatar.startsWith('data:')) authUser.avatar = savedAvatar;
      if (!authUser.avatarUrl && savedAvatar) authUser.avatarUrl = savedAvatar;
      setUser(authUser);
      updateAuthUI();
      // Refresh account page UI in-place instead of reopening modal
      renderAccountPage();
      // Update modal header
      var name = authUser.displayName || authUser.username;
      var nameEl = document.getElementById('ucm-name');
      if (nameEl) nameEl.textContent = name;
      var avatarEl = document.getElementById('ucm-avatar');
      if (avatarEl) {
        if (authUser.avatarUrl || authUser.avatar) {
          avatarEl.innerHTML = '<img src="' + (authUser.avatarUrl || authUser.avatar) + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
        } else {
          avatarEl.innerHTML = '';
          avatarEl.textContent = name.charAt(0).toUpperCase();
        }
      }
    }
    showAccMsg('保存成功', true);
    document.getElementById('acc-old-password').value = '';
    document.getElementById('acc-new-password').value = '';
    document.getElementById('acc-new-password2').value = '';
  } catch (err) {
    showAccMsg(err.message, false);
  }
}

function showAccMsg(msg, success) {
  var el = document.getElementById('acc-msg');
  if (!el) return;
  el.textContent = msg;
  el.style.color = success ? '#2ed573' : '#e94560';
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 3000);
}

// ===== 文件管理页面 =====
function formatDuration(ms) {
  if (ms <= 0) return '已过期';
  var d = Math.floor(ms / 86400000);
  if (d > 0) return d + ' 天';
  var h = Math.floor((ms % 86400000) / 3600000);
  if (h > 0) return h + ' 小时';
  var m = Math.floor((ms % 3600000) / 60000);
  return m + ' 分钟';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getFileIcon(mimeType) {
  if (/pdf/.test(mimeType)) return '📄';
  if (/word|doc/.test(mimeType)) return '📝';
  if (/presentation|ppt/.test(mimeType)) return '📊';
  if (/image/.test(mimeType)) return '🖼️';
  if (/text|markdown/.test(mimeType)) return '📃';
  return '📎';
}

async function renderFilesPage() {
  var body = document.getElementById('ucm-tab-files');
  if (!body) return;

  body.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">加载中...</div>';

  var poolFiles = [];
  var chapterFiles = [];

  try {
    var pRes = await fetchWithAuth('/files?pool=true');
    if (pRes && pRes.ok) {
      var pData = await pRes.json();
      poolFiles = pData.files || [];
    }
    var ch = getCh();
    if (ch) {
      var cRes = await fetchWithAuth('/files?chapter_id=' + encodeURIComponent(ch.id));
      if (cRes && cRes.ok) {
        var cData = await cRes.json();
        chapterFiles = cData.files || [];
      }
    }
  } catch (e) {
    console.warn('Failed to load files:', e);
  }

  var html = '';

  // Storage points badge
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">';
  html += '<span style="font-size:13px;color:var(--text-secondary);">&#128230; 存储积分：<b style="color:var(--color-primary);">' + (authUser.storagePoints || 0) + '</b></span>';
  html += '<span style="font-size:11px;color:var(--text-muted);">续期消耗 10 积分/7天（功能预留）</span>';
  html += '</div>';

  // File pool section
  html += '<div class="account-manage-section">';
  html += '<h4>&#128193; 文件池</h4>';
  html += '<p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">上传资料到文件池，可分配给不同章节使用。默认保存 7 天。</p>';
  html += '<div class="drop-zone" id="file-pool-drop-zone">';
  html += '<div class="drop-zone-icon">&#128228;</div>';
  html += '<div class="drop-zone-text">拖拽文件到此处上传</div>';
  html += '<div class="drop-zone-hint">支持批量上传，单文件 ≤20MB</div>';
  html += '</div>';
  html += '<div style="margin-top:10px;margin-bottom:12px;">';
  html += '<button class="btn btn-primary btn-small" onclick="uploadToFilePool()">&#128228; 上传文件</button>';
  html += '<input type="file" id="file-pool-input" multiple style="display:none;" onchange="handleFilePoolUpload(event)" accept=".pdf,.doc,.docx,.pptx,.txt,.md,.jpg,.jpeg,.png,.webp">';
  html += '</div>';

  if (poolFiles.length > 0) {
    html += '<div class="files-list">';
    poolFiles.forEach(function(f) {
      var expiry = f.poolExpiresAt ? new Date(f.poolExpiresAt).getTime() - Date.now() : 0;
      var expired = expiry <= 0;
      html += '<div class="file-item' + (expired ? ' expired' : '') + '">';
      html += '<span class="file-icon">' + getFileIcon(f.mimeType) + '</span>';
      html += '<div class="file-info">';
      html += '<div class="file-name" title="' + escapeHtml(f.originalName) + '">' + escapeHtml(f.originalName) + '</div>';
      html += '<div class="file-meta">' + formatFileSize(f.fileSize) + ' · <span class="file-expiry' + (expired ? ' expired-text' : '') + '">' + (expired ? '已过期' : formatDuration(expiry) + ' 后过期') + '</span></div>';
      html += '</div>';
      html += '<div class="file-actions">';
      html += '<button class="btn btn-warning btn-small" onclick="extendFileInPool(' + f.id + ')" style="font-size:11px;' + (f.pointsExtended ? 'opacity:0.5;' : '') + '" title="续期 7 天（需 10 积分，功能预留）">续期 (10积分)</button>';
      html += '<button class="btn btn-danger btn-small" onclick="deleteFileFromPool(' + f.id + ')" style="font-size:11px;">删除</button>';
      html += '</div></div>';
    });
    html += '</div>';
  } else {
    html += '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:16px;">文件池为空，上传文件开始使用</p>';
  }
  html += '</div>';

  // Chapter files section
  html += '<div class="account-manage-section">';
  html += '<h4>&#128218; 当前章节资料</h4>';
  if (ch) {
    html += '<p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">章节：' + escapeHtml(ch.name) + '</p>';
  }
  if (chapterFiles.length > 0) {
    html += '<div class="files-list">';
    chapterFiles.forEach(function(f) {
      html += '<div class="file-item">';
      html += '<span class="file-icon">' + getFileIcon(f.mimeType) + '</span>';
      html += '<div class="file-info">';
      html += '<div class="file-name" title="' + escapeHtml(f.originalName) + '">' + escapeHtml(f.originalName) + '</div>';
      html += '<div class="file-meta">' + formatFileSize(f.fileSize) + ' · ' + new Date(f.createdAt).toLocaleDateString('zh-CN') + '</div>';
      html += '</div>';
      html += '<div class="file-actions">';
      html += '<button class="btn btn-danger btn-small" onclick="removeFileFromChapter(' + f.id + ')" style="font-size:11px;">移除</button>';
      html += '</div></div>';
    });
    html += '</div>';
  } else {
    html += '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:16px;">暂无章节资料，从文件池分配或上传</p>';
  }
  html += '</div>';

  body.innerHTML = html;
  setupFilePoolDragDrop();
}

function uploadToFilePool() {
  document.getElementById('file-pool-input').click();
}

function setupFilePoolDragDrop() {
  var dropZone = document.getElementById('file-pool-drop-zone');
  if (!dropZone) return;

  ['dragenter', 'dragover'].forEach(function(evt) {
    dropZone.addEventListener(evt, function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drop-zone-active');
    });
  });
  ['dragleave', 'drop'].forEach(function(evt) {
    dropZone.addEventListener(evt, function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drop-zone-active');
    });
  });

  dropZone.addEventListener('drop', function(e) {
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    var input = document.getElementById('file-pool-input');
    var dt = new DataTransfer();
    for (var i = 0; i < files.length; i++) { dt.items.add(files[i]); }
    input.files = dt.files;
    handleFilePoolUpload({ target: input });
  });
}

async function handleFilePoolUpload(e) {
  var files = e.target.files;
  if (!files || files.length === 0) return;

  var successCount = 0;
  var failCount = 0;
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (file.size > 20 * 1024 * 1024) {
      alert(file.name + ' 超过 20MB，已跳过');
      failCount++;
      continue;
    }
    var formData = new FormData();
    formData.append('file', file);
    try {
      var res = await fetchWithAuth('/files/upload', { method: 'POST', body: formData, headers: {} });
      if (res && res.ok) { successCount++; }
      else {
        failCount++;
        var errData = null;
        try { errData = res ? await res.json() : null; } catch(_) {}
        if (errData && errData.error && typeof showToast === 'function') {
          showToast(errData.error);
        }
      }
    } catch (err) {
      failCount++;
    }
  }
  renderFilesPage();
  if (failCount > 0) {
    alert('上传完成：' + successCount + ' 个成功' + (failCount > 0 ? '，' + failCount + ' 个失败' : ''));
  }
  e.target.value = '';
}

async function assignFileToChapter(fileId) {
  var ch = getCh();
  if (!ch) { alert('请先选择章节'); return; }
  try {
    var res = await fetchWithAuth('/files/' + fileId + '/assign', {
      method: 'POST',
      body: JSON.stringify({ chapterId: ch.id })
    });
    if (!res || !res.ok) {
      var err = await (res ? res.json().catch(function() { return {}; }) : {});
      alert('分配失败: ' + (err.error || '网络错误'));
      return;
    }
    // Sync chapterMaterials so AI generation can use this file
    var fileData = await res.json().catch(function() { return {}; });
    if (fileData && fileData.file) {
      var f = fileData.file;
      var materials = getChapterMaterials(ch.id);
      if (!materials.some(function(m) { return m._poolFile && m.id === ('pool_' + fileId); })) {
        materials.push({ name: f.originalName, size: f.fileSize, addedAt: Date.now(), id: 'pool_' + fileId, _poolFile: true });
        saveChapterMaterials(ch.id, materials);
      }
      ch._hasNewFilesSinceLastGen = true;
      saveState();
    }
    renderFilesPage();
  } catch (err) {
    alert('分配失败: ' + err.message);
  }
}

async function deleteFileFromPool(fileId) {
  if (!confirm('确定要删除此文件吗？此操作不可恢复。')) return;
  try {
    var res = await fetchWithAuth('/files/' + fileId, { method: 'DELETE' });
    if (!res || !res.ok) {
      var err = await (res ? res.json().catch(function() { return {}; }) : {});
      alert('删除失败: ' + (err.error || '网络错误'));
      return;
    }
    renderFilesPage();
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

async function removeFileFromChapter(fileId) {
  if (!confirm('确定要从此章节移除该文件吗？文件仍会保留在文件池中。')) return;
  try {
    var res = await fetchWithAuth('/files/' + fileId + '/unassign', { method: 'POST' });
    if (!res || !res.ok) {
      var err = await (res ? res.json().catch(function() { return {}; }) : {});
      alert('移除失败: ' + (err.error || '网络错误'));
      return;
    }
    renderFilesPage();
  } catch (err) {
    alert('移除失败: ' + err.message);
  }
}

async function extendFileInPool(fileId) {
  try {
    var res = await fetchWithAuth('/files/' + fileId + '/extend', { method: 'POST' });
    if (!res || !res.ok) {
      var err = await (res ? res.json().catch(function() { return {}; }) : {});
      alert('续期失败: ' + (err.error || '网络错误'));
      return;
    }
    renderFilesPage();
  } catch (err) {
    alert('续期失败: ' + err.message);
  }
}

// ===== 数据管理页面 =====
async function renderDataPage() {
  var body = document.getElementById('ucm-tab-data');
  if (!body) return;

  var html = '<div class="account-manage-section">';
  html += '<h4>&#128190; 本地备份</h4>';
  html += '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">将答题数据导出为 JSON 文件保存到本地，需要时可上传恢复。</p>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  html += '<button class="btn btn-primary btn-small" onclick="doManualBackup()">&#128229; 下载备份</button>';
  html += '<button class="btn btn-warning btn-small" onclick="restoreFromFile()">&#128230; 上传恢复</button>';
  html += '</div>';
  html += '<p style="font-size:11px;color:var(--text-muted);margin-top:8px;">提示：建议定期下载备份文件并妥善保管。</p>';
  html += '</div>';

  html += '<div class="account-manage-section">';
  html += '<h4>&#9729;&#65039; 云同步</h4>';
  html += '<p style="font-size:13px;color:var(--text-secondary);">';
  if (isOnlineMode && authUser) {
    html += '云端同步状态：<span style="color:#2ed573;font-weight:500;">已启用</span>';
    if (syncPending) { html += '（有未同步的更改）'; }
  } else {
    html += '云端同步：<span style="color:#e94560;font-weight:500;">离线模式</span>';
  }
  html += '</p></div>';

  body.innerHTML = html;
}

// ===== 管理员专区页面 =====
async function renderAdminPage() {
  var body = document.getElementById('ucm-tab-admin');
  if (!body) return;
  if (!authUser || authUser.role !== 'admin') {
    body.innerHTML = '<p style="color:#e94560;font-size:14px;text-align:center;padding:20px;">此功能仅限管理员使用</p>';
    return;
  }

  var html = '<div class="admin-cards-grid" style="margin-bottom:20px;">';

  html += '<div class="admin-card" style="border:1px solid #e0e0e0;border-radius:10px;padding:20px;cursor:pointer;transition:.2s;text-align:center;" onmouseenter="this.style.borderColor=\'#4facfe\';this.style.boxShadow=\'0 2px 12px rgba(79,172,254,0.15)\'" onmouseleave="this.style.borderColor=\'#e0e0e0\';this.style.boxShadow=\'none\'" onclick="adminOpenSubSection(\'notices\')">';
  html += '<div style="font-size:28px;margin-bottom:8px;">&#128227;</div>';
  html += '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">消息管理</div>';
  html += '<div style="font-size:12px;color:#888;">管理顶栏滚动通知</div>';
  html += '</div>';

  html += '<div class="admin-card" style="border:1px solid #e0e0e0;border-radius:10px;padding:20px;cursor:pointer;transition:.2s;text-align:center;" onmouseenter="this.style.borderColor=\'#4facfe\';this.style.boxShadow=\'0 2px 12px rgba(79,172,254,0.15)\'" onmouseleave="this.style.borderColor=\'#e0e0e0\';this.style.boxShadow=\'none\'" onclick="adminOpenSubSection(\'users\')">';
  html += '<div style="font-size:28px;margin-bottom:8px;">&#128101;</div>';
  html += '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">用户管理</div>';
  html += '<div style="font-size:12px;color:#888;">查看、修改、封禁用户</div>';
  html += '</div>';

  html += '</div>';
  html += '<div id="ucm-admin-subsection" style="display:none;"></div>';
  body.innerHTML = html;
}

function adminOpenSubSection(section) {
  var subsection = document.getElementById('ucm-admin-subsection');
  if (!subsection) return;

  if (section === 'notices') {
    subsection.style.display = 'block';
    var html = '<div style="border:1px solid #e0e0e0;border-radius:10px;padding:18px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">';
    html += '<h4 style="font-size:15px;margin:0;">&#128227; 消息管理</h4>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-primary btn-small" onclick="closeUcAndOpenNoticeEditor()" style="font-size:12px;padding:4px 10px;">＋ 新增消息</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="loadAdminNoticesInUc()" style="font-size:12px;padding:4px 10px;">&#128260; 刷新</button>';
    html += '</div></div>';
    html += '<div id="ucm-notice-list-container" style="font-size:13px;"></div>';
    html += '</div>';
    subsection.innerHTML = html;
    loadAdminNoticesInUc();
  } else if (section === 'users') {
    subsection.style.display = 'block';
    var html = '<div style="border:1px solid #e0e0e0;border-radius:10px;padding:18px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">';
    html += '<h4 style="font-size:15px;margin:0;">&#128101; 用户管理</h4>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="loadAdminUsers()" style="font-size:12px;padding:4px 10px;">&#128260; 刷新</button>';
    html += '</div></div>';
    html += '<div id="ucm-user-search" style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">';
    html += '<input type="text" id="ucm-user-search-input" placeholder="搜索用户名..." style="flex:1;padding:6px 10px;border:1px solid #dee2e6;border-radius:6px;font-size:13px;" onkeydown="if(event.key===\'Enter\')loadAdminUsers()">';
    html += '<button class="btn btn-primary btn-small" onclick="loadAdminUsers()" style="font-size:12px;padding:4px 10px;">搜索</button>';
    html += '</div>';
    html += '<div id="ucm-user-stats-bar" style="display:flex;gap:12px;margin-bottom:12px;font-size:12px;color:#888;padding:8px 12px;background:#f8f9fa;border-radius:6px;"></div>';
    html += '<div id="ucm-user-list-container" style="font-size:13px;"></div>';
    html += '</div>';
    subsection.innerHTML = html;
    loadAdminUsers();
  }
}

function renderAdminUserList(users) {
  var container = document.getElementById('ucm-user-list-container');
  if (!container) return;
  if (users.length === 0) { container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无用户</div>'; return; }
  var html = '';
  users.forEach(function(u) {
    var avatarHtml = '';
    if (u.avatarUrl) {
      avatarHtml = '<img src="' + u.avatarUrl + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">';
    } else {
      avatarHtml = '<span style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#4facfe,#00f2fe);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:600;">' + (u.displayName || u.username).charAt(0).toUpperCase() + '</span>';
    }
    var onlineDot = u.isOnline ? '<span style="width:8px;height:8px;border-radius:50%;background:#2ed573;display:inline-block;"></span>' : '<span style="width:8px;height:8px;border-radius:50%;background:#ccc;display:inline-block;"></span>';
    var roleBadge = u.role === 'admin' ? '<span style="background:#fff3cd;color:#856404;padding:1px 6px;border-radius:8px;font-size:11px;">管理员</span>' : '<span style="background:#e8f4fd;color:#4facfe;padding:1px 6px;border-radius:8px;font-size:11px;">普通</span>';
    var banBadge = u.isBanned ? '<span style="background:#ffe6e6;color:#e94560;padding:1px 6px;border-radius:8px;font-size:11px;">已封禁</span>' : '';
    html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #eee;border-radius:8px;margin-bottom:6px;transition:.2s;cursor:pointer;" onclick="adminViewUser(' + u.id + ')" onmouseenter="this.style.borderColor=\'#4facfe\';this.style.background=\'#f8fbff\'" onmouseleave="this.style.borderColor=\'#eee\';this.style.background=\'#fff\'">';
    html += '<div style="position:relative;flex-shrink:0;">';
    html += avatarHtml;
    html += '<span style="position:absolute;bottom:-1px;right:-1px;" title="' + (u.isOnline ? '在线' : '离线') + '">' + onlineDot + '</span>';
    html += '</div>';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(u.displayName || u.username) + ' <span style="color:#999;font-weight:normal;font-size:12px;">@' + escapeHtml(u.username) + '</span></div>';
    html += '<div style="display:flex;gap:6px;align-items:center;margin-top:3px;">';
    html += roleBadge;
    html += banBadge;
    html += '<span style="font-size:11px;color:#999;">' + (u.lastLoginAt ? '最后登录: ' + new Date(u.lastLoginAt).toLocaleString('zh-CN') : '从未登录') + '</span>';
    html += '</div></div>';
    var banText = u.isBanned ? '解封' : '封禁';
    var banColor = u.isBanned ? 'background:#e6ffe6;color:#2ed573;border-color:#2ed573;' : 'background:#ffe6e6;color:#e94560;border-color:#e94560;';
    html += '<button onclick="event.stopPropagation();adminToggleBan(' + u.id + ',\'' + u.username + '\',' + u.isBanned + ')" style="padding:4px 10px;border:1px solid;'+ banColor + 'border-radius:6px;font-size:11px;cursor:pointer;flex-shrink:0;">' + banText + '</button>';
    html += '</div>';
  });
  container.innerHTML = html;
}

async function adminViewUser(uid) {
  try {
    var res = await fetchWithAuth('/users/' + uid);
    if (!res.ok) return;
    var u = await res.json();
    var stats = u.stats || {};
    var avatarHtml = '';
    if (u.avatarUrl) {
      avatarHtml = '<img src="' + u.avatarUrl + '" style="width:56px;height:56px;border-radius:50%;object-fit:cover;">';
    } else {
      avatarHtml = '<span style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#4facfe,#00f2fe);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:600;">' + (u.displayName || u.username).charAt(0).toUpperCase() + '</span>';
    }
    var onlineDot = u.isOnline ? '<span style="width:10px;height:10px;border-radius:50%;background:#2ed573;display:inline-block;"></span>' : '<span style="width:10px;height:10px;border-radius:50%;background:#ccc;display:inline-block;"></span>';
    var roleBadge = u.role === 'admin' ? '<span style="background:#fff3cd;color:#856404;padding:2px 10px;border-radius:10px;font-size:12px;">管理员</span>' : '<span style="background:#e8f4fd;color:#4facfe;padding:2px 10px;border-radius:10px;font-size:12px;">普通用户</span>';
    var banBadge = u.isBanned ? '<span style="background:#ffe6e6;color:#e94560;padding:2px 10px;border-radius:10px;font-size:12px;">已封禁</span>' : '<span style="background:#e6ffe6;color:#2ed573;padding:2px 10px;border-radius:10px;font-size:12px;">正常</span>';
    var d = '<div style="background:#fff;border-radius:14px;padding:28px;width:92%;max-width:480px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.12);">';
    d += '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">';
    d += '<div style="position:relative;">' + avatarHtml;
    d += '<span style="position:absolute;bottom:0;right:0;">' + onlineDot + '</span></div>';
    d += '<div style="flex:1;"><div style="font-size:18px;font-weight:700;">' + escapeHtml(u.displayName || u.username) + '</div>';
    d += '<div style="font-size:13px;color:#999;margin-top:2px;">@' + escapeHtml(u.username) + '</div></div>';
    d += '<div style="display:flex;gap:6px;">' + roleBadge + banBadge + '</div></div>';
    d += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:18px;" class="admin-stat-grid">';
    d += '<div style="text-align:center;padding:12px;background:#f8f9fa;border-radius:8px;"><div style="font-size:22px;font-weight:700;color:#4facfe;">' + stats.subjects + '</div><div style="font-size:11px;color:#888;margin-top:2px;">科目</div></div>';
    d += '<div style="text-align:center;padding:12px;background:#f8f9fa;border-radius:8px;"><div style="font-size:22px;font-weight:700;color:#4facfe;">' + stats.chapters + '</div><div style="font-size:11px;color:#888;margin-top:2px;">章节</div></div>';
    d += '<div style="text-align:center;padding:12px;background:#f8f9fa;border-radius:8px;"><div style="font-size:22px;font-weight:700;color:#4facfe;">' + stats.totalQuestions + '</div><div style="font-size:11px;color:#888;margin-top:2px;">题目</div></div>';
    d += '</div>';
    d += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:18px;" class="admin-stat-grid">';
    d += '<div style="text-align:center;padding:10px;background:#f8f9fa;border-radius:8px;"><div style="font-size:16px;font-weight:600;">' + stats.totalBackups + '</div><div style="font-size:10px;color:#888;">备份</div></div>';
    d += '<div style="text-align:center;padding:10px;background:#f8f9fa;border-radius:8px;"><div style="font-size:16px;font-weight:600;">' + stats.totalShares + '</div><div style="font-size:10px;color:#888;">分享</div></div>';
    d += '<div style="text-align:center;padding:10px;background:#f8f9fa;border-radius:8px;"><div style="font-size:16px;font-weight:600;">' + stats.totalAiRequests + '</div><div style="font-size:10px;color:#888;">AI出题</div></div>';
    d += '</div>';
    d += '<div style="font-size:12px;color:#999;padding:10px 0;border-top:1px solid #eee;margin-top:4px;">';
    d += '<div>创建时间: ' + new Date(u.createdAt).toLocaleString('zh-CN') + '</div>';
    if (u.lastLoginAt) d += '<div style="margin-top:3px;">最后登录: ' + new Date(u.lastLoginAt).toLocaleString('zh-CN') + '</div>';
    d += '</div>';
    d += '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #eee;">';
    d += '<div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#555;">修改密码</div>';
    d += '<div style="display:flex;gap:6px;">';
    d += '<input type="text" id="adm-pw-input-' + uid + '" placeholder="新密码 (至少6位)" style="flex:1;padding:6px 10px;border:1px solid #dee2e6;border-radius:6px;font-size:13px;">';
    d += '<button onclick="adminResetPassword(' + uid + ')" style="padding:6px 14px;background:#4facfe;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">设置</button>';
    d += '</div></div>';
    d += '<div style="display:flex;justify-content:flex-end;margin-top:18px;">';
    d += '<button onclick="this.closest(\'.dialog-overlay\').remove()" style="padding:8px 20px;background:#6c757d;color:#fff;border:none;border-radius:7px;font-size:13px;cursor:pointer;">关闭</button>';
    d += '</div></div>';
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay active';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:2000;';
    overlay.innerHTML = d;
    if (overlay.onclick === null) overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  } catch(e) { alert('加载失败'); }
}

async function adminResetPassword(uid) {
  var input = document.getElementById('adm-pw-input-' + uid);
  var pw = input ? input.value : '';
  if (!pw || pw.length < 6) { alert('密码至少6位'); return; }
  if (!confirm('确定要为用户 #' + uid + ' 重置密码吗？')) return;
  try {
    var res = await fetchWithAuth('/users/' + uid, { method: 'PUT', body: JSON.stringify({ password: pw }) });
    if (!res.ok) { var err = await res.json(); alert(err.error || '操作失败'); return; }
    alert('密码已重置');
    input.value = '';
  } catch(e) { alert('操作失败'); }
}

async function adminToggleBan(uid, username, currentlyBanned) {
  var action = currentlyBanned ? '解封' : '封禁';
  if (!confirm('确定要' + action + '用户 ' + username + ' 吗？')) return;
  try {
    var res = await fetchWithAuth('/users/' + uid + '/ban', { method: 'PATCH', body: JSON.stringify({ banned: !currentlyBanned }) });
    if (!res.ok) { var err = await res.json(); alert(err.error || '操作失败'); return; }
    var data = await res.json();
    alert(data.message);
    loadAdminUsers();
  } catch(e) { alert('操作失败'); }
}
async function loadAdminUsers() {
  if (!getToken()) return;
  var container = document.getElementById('ucm-user-list-container');
  var statsBar = document.getElementById('ucm-user-stats-bar');
  var searchInput = document.getElementById('ucm-user-search-input');
  if (container) container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">加载中...</div>';
  try {
    var url = '/users?limit=100';
    if (searchInput && searchInput.value.trim()) url += '&search=' + encodeURIComponent(searchInput.value.trim());
    var res = await fetchWithAuth(url);
    if (!res.ok) return;
    var data = await res.json();
    // 同时加载统计
    try {
      var sr = await fetchWithAuth('/users/stats');
      if (sr && sr.ok && statsBar) {
        var st = await sr.json();
        statsBar.innerHTML = '<span>共 <b>' + st.totalUsers + '</b> 人</span><span>在线 <b style="color:#2ed573;">' + st.onlineNow + '</b></span><span>管理员 <b>' + st.adminCount + '</b></span><span>封禁 <b style="color:#e94560;">' + st.bannedCount + '</b></span><span>今日登录 <b>' + st.todayLogins + '</b></span>';
      }
    } catch(e) {}
    renderAdminUserList(data.users || []);
  } catch(e) {
    if (container) container.innerHTML = '<div style="text-align:center;color:#e94560;padding:20px;">加载失败</div>';
  }
}

function closeUcAndOpenNoticeEditor() {
  ucClose();
  openNoticeEditor();
}

async function loadAdminNoticesInUc() {
  if (!getToken()) return;
  var container = document.getElementById('ucm-notice-list-container');
  if (container) container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">加载中...</div>';
  try {
    var res = await fetchWithAuth('/notices/all');
    if (!res.ok) return;
    var data = await res.json();
    renderNoticeListInUc(data);
  } catch(e) {
    if (container) container.innerHTML = '<div style="text-align:center;color:#e94560;padding:20px;">加载失败: ' + escapeHtml(e.message) + '</div>';
  }
}

function renderNoticeListInUc(notices) {
  var container = document.getElementById('ucm-notice-list-container');
  if (!container) return;
  if (!notices || notices.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无消息</div>';
    return;
  }
  var html = '<div style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">';
  html += '<div style="display:flex;align-items:center;padding:8px 12px;background:#f8f9fa;font-size:11px;color:#888;border-bottom:1px solid #e0e0e0;"><span style="flex:2;">内容</span><span style="width:70px;">类型</span><span style="width:50px;text-align:center;">时长</span><span style="width:60px;text-align:center;">状态</span><span style="width:100px;">过期时间</span><span style="width:120px;text-align:right;">操作</span></div>';
  notices.forEach(function(n) {
    var t = noticeTypeMap[n.type] || noticeTypeMap.notice;
    var expireStr = n.expire_at ? new Date(n.expire_at).toLocaleDateString('zh-CN') : '永久';
    var durStr = n.duration ? (n.duration / 1000) + 's' : '4s';
    html += '<div data-id="' + n.id + '" style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #f0f0f0;';
    if (!n.enabled) html += 'background:#fafafa;opacity:0.6;';
    html += '">';
    html += '<span style="flex:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(n.content) + '">' + escapeHtml(n.content) + '</span>';
    html += '<span style="width:70px;color:' + t.color + ';">' + t.icon + ' ' + n.type + '</span>';
    html += '<span style="width:50px;text-align:center;font-size:11px;color:#888;">' + durStr + '</span>';
    html += '<span style="width:60px;text-align:center;">';
    if (n.enabled) {
      html += '<label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;"><input type="checkbox" checked onchange="toggleNotice(' + n.id + ');loadAdminNoticesInUc();" style="accent-color:#2ed573;"> 启用</label>';
    } else {
      html += '<label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;"><input type="checkbox" onchange="toggleNotice(' + n.id + ');loadAdminNoticesInUc();" style="accent-color:#999;"> 启用</label>';
    }
    html += '</span>';
    html += '<span style="width:100px;font-size:11px;color:#888;">' + expireStr + '</span>';
    html += '<span style="width:120px;text-align:right;display:flex;gap:4px;justify-content:flex-end;">';
    html += '<button onclick="editNoticeInUc(' + n.id + ')" style="font-size:11px;padding:2px 8px;cursor:pointer;border:1px solid #ddd;background:#fff;border-radius:4px;">编辑</button>';
    html += '<button onclick="deleteNoticeInUc(' + n.id + ')" style="font-size:11px;padding:2px 8px;cursor:pointer;border:1px solid #e94560;color:#e94560;background:#fff;border-radius:4px;">删除</button>';
    html += '</span></div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function editNoticeInUc(id) {
  ucClose();
  openNoticeEditor(id);
}

function deleteNoticeInUc(id) {
  if (!confirm('确定删除此消息？')) return;
  deleteNotice(id).then(function() { loadAdminNoticesInUc(); });
}
