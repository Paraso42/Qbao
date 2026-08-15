function getToken() { return localStorage.getItem('qbao_token'); }
function setToken(t) { if (t) localStorage.setItem('qbao_token', t); else localStorage.removeItem('qbao_token'); }
function getUser() { try { return JSON.parse(localStorage.getItem('qbao_user') || 'null'); } catch { return null; } }
function setUser(u) { if (u) localStorage.setItem('qbao_user', JSON.stringify(u)); else localStorage.removeItem('qbao_user'); }

async function fetchWithAuth(path, options = {}) {
  var isFormData = options.body instanceof FormData;
  var headers = isFormData ? {} : { 'Content-Type': 'application/json' };
  if (options.headers) Object.assign(headers, options.headers);
  if (getToken()) headers['Authorization'] = 'Bearer ' + getToken();
  var fetchOpts = { method: options.method, headers: headers };
  if (options.body) fetchOpts.body = options.body;
  if (options.signal) fetchOpts.signal = options.signal;
  const res = await fetch(API_BASE + path, fetchOpts);
  if (res.status === 401) { clearAuth(); return null; }
  return res;
}

function clearAuth() { authToken = null; authUser = null; isOnlineMode = false; setToken(null); setUser(null); }

// 桌面端首次运行：未配置服务器时引导输入地址（存入应用用户设置，主进程重建窗口生效）
function showServerSetupDialog() {
  if (typeof showInlinePrompt !== 'function') return;
  showInlinePrompt('设置服务器地址', 'http://', function(url) {
    url = String(url || '').trim();
    if (!/^https?:\/\//.test(url)) { if (typeof showToast === 'function') showToast('请输入完整地址，如 http://114.55.210.82'); return; }
    if (window.__qbaoDesktop && window.__qbaoDesktop.setServer) {
      window.__qbaoDesktop.setServer(url, '服务器').then(function(r) {
        if (r && r.ok !== false) return;
        if (typeof showToast === 'function') showToast('保存失败: ' + ((r && r.error) || '未知错误'));
      }).catch(function(e) { if (typeof showToast === 'function') showToast('保存失败: ' + e.message); });
    }
  });
}

function netErrorMessage() {
  var tip = (typeof IS_DESKTOP !== 'undefined' && IS_DESKTOP)
    ? '无法连接服务器 (' + API_BASE + ') — 请检查网络连接或 VPN'
    : '无法连接服务器 (' + API_BASE + ') — 请检查网络';
  return tip;
}

async function apiLogin(username, password) {
  var res;
  try {
    res = await fetch(API_BASE + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
  } catch(e) { throw new Error(netErrorMessage()); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '登录失败'); }
  const data = await res.json();
  authToken = data.token; authUser = data.user; isOnlineMode = true;
  setToken(data.token); setUser(data.user);
  return data;
}

async function apiRegister(username, displayName, password) {
  var res;
  try {
    res = await fetch(API_BASE + '/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName: displayName || username, password })
    });
  } catch(e) { throw new Error(netErrorMessage()); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '注册失败'); }
  const data = await res.json();
  authToken = data.token; authUser = data.user; isOnlineMode = true;
  setToken(data.token); setUser(data.user);
  return data;
}
