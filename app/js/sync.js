// ============================================================
// sync.js — 双形态同步层（v3.25）
// 职责：带 rev 乐观锁的全量同步、409 冲突合并、失败可见化与自动重试。
// 依赖：api.js（fetchWithAuth/getToken/getUser/isOnlineMode）、
//       state.js（state/migrateState/updateSyncStatus/STORAGE_KEY/CLOUD_STORAGE_PREFIX）
// 加载顺序：index.html 中位于 state.js 之后。
// ============================================================
var _syncRev = null;          // 当前云端版本号（GET /data 或 PUT 响应后更新）
var _syncInFlight = false;
var _syncTimer = null;
var _syncRetryTimer = null;
var SYNC_PENDING_KEY = 'qbao_sync_pending';

function getSyncPending() {
  try { return localStorage.getItem(SYNC_PENDING_KEY) === '1'; } catch(e) { return false; }
}
function setSyncPending(v) {
  try { if (v) localStorage.setItem(SYNC_PENDING_KEY, '1'); else localStorage.removeItem(SYNC_PENDING_KEY); } catch(e) {}
}

// 由 saveState() 调用：防抖 2s 后推送全量状态
function scheduleSync() {
  if (!isOnlineMode || !getToken()) return;
  setSyncPending(true);
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(function() { flushSync(); }, 2000);
}

async function flushSync() {
  if (_syncInFlight || !isOnlineMode || !getToken()) return;
  _syncInFlight = true;
  try {
      if (typeof stripAiSecretsFromState === 'function') stripAiSecretsFromState(state);
    var body = { state_json: state };
    if (_syncRev) body.rev = _syncRev;
    var res = await fetchWithAuth('/data', { method: 'PUT', body: JSON.stringify(body) });
    if (!res) { setSyncPending(false); return; } // 401 → 已登出，降级纯本地
    if (res.ok) {
      var data = await res.json().catch(function() { return {}; });
      if (typeof data.rev === 'number') _syncRev = data.rev;
      setSyncPending(false);
      localStorage.setItem('qbao_lastSync', new Date().toISOString());
      updateSyncStatus();
    } else if (res.status === 409) {
      // 冲突：云端有本端不知道的更新 → 拉取云端并合并后重试
      console.warn('[sync] 409 conflict, merging with cloud');
      var cur = await fetchWithAuth('/data');
      if (cur && cur.ok) {
        var cloud = await cur.json().catch(function() { return null; });
        if (cloud && cloud.state_json) {
          var merged = mergeStates(state, migrateState(cloud.state_json));
          state = merged;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          var user = getUser();
          if (user && user.id) localStorage.setItem(CLOUD_STORAGE_PREFIX + user.id, JSON.stringify(state));
          if (typeof cloud.rev === 'number') _syncRev = cloud.rev;
          if (typeof showToast === 'function') showToast('检测到其他设备的数据，已自动合并');
        }
        // 仅在拿到有效 rev 时重试，避免退化为无锁覆盖云端数据
        if (typeof _syncRev === 'number' && _syncRev > 0) {
            if (typeof stripAiSecretsFromState === 'function') stripAiSecretsFromState(state);
          var body2 = { state_json: state, rev: _syncRev };
          var res2 = await fetchWithAuth('/data', { method: 'PUT', body: JSON.stringify(body2) });
          if (res2 && res2.ok) {
            var d2 = await res2.json().catch(function() { return {}; });
            if (typeof d2.rev === 'number') _syncRev = d2.rev;
            setSyncPending(false);
            localStorage.setItem('qbao_lastSync', new Date().toISOString());
            updateSyncStatus();
            return;
          }
        }
      }
      setSyncPending(true);
      scheduleSyncRetry();
    } else {
      console.error('[sync] PUT /data failed:', res.status);
      setSyncPending(true);
      scheduleSyncRetry();
    }
  } catch(e) {
    console.error('[sync] error:', e && e.message, e);
    setSyncPending(true);
    scheduleSyncRetry();
  } finally {
    _syncInFlight = false;
  }
}

function scheduleSyncRetry() {
  if (_syncRetryTimer) clearTimeout(_syncRetryTimer);
  _syncRetryTimer = setTimeout(function() { flushSync(); }, 30000);
  if (typeof updateSyncStatus === 'function') updateSyncStatus();
}

// 登录/恢复后回放未同步数据（离线作答 → 联网自动同步）
function resumePendingSync() {
  if (getSyncPending() && isOnlineMode && getToken()) flushSync();
}

// 合并策略（v1）：实体级并集，同 id 本地优先，云端独有实体保留——任何一侧数据都不丢。
// 未来升级：按实体 updatedAt 精确裁决（见 docs/ARCHITECTURE.md §5-3）。
function mergeStates(localState, cloudState) {
  var m = JSON.parse(JSON.stringify(cloudState || {}));
  var L = localState || {};
  // UI 标量状态：本地优先
  ['currentSubjectId', 'currentChapterId', 'currentExamId', 'lastScreen', 'darkMode',
   'aiConfig', 'settings', 'userSettings', 'notices'].forEach(function(k) {
    if (typeof L[k] !== 'undefined' && L[k] !== null) m[k] = L[k];
  });
  // 字典实体：并集，同 id 本地优先
  ['subjects', 'chapters', 'generatedExams', 'srsData'].forEach(function(k) {
    var c = m[k] || {};
    var l = L[k] || {};
    Object.keys(l).forEach(function(id) { c[id] = l[id]; });
    m[k] = c;
  });
  // 数组实体（history）：按 id 去重合并，本地新条目追加
  if (Array.isArray(L.history) && Array.isArray(m.history)) {
    var have = {};
    m.history.forEach(function(h) { if (h && h.id) have[h.id] = true; });
    L.history.forEach(function(h) { if (h && h.id && !have[h.id]) m.history.push(h); });
  } else if (Array.isArray(L.history)) {
    m.history = L.history;
  }
  return m;
}
