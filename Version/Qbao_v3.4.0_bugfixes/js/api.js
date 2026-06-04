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

async function apiLogin(username, password) {
  const res = await fetch(API_BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '登录失败'); }
  const data = await res.json();
  authToken = data.token; authUser = data.user; isOnlineMode = true;
  setToken(data.token); setUser(data.user);
  return data;
}

async function apiRegister(username, displayName, password) {
  const res = await fetch(API_BASE + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName: displayName || username, password })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '注册失败'); }
  const data = await res.json();
  authToken = data.token; authUser = data.user; isOnlineMode = true;
  setToken(data.token); setUser(data.user);
  return data;
}
