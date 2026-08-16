
function setupSettingsAutoSave() {
  var st = document.getElementById('ai-stream-threshold');
  if (st && !st._autoSaveBound) { st._autoSaveBound = true; st.addEventListener('change', function() {
    if (!state.aiConfig) state.aiConfig = {};
    state.aiConfig.streamThreshold = parseInt(st.value) || 3;
    saveState();
  }); }
}


function renderSettings() { const quizFs=state.settings?state.settings.quizFontSize:17; const sidebarFs=state.settings?state.settings.sidebarFontSize:13; const topbarFs=state.settings?state.settings.topbarFontSize:14; const mainFs=state.settings?state.settings.mainFontSize:17; const s1=document.getElementById('settings-quiz-font-size');const v1=document.getElementById('settings-quiz-font-size-val');if(s1)s1.value=quizFs;if(v1)v1.textContent=quizFs+'px';const s2=document.getElementById('settings-sidebar-font-size');const v2=document.getElementById('settings-sidebar-font-size-val');if(s2)s2.value=sidebarFs;if(v2)v2.textContent=sidebarFs+'px';const s4=document.getElementById('settings-topbar-font-size');const v4=document.getElementById('settings-topbar-font-size-val');if(s4)s4.value=topbarFs;if(v4)v4.textContent=topbarFs+'px';const s3=document.getElementById('settings-main-font-size');const v3=document.getElementById('settings-main-font-size-val');if(s3)s3.value=mainFs;if(v3)v3.textContent=mainFs+'px';const dm=document.getElementById('settings-dark-mode');if(dm)dm.checked=state.settings?state.settings.darkMode:false;const nb=document.getElementById('settings-notice-bar');if(nb)nb.checked=state.settings?state.settings.showNoticeBar!==false:true;applyAllFontSizes(); refreshDataMgmtTab(); loadAiConfig(); var btn=document.getElementById('tab-btn-notices'); if(btn)btn.style.display=state.userRole==='admin'?'block':'none'; }
function onSettingsQuizFontSize() { const fs=parseInt(document.getElementById('settings-quiz-font-size').value)||17; state.settings.quizFontSize=fs; document.getElementById('settings-quiz-font-size-val').textContent=fs+'px'; saveState(); applyAllFontSizes(); var preview=document.getElementById('preview-quiz'); if(preview)preview.style.fontSize=fs+'px'; }
function onSettingsSidebarFontSize() { const fs=parseInt(document.getElementById('settings-sidebar-font-size').value)||13; state.settings.sidebarFontSize=fs; document.getElementById('settings-sidebar-font-size-val').textContent=fs+'px'; saveState(); applyAllFontSizes(); var preview=document.getElementById('preview-sidebar'); if(preview)preview.style.fontSize=fs+'px'; }
function onSettingsTopbarFontSize() { const fs=parseInt(document.getElementById('settings-topbar-font-size').value)||14; state.settings.topbarFontSize=fs; document.getElementById('settings-topbar-font-size-val').textContent=fs+'px'; saveState(); applyAllFontSizes(); var preview=document.getElementById('preview-topbar'); if(preview)preview.style.fontSize=fs+'px'; }
function onSettingsMainFontSize() { const fs=parseInt(document.getElementById('settings-main-font-size').value)||17; state.settings.mainFontSize=fs; document.getElementById('settings-main-font-size-val').textContent=fs+'px'; saveState(); applyAllFontSizes(); var preview=document.getElementById('preview-main'); if(preview)preview.style.fontSize=fs+'px'; }
function applyQuizFontSize() { const fs=state.settings?state.settings.quizFontSize:17; document.querySelectorAll('.quiz-question').forEach(el=>el.style.fontSize=fs+'px'); document.querySelectorAll('.quiz-option').forEach(el=>el.style.fontSize=(fs-2)+'px'); }
function applyAllFontSizes() { applyQuizFontSize(); const sidebarFs=state.settings?state.settings.sidebarFontSize:13; const topbarFs=state.settings?state.settings.topbarFontSize:14; const mainFs=state.settings?state.settings.mainFontSize:17; document.documentElement.style.setProperty('--sidebar-font-size',sidebarFs+'px'); document.documentElement.style.setProperty('--topbar-font-size',topbarFs+'px'); document.documentElement.style.setProperty('--main-font-size',mainFs+'px'); const sb=document.getElementById('sidebar'); if(sb) sb.style.fontSize=sidebarFs+'px'; const tb=document.getElementById('topbar'); if(tb) tb.style.fontSize=topbarFs+'px'; const mn=document.getElementById('main'); if(mn) mn.style.fontSize=mainFs+'px'; }
function onSettingsDarkMode() { state.settings.darkMode=document.getElementById('settings-dark-mode').checked; saveState(); applyDarkMode(); }
function applyDarkMode() { const enabled=state.settings&&state.settings.darkMode; document.body.classList.toggle('dark-mode', enabled); const cb=document.getElementById('settings-dark-mode'); if(cb)cb.checked=enabled; }
function onSettingsNoticeBar() { state.settings.showNoticeBar=document.getElementById('settings-notice-bar').checked; saveState(); toggleNoticeBar(); }
function toggleNoticeBar() { var show=state.settings?state.settings.showNoticeBar!==false:true; var wrap=document.getElementById('notice-bar-wrap'); if(wrap)wrap.style.display=show?'flex':'none'; var cb=document.getElementById('settings-notice-bar'); if(cb)cb.checked=show; }
function switchSettingsTab(tab) {
  // Update sidebar nav items
  document.querySelectorAll('#settings-modal .ucm-nav-item').forEach(function(t){
    t.classList.toggle('active', t.dataset.settingsTab === tab);
  });
  // Update tab content
  document.querySelectorAll('#settings-modal .ucm-tab-content').forEach(function(t){
    t.classList.remove('active');
  });
  var el = document.getElementById('settings-tab-' + tab);
  if (el) el.classList.add('active');
  if (tab === 'aiconfig') loadAiConfig();
  else if (tab === 'desktop') renderDesktopSettings();
}

/* ===== 桌面端设置（仅 Electron 打包/开发模式；网页版自动隐藏） ===== */
var desktopInfo = { version: '', apiBase: '', serverLabel: '', autoStart: false, loaded: false };
var desktopUpdate = { state: 'idle', message: '', percent: 0 };

function initDesktopSettings() {
  if (typeof IS_DESKTOP === 'undefined' || !IS_DESKTOP) return;
  if (!(window.__qbaoDesktop && window.__qbaoDesktop.getAppInfo)) return;
  var nav = document.getElementById('settings-desktop-nav');
  if (nav) nav.style.display = 'flex';
  // 订阅主进程推送的更新状态（检查/下载进度/完成/错误）
  window.__qbaoDesktop.onUpdateStatus(function(s) {
    if (!s) return;
    desktopUpdate.state = s.state || 'idle';
    desktopUpdate.message = s.message || '';
    desktopUpdate.percent = s.percent || 0;
    renderDesktopUpdateStatus();
  });
}

function renderDesktopSettings() {
  var body = document.getElementById('settings-tab-desktop');
  if (!body) return;
  var d = window.__qbaoDesktop;
  if (!d || !d.getAppInfo) { body.innerHTML = ''; return; }
  body.innerHTML = [
    '<div class="card">',
    '  <div class="settings-section">',
    '    <h4>🖥️ 应用信息</h4>',
    '    <div class="settings-row"><label>当前版本</label><span id="desktop-version" style="color:var(--text-secondary);">加载中...</span></div>',
    '    <div class="settings-row"><label>服务器地址</label><span id="desktop-apibase" style="color:var(--text-secondary);word-break:break-all;">...</span></div>',
    '    <div class="settings-row"><label>开机自启</label><label style="min-width:auto;cursor:pointer;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="desktop-auto-start" onchange="desktopToggleAutoStart(this.checked)"> 登录系统时启动 Qbao</label></div>',
    '    <div class="settings-row"><label>服务器设置</label><button class="btn btn-secondary btn-small" onclick="showServerSetupDialog()">修改服务器地址</button></div>',
    '  </div>',
    '  <div class="settings-section">',
    '    <h4>🔄 软件更新</h4>',
    '    <div id="desktop-update-status" style="font-size:13px;color:#888;margin-bottom:10px;">...</div>',
    '    <div style="display:flex;gap:8px;"><button class="btn btn-primary btn-small" id="desktop-check-update-btn" onclick="desktopCheckUpdates()">检查更新</button></div>',
    '  </div>',
    '</div>'
  ].join('\n');
  if (desktopInfo.loaded) fillDesktopInfo();
  else {
    d.getAppInfo().then(function(info) {
      desktopInfo = Object.assign({}, info || {}, { loaded: true });
      fillDesktopInfo();
    }).catch(function() {});
  }
  renderDesktopUpdateStatus();
}

function fillDesktopInfo() {
  var v = document.getElementById('desktop-version');
  if (v) v.textContent = 'v' + (desktopInfo.version || '?');
  var a = document.getElementById('desktop-apibase');
  if (a) a.textContent = desktopInfo.apiBase || '未配置';
  var c = document.getElementById('desktop-auto-start');
  if (c) c.checked = !!desktopInfo.autoStart;
}

function renderDesktopUpdateStatus() {
  var el = document.getElementById('desktop-update-status');
  if (!el) return;
  if (desktopUpdate.state === 'progress') el.innerHTML = '⬇️ 正在下载更新 ' + desktopUpdate.percent + '%';
  else if (desktopUpdate.state === 'downloaded') el.innerHTML = '✅ 更新已下载完成，重启应用即可安装';
  else if (desktopUpdate.state === 'error') el.innerHTML = '❌ ' + escapeHtml(desktopUpdate.message || '检查失败');
  else el.innerHTML = '启动应用后会自动检查更新；有新版本时会提示下载。';
}

function desktopCheckUpdates() {
  var btn = document.getElementById('desktop-check-update-btn');
  var el = document.getElementById('desktop-update-status');
  if (el) el.innerHTML = '⏳ 正在检查更新...';
  if (btn) btn.disabled = true;
  var d = window.__qbaoDesktop;
  if (!d || !d.checkForUpdates) {
    if (el) el.innerHTML = '❌ 当前环境不支持自动更新';
    if (btn) btn.disabled = false;
    return;
  }
  d.checkForUpdates().then(function(r) {
    if (btn) btn.disabled = false;
    if (!r) return;
    if (r.error) { if (el) el.innerHTML = '❌ ' + escapeHtml(r.error); return; }
    if (!r.hasUpdate && el) el.innerHTML = '✅ 已是最新版本';
    // hasUpdate → 主进程弹窗询问下载；进度经 onUpdateStatus 推送到本页
  }).catch(function(e) {
    if (btn) btn.disabled = false;
    if (el) el.innerHTML = '❌ ' + escapeHtml((e && e.message) || '检查失败');
  });
}

function desktopToggleAutoStart(checked) {
  var d = window.__qbaoDesktop;
  if (!d || !d.setAutoStart) return;
  d.setAutoStart(!!checked).then(function(r) {
    if (r && r.ok !== false) {
      desktopInfo.autoStart = !!r.autoStart;
      if (typeof showToast === 'function') showToast(r.autoStart ? '已开启开机自启' : '已关闭开机自启');
    } else if (typeof showToast === 'function') {
      showToast('设置失败: ' + ((r && r.error) || '未知错误'));
    }
  }).catch(function() {});
}
function refreshDataMgmtTab() { const cs=document.getElementById('cloud-sync-status'); if(cs){ if(isOnlineMode&&getToken()){ const last=localStorage.getItem('qbao_lastSync'); cs.innerHTML=last?'✅ 云端已同步 '+new Date(last).toLocaleString('zh-CN'):'☁️ 已登录，修改将自动同步'; cs.style.color='#2ed573'; }else{ cs.innerHTML='🔴 离线模式 — 数据仅保存在本地'; cs.style.color='#888'; } } const bs=document.getElementById('backup-current-status'); if(bs){ if(backupDirHandle){ bs.innerHTML='✅ 备份文件夹: <strong>'+backupDirHandle.name+'</strong> ('+(backupMeta?backupMeta.length:0)+' 份备份)'; bs.style.color='#2ed573'; }else{ bs.innerHTML='📂 尚未设置备份文件夹'; bs.style.color='#888'; } } }
function loadAiConfig() {
  const ac = state.aiConfig || {};
  const provider = ac.provider || 'ecnu';
  const model = ac.model || 'ecnu-plus';

  // Fetch providers from backend (or use cached)
  fetchProviders().then(function() {
    populateProviderSelect();
    var provSel = document.getElementById('ai-provider-select');
    if (provSel) provSel.value = provider;
    onAiProviderChange();  // populate model list for current provider
    var modelSel = document.getElementById('ai-model-select');
    if (modelSel && model) modelSel.value = model;
    updateAiBaseUrl();
  });

  // Key input: show saved key hint but keep input empty
  var keyInput = document.getElementById('ai-api-key');
  if (keyInput) {
    keyInput.value = '';
    var savedKey = getAiApiKey(provider);
    if (savedKey) {
      keyInput.placeholder = '已保存 (长度 ' + savedKey.length + ' 字符)';
    } else {
      keyInput.placeholder = '粘贴你的 API Key';
    }
  }

  var envPrompt = document.getElementById('ai-environment-prompt');
  if (envPrompt) envPrompt.value = ac.systemPrompt || '';
  updateEnvPromptCharCount();

  var status = document.getElementById('ai-config-status');
  if (status) status.textContent = getAiApiKey(provider) ? '✅ 已配置 AI API' : '⚠️ 尚未配置 API 密钥';

  var intervalInput = document.getElementById('ai-task-interval');
  if (intervalInput) {
    intervalInput.value = ac.taskInterval || 30;
    var valEl = document.getElementById('ai-task-interval-val');
    if (valEl) valEl.textContent = (ac.taskInterval || 30) + 's';
  }

  // streamMode defaults to true for all providers; backend handles response_format by provider
  if (ac.streamMode === undefined) ac.streamMode = true;
  var st = document.getElementById('ai-stream-threshold');
  if (st) st.value = ac.streamThreshold || 3;
    var selfCheckInput = document.getElementById('ai-self-check');
    if (selfCheckInput) selfCheckInput.checked = ac.selfCheck === true;
    var serverQueueInput = document.getElementById('ai-server-queue');
    if (serverQueueInput) serverQueueInput.checked = ac.useServerQueue === true;
}

async function fetchProviders() {
  if (aiProviders.length > 0) return aiProviders;
  try {
    var res = await fetch(API_BASE + '/ai/providers');
    if (res.ok) {
      var data = await res.json();
      if (data.providers && data.providers.length > 0) {
        aiProviders = data.providers;
      }
    }
  } catch (e) {
    console.warn('Failed to fetch AI providers:', e);
  }
  // Fallback defaults if fetch fails
  if (aiProviders.length === 0) {
    aiProviders = [
      { id: 'ecnu', name: 'ECNU (华师大)', models: [{ id: 'ecnu-plus', name: 'ecnu-plus' }, { id: 'ecnu-turbo', name: 'ecnu-turbo' }, { id: 'ecnu-max', name: 'ecnu-max' }] },
      { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }] },
      { id: 'openai', name: 'OpenAI ChatGPT', models: [{ id: 'gpt-4o', name: 'gpt-4o' }, { id: 'gpt-4o-mini', name: 'gpt-4o-mini' }, { id: 'gpt-4.1', name: 'gpt-4.1' }] },
      { id: 'gemini', name: 'Google Gemini', models: [{ id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' }, { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' }] }
    ];
  }
  return aiProviders;
}

function populateProviderSelect() {
  var sel = document.getElementById('ai-provider-select');
  if (!sel) return;
  sel.innerHTML = '';
  for (var i = 0; i < aiProviders.length; i++) {
    var p = aiProviders[i];
    var opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
}

function onAiProviderChange() {
  var provSel = document.getElementById('ai-provider-select');
  var providerId = provSel ? provSel.value : 'ecnu';
  aiCurrentProvider = providerId;

  // Find provider config
  var prov = null;
  for (var i = 0; i < aiProviders.length; i++) {
    if (aiProviders[i].id === providerId) { prov = aiProviders[i]; break; }
  }

  // Update model select
  var modelSel = document.getElementById('ai-model-select');
  if (modelSel) {
    modelSel.innerHTML = '';
    if (prov && prov.models) {
      for (var j = 0; j < prov.models.length; j++) {
        var m = prov.models[j];
        var opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        modelSel.appendChild(opt);
      }
    }
  }

  // Update API key placeholder for selected provider
  var keyInput = document.getElementById('ai-api-key');
  if (keyInput) {
    var ac = state.aiConfig || {};
    var savedKey = getAiApiKey(providerId);
    if (savedKey) {
      keyInput.placeholder = '已保存 (长度 ' + savedKey.length + ' 字符)';
    } else {
      keyInput.placeholder = '粘贴 ' + (prov ? prov.name : providerId) + ' API Key';
    }
    keyInput.value = '';
  }

  updateAiBaseUrl();

  // All providers default to streaming mode; backend auto-selects response_format
  if (!state.aiConfig) state.aiConfig = {};
  state.aiConfig.streamMode = true;
}

function updateAiBaseUrl() {
  var baseUrlInput = document.getElementById('ai-base-url');
  if (!baseUrlInput) return;
  var providerId = aiCurrentProvider || 'ecnu';
  var urls = {
    ecnu: 'https://chat.ecnu.edu.cn/open/api/v1',
    deepseek: 'https://api.deepseek.com',
    openai: 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta'
  };
  baseUrlInput.value = urls[providerId] || '';
}
function updateEnvPromptCharCount() { const el=document.getElementById('ai-environment-prompt'); const countEl=document.getElementById('ai-env-prompt-char-count'); const warnEl=document.getElementById('ai-env-prompt-warning'); if(!el||!countEl)return; const len=el.value.length; countEl.textContent='当前 '+len+' 字'+(len>500?'（建议不超过500字）':''); if(warnEl)warnEl.style.display=len>500?'block':'none'; }
function saveAiConfig() {
  if (!state.aiConfig) state.aiConfig = {};

  var provSel = document.getElementById('ai-provider-select');
  var modelSel = document.getElementById('ai-model-select');
  var keyInput = document.getElementById('ai-api-key');
  var envPrompt = document.getElementById('ai-environment-prompt');
  var intervalInput = document.getElementById('ai-task-interval');

  var provider = provSel ? provSel.value : 'ecnu';
  state.aiConfig.provider = provider;
  state.aiConfig.model = modelSel ? modelSel.value : 'ecnu-plus';

  // Save API key to provider-specific slot
  // API Key 仅写入本机 KeyStore，不写入 state.aiConfig。
  if (keyInput && keyInput.value.trim()) {
    setAiApiKey(provider, keyInput.value.trim());
    state.aiConfig.apiKeySet = true;
    keyInput.value = '';
    keyInput.placeholder = '已保存 (长度 ' + getAiApiKey(provider).length + ' 字符)';
  }
  // apiKeySet 仅保留布尔标记（本机是否配置过任意 Key）。
  if (hasAnyAiApiKey()) {
    state.aiConfig.apiKeySet = true;
  }
    if (!hasAnyAiApiKey()) state.aiConfig.apiKeySet = false;

  if (envPrompt) state.aiConfig.systemPrompt = envPrompt.value.trim();

  if (intervalInput) {
    var vi = parseInt(intervalInput.value) || 30;
    if (vi < 0) vi = 0;
    if (vi > 300) vi = 300;
    state.aiConfig.taskInterval = vi;
  }

  // Streaming and response_format are auto-selected by backend based on provider
  state.aiConfig.streamMode = true;
  var st = document.getElementById('ai-stream-threshold');
  state.aiConfig.streamThreshold = st ? parseInt(st.value) || 3 : 3;
    var selfCheckInput = document.getElementById('ai-self-check');
    state.aiConfig.selfCheck = selfCheckInput ? selfCheckInput.checked === true : false;
    var serverQueueInput = document.getElementById('ai-server-queue');
    state.aiConfig.useServerQueue = serverQueueInput ? serverQueueInput.checked === true : false;

  saveState();
  var status = document.getElementById('ai-config-status');
  if (status) { status.textContent = '✅ 配置已保存'; status.style.color = '#2ed573'; }
}

async function testAiConfig() {
  var status = document.getElementById('ai-config-status');
  if (status) status.textContent = '⏳ 通过后端测试连接...';

  var ac = state.aiConfig || {};
  if (!getAiApiKey(ac.provider || 'ecnu')) {
    status.textContent = '❌ 请先保存 API 密钥';
    status.style.color = '#e94560';
    return;
  }

  var provider = ac.provider || 'ecnu';
  var model = ac.model || 'ecnu-plus';
  var apiKey = getAiApiKey(provider);
  var envPrompt = ac.systemPrompt ? ac.systemPrompt.trim() + '\n\n' : '';

  try {
    var res = await fetch(API_BASE + '/ai/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken(),
        'x-ai-api-key': apiKey,
        'x-ai-model': model,
        'x-ai-provider': provider
      },
      body: JSON.stringify({
        message: 'ping',
        typeCounts: { single: 1, judge: 0, term: 0, short: 0 },
        prompt: envPrompt + '你是一个助手。请回答一句话。'
      })
    });
    if (res.ok) {
      var d = await res.json();
      status.textContent = '✅ 连接成功 (' + provider + '/' + model + ')，耗时 ' + (d.latencyMs || '?') + 'ms';
      status.style.color = '#2ed573';
    } else {
      var err = await res.json().catch(function() { return {}; });
      status.textContent = '❌ ' + (err.error || res.status + ' ' + res.statusText);
      status.style.color = '#e94560';
    }
  } catch (e) {
    status.textContent = '❌ ' + e.message;
    status.style.color = '#e94560';
  }
}
function saveAiTaskInterval() {} // removed - no longer used; var el=document.getElementById('ai-task-interval'); if(!el)return; var v=parseInt(el.value)||30; if(v<0)v=0; if(v>300)v=300; state.aiConfig.taskInterval=v; saveState(); var valEl=document.getElementById('ai-task-interval-val'); if(valEl)valEl.textContent=v+'s'; }

function openSettingsModal() {
  initDesktopSettings();
  switchSettingsTab('personalize');
  renderSettings();
  document.getElementById('settings-modal').classList.add('active');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.remove('active');
}