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
  if (!password || password.length < 6) return showAuthError('auth-reg-error', '密码至少6个字符');
  if (password !== password2) return showAuthError('auth-reg-error', '两次密码不一致');
  try {
    await apiRegister(username, displayName, password);
    closeAuthDialog();
    updateAuthUI();
    await DataStoreInit();
    renderSubjectList();
    updateSyncStatus();
  } catch(e) { showAuthError('auth-reg-error', e.message); }
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
      ta.innerHTML = '<button class="tb-item" id="topbar-user-btn" onclick="openUserCenterModal()"><span class="tb-icon">👤</span> ' + escapeHtml(authUser.displayName || authUser.username) + '</button>';
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
		// 如果上次离开时正在答题页面，先处理未完成的题目
		if (saved === 'quiz') {
			var as = getActiveSet();
			if (as && as.userAnswers && as.userAnswers.some(function(a) { return a === undefined; })) {
				finalizeUnansweredQuestions(as);
				saveState();
				// 保存历史记录并跳转到报告页
				saveQuizHistory({ id: as.setId, questions: as.questions, userAnswers: as.userAnswers, setName: as.setName, setId: as.setId });
				updateSRSAfterExam({ setId: as.setId, questions: as.questions, userAnswers: as.userAnswers });
				if (as.setId) autoUpdateChapterWeakTags(state.chapters[as.setId]);
				autoBackup();
				checkAchievements();
				openQuizModal('report');
				renderReportForSet(as);
			} else {
				openQuizModal('quiz');
			}
		} else {
			showScreen(saved);
		}
		const ch=getCh();
		if(ch&&ch.questions&&ch.questions.length>0){renderQuestion();updateProgress();}
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
    bubble.classList.add('edge-bubble--expanded');
    card.classList.add('edge-bubble-card--visible');
  } else {
    edgeBubbleDebounce = setTimeout(function() {
      bubble.classList.remove('edge-bubble--expanded');
      card.classList.remove('edge-bubble-card--visible');
    }, 100);
  }
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
  else if (tab === 'achievements') renderAchievements();
  else if (tab === 'admin') renderAdminPage();
}
async function renderAccountPage() {
  var body = document.getElementById('ucm-tab-account');
  if (!body) return;
  var html = '';
  html += '<div style="margin-bottom:16px;"><h4 style="font-size:14px;margin-bottom:8px;">&#128247; 头像</h4>';
  html += '<div style="display:flex;align-items:center;gap:12px;">';
  html += '<div id="acc-avatar-preview" style="width:56px;height:56px;border-radius:50%;background:#e0e0e0;display:flex;align-items:center;justify-content:center;overflow:hidden;">';
  if (authUser.avatar) {
    html += '<img src="' + authUser.avatar + '" style="width:100%;height:100%;object-fit:cover;">';
  } else {
    html += '<span style="font-size:24px;color:#999;">' + (authUser.displayName || authUser.username).charAt(0).toUpperCase() + '</span>';
  }
  html += '</div><div style="display:flex;flex-direction:column;gap:6px;">';
  html += '<button class="btn btn-primary btn-small" onclick="uploadAvatar()" style="font-size:12px;padding:4px 10px;">上传头像</button>';
  html += '<button class="btn btn-secondary btn-small" onclick="removeAvatar()" style="font-size:12px;padding:4px 10px;">移除</button>';
  html += '<input type="file" id="avatar-file-input" accept="image/*" style="display:none;" onchange="handleAvatarUpload(event)">';
  html += '</div></div></div>';
  html += '<div style="margin-bottom:16px;"><h4 style="font-size:14px;margin-bottom:8px;">&#9998;&#65039; 显示名称</h4>';
  html += '<input type="text" id="acc-display-name" value="' + escapeHtml(authUser.displayName || '') + '" placeholder="输入显示名称" style="width:100%;padding:8px 10px;border:1px solid #dee2e6;border-radius:6px;font-size:14px;">';
  html += '</div>';
  html += '<div style="margin-bottom:16px;"><h4 style="font-size:14px;margin-bottom:8px;">&#128274; 修改密码</h4>';
  html += '<input type="password" id="acc-old-password" placeholder="当前密码" style="width:100%;padding:8px 10px;border:1px solid #dee2e6;border-radius:6px;font-size:14px;margin-bottom:6px;">';
  html += '<input type="password" id="acc-new-password" placeholder="新密码（至少6位）" style="width:100%;padding:8px 10px;border:1px solid #dee2e6;border-radius:6px;font-size:14px;margin-bottom:6px;">';
  html += '<input type="password" id="acc-new-password2" placeholder="确认新密码" style="width:100%;padding:8px 10px;border:1px solid #dee2e6;border-radius:6px;font-size:14px;">';
  html += '</div>';
  html += '<div id="acc-msg" style="font-size:13px;margin-bottom:8px;"></div>';
  html += '<button class="btn btn-primary btn-small" onclick="saveAccountChanges()">保存更改</button>';
  body.innerHTML = html;
}

async function uploadAvatar() {
  document.getElementById('avatar-file-input').click();
}

async function handleAvatarUpload(e) {
  var file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showAccMsg('请选择图片文件', false); return; }
  if (file.size > 2 * 1024 * 1024) { showAccMsg('图片不能超过 2MB', false); return; }
  try {
    var reader = new FileReader();
    reader.onload = async function(ev) {
      var dataUrl = ev.target.result;
      authUser.avatar = dataUrl;
      setUser(authUser);
      updateAuthUI();
      document.getElementById('acc-avatar-preview').innerHTML = '<img src="' + dataUrl + '" style="width:100%;height:100%;object-fit:cover;">';
      showAccMsg('头像已更新（本地）', true);
    };
    reader.readAsDataURL(file);
  } catch (err) {
    showAccMsg('上传失败: ' + err.message, false);
  }
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
    var res = await fetchWithAuth('/users/me', { method: 'PUT', body: JSON.stringify({ displayName: displayName, password: oldPw || undefined, newPassword: newPw || undefined }) });
    if (!res) { showAccMsg('请求失败，请检查网络', false); return; }
    var json = await res.json().catch(function() { return {}; });
    if (!res.ok) { showAccMsg(json.error || '保存失败', false); return; }
    if (json.user) {
      authUser = json.user;
      setUser(authUser);
      updateAuthUI();
      openUserCenter();
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

// ===== 数据管理页面 =====
async function renderDataPage() {
  var body = document.getElementById('ucm-tab-data');
  if (!body) return;

  var hasBackup = !!backupDirHandle;
  var backupStatusText = hasBackup ? '✅ 已设置' : '<span style="color:#e94560;">未设置</span>';
  if (hasBackup && backupMeta.length > 0) {
    backupStatusText += '（' + backupMeta.length + ' 份备份）';
  }

  var html = '<div style="margin-bottom:16px;"><h4 style="font-size:14px;margin-bottom:8px;">&#128190; 本地备份</h4>';
  html += '<p style="font-size:13px;color:#666;margin-bottom:8px;">当前备份状态：' + backupStatusText + '</p>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  html += '<button class="btn btn-primary btn-small" onclick="setupBackupFromDialog()" style="font-size:12px;padding:4px 10px;">&#128193; 设置路径</button>';
  html += '<button class="btn btn-success btn-small" onclick="doManualBackup()" style="font-size:12px;padding:4px 10px;">&#128190; 立即备份</button>';
  html += '<button class="btn btn-warning btn-small" onclick="openRestoreDialog()" style="font-size:12px;padding:4px 10px;">&#9202;&#65039; 回档</button>';
  html += '</div></div>';
  html += '<div style="margin-bottom:16px;"><h4 style="font-size:14px;margin-bottom:8px;">&#9729;&#65039; 云同步</h4>';
  html += '<p style="font-size:13px;color:#666;">';
  if (isOnlineMode && authUser) {
    html += '云端同步状态：<span style="color:#2ed573;">已启用</span>';
    if (syncPending) { html += '（有未同步的更改）'; }
  } else {
    html += '云端同步：<span style="color:#e94560;">离线模式</span>';
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
