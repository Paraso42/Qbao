'use strict';

// Qbao 桌面端自动更新 v2（v3.35 · self-hosted generic feed）
// 更新源：当前配置的服务器（/api/v1/desktop/update/<channel>），随用户配置的服务器地址切换；
//         与 GitHub 完全脱钩（GitHub 仅作发布归档）。
// 流程：启动延迟检查（可关自动检查）→ 每 6h 定时 → 发现新版提示 → 用户确认下载 → 下载进度 → 重启安装。
// 新增能力：
//   - 强制升级（required 仅 stable 渠道且由发布工具显式 promote；低于门槛弹阻断对话框）；
//   - 撤回感知（当前版本被维护者 retract → 提示打开下载页重装其他版本）；
//   - 历史版本自助回退（qbao:download-version：下载 → sha256 校验 → 唤起安装器覆盖安装，数据保留）。
const { app, dialog, ipcMain, Notification, shell, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('./updater-util');

let getWindowFn = null;
let runtime = { apiBase: '', updateChannel: 'stable' };
let feedUrl = null;
let disabled = true;
let lastCheckAt = null;
let downloading = false;

// 系统级通知（Windows 10/11 通知中心），失败仅告警不影响流程
function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body, silent: false }).show();
  } catch (e) {
    console.warn('[updater] 系统通知失败:', e.message);
  }
}

function send(status) {
  const w = getWindowFn && getWindowFn();
  if (w && !w.isDestroyed()) w.webContents.send('qbao:update-status', status);
}

function sendRollback(status) {
  const w = getWindowFn && getWindowFn();
  if (w && !w.isDestroyed()) w.webContents.send('qbao:rollback-progress', status);
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function readAutoCheck() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return s.autoCheck !== false;
  } catch (e) {
    return true;
  }
}
function writeAutoCheck(v) {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    Object.assign(s, { autoCheck: !!v });
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

function originFromApiBase(apiBase) {
  try {
    return new URL(apiBase).origin;
  } catch (e) {
    return '';
  }
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function downloadUpdateWithProgress() {
  if (downloading) return Promise.resolve({ ok: false, error: '正在下载中' });
  downloading = true;
  return new Promise((resolve) => {
    const onDone = () => { cleanup(); resolve({ ok: true }); };
    const onError = (e) => { cleanup(); resolve({ ok: false, error: e && e.message ? e.message : '下载失败' }); };
    const cleanup = () => {
      autoUpdater.removeListener('update-downloaded', onDone);
      autoUpdater.removeListener('error', onError);
      downloading = false;
    };
    autoUpdater.once('update-downloaded', onDone);
    autoUpdater.once('error', onError);
    autoUpdater.downloadUpdate().catch((e) => onError(e));
  });
}

// 检查 + 提示 + 下载（启动自动检查与手动检查共用）
async function checkAndPrompt() {
  if (disabled || !feedUrl) return { hasUpdate: false, error: '未配置更新源' };
  lastCheckAt = new Date().toISOString();
  const current = app.getVersion();

  // —— 撤回感知 + 强制升级判定（仅 stable 渠道；beta 永不强制）——
  if (runtime.updateChannel !== 'beta') {
    const mani = await fetchJson(String(runtime.apiBase).replace(/\/+$/, '') + '/desktop/manifest?channel=stable');
    if (mani && Array.isArray(mani.releases) && mani.releases.length > 0) {
      if (util.isInstalledVersionRetracted(current, mani.releases)) {
        notify('Qbao 当前版本已被撤回', '该版本存在已知问题，请重新安装其他版本');
        const w = getWindowFn && getWindowFn();
        const res = await dialog.showMessageBox(w || undefined, {
          type: 'warning',
          buttons: ['打开下载页', '知道了'],
          defaultId: 0,
          cancelId: 1,
          title: '当前版本已被撤回',
          message: '当前版本已被撤回',
          detail: '当前版本（' + current + '）存在已知问题并已被撤回。可打开下载页选择其他版本覆盖安装（不影响数据），或等待修复版发布后自动更新。',
        });
        if (res.response === 0) {
          const origin = originFromApiBase(runtime.apiBase);
          if (origin) shell.openExternal(origin + '/dl');
        }
        return { hasUpdate: false, retracted: true };
      }
      const required = mani.required || null;
      if (required && util.shouldForceUpdate(current, required)) {
        const top = mani.releases.find((r) => !r.retracted);
        const target = (top && top.version) || required;
        notify('Qbao 需要更新才能继续使用', '请升级到 ' + target);
        const w = getWindowFn && getWindowFn();
        await dialog.showMessageBox(w || undefined, {
          type: 'warning',
          buttons: ['下载并更新'],
          defaultId: 0,
          cancelId: 0,
          title: '需要更新才能继续使用',
          message: 'Qbao 需要更新到 ' + target,
          detail: '当前版本（' + current + '）已低于服务器要求的最低版本（' + required + '）。更新不会影响您的数据。',
        });
        send({ state: 'checking' });
        try {
          await autoUpdater.checkForUpdates();
        } catch (e) {
          return { hasUpdate: false, forced: true, error: '检查更新失败，请稍后重试' };
        }
        const dl = await downloadUpdateWithProgress();
        if (dl.ok) {
          send({ state: 'downloaded', version: target });
          await dialog.showMessageBox(w || undefined, {
            type: 'info',
            buttons: ['重启并安装'],
            defaultId: 0,
            cancelId: 0,
            title: '更新已就绪',
            message: 'Qbao ' + target + ' 已下载完成',
            detail: '重启应用即可完成安装（数据不受影响）。',
          });
          autoUpdater.quitAndInstall(false, true);
          return { hasUpdate: true, version: target, forced: true };
        }
        return { hasUpdate: false, forced: true, error: dl.error || '强制更新下载失败，请稍后重试' };
      }
    }
  }

  // —— 常规更新：始终由用户确认 ——
  send({ state: 'checking' });
  let r;
  try {
    r = await autoUpdater.checkForUpdates();
  } catch (e) {
    send({ state: 'error', message: e && e.message ? e.message : '检查更新失败' });
    return { hasUpdate: false, error: e && e.message ? e.message : '检查更新失败' };
  }
  const hasUpdate = !!(r && r.updateInfo && r.updateInfo.version && r.updateInfo.version !== current);
  if (!hasUpdate) {
    send({ state: 'up-to-date' });
    return { hasUpdate: false };
  }
  notify('Qbao 新版本 ' + r.updateInfo.version, '可在「设置 → 桌面端 → 软件更新」下载');
  const w = getWindowFn && getWindowFn();
  const res = await dialog.showMessageBox(w || undefined, {
    type: 'info',
    buttons: ['下载更新', '稍后'],
    defaultId: 0,
    cancelId: 1,
    title: '发现新版本',
    message: 'Qbao 新版本 ' + r.updateInfo.version,
    detail: '当前版本 ' + current + ' → ' + r.updateInfo.version + '。是否现在下载？',
  });
  if (res.response === 0) {
    notify('正在下载更新', 'Qbao ' + r.updateInfo.version + ' 正在后台下载，完成后会提示安装');
    const dl = await downloadUpdateWithProgress();
    if (!dl.ok) send({ state: 'error', message: dl.error });
  }
  return { hasUpdate: true, version: r.updateInfo.version };
}

// —— 历史版本自助回退：下载 + sha256 校验 + 唤起安装器 ——
async function downloadVersion(args) {
  if (disabled || !runtime.apiBase) return { ok: false, error: '未配置服务器地址，无法下载安装包' };
  const v = util.validateDownloadArgs(args);
  if (!v.ok) return { ok: false, error: v.error };
  const url = String(runtime.apiBase).replace(/\/+$/, '') + '/desktop/download?file=' + encodeURIComponent(v.fileName);
  const dir = path.join(app.getPath('userData'), 'rollback-tmp');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, v.fileName);
  const tmp = dest + '.part';
  sendRollback({ state: 'start', fileName: v.fileName });
  const result = await new Promise((resolve) => {
    const req = net.request(url);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp);
    let total = 0;
    let received = 0;
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        out.destroy();
        finish({ ok: false, error: '下载失败 HTTP ' + res.statusCode });
        return;
      }
      total = Number(res.headers['content-length'] || 0);
      res.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        if (total > 0) {
          sendRollback({ state: 'progress', percent: Math.min(99, Math.round((received / total) * 100)), fileName: v.fileName });
        }
      });
      res.pipe(out);
    });
    req.on('error', (e) => { out.destroy(); finish({ ok: false, error: e.message }); });
    out.on('error', (e) => finish({ ok: false, error: e.message }));
    out.on('finish', () => finish({ ok: true, sha256: hash.digest('hex') }));
    req.end();
  });
  if (!result.ok) {
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    sendRollback({ state: 'error' });
    return result;
  }
  if (result.sha256 !== v.sha256) {
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    sendRollback({ state: 'error' });
    return { ok: false, error: 'SHA256 校验失败（文件损坏或来源不可信），已删除下载文件' };
  }
  fs.renameSync(tmp, dest);
  sendRollback({ state: 'done', fileName: v.fileName, percent: 100 });
  const w = getWindowFn && getWindowFn();
  const confirmed = await dialog.showMessageBox(w || undefined, {
    type: 'info',
    buttons: ['运行安装程序'],
    defaultId: 0,
    cancelId: 0,
    title: '下载完成',
    message: 'Qbao v' + v.version + ' 安装包已下载并通过校验',
    detail: '运行安装程序即可覆盖安装（不影响您的数据）。安装完成后请重新打开 Qbao。',
  });
  if (confirmed.response === 0) {
    shell.openPath(dest).catch(() => {});
  }
  return { ok: true, version: v.version };
}

function setupUpdater(getWindow, runtimeCfg) {
  getWindowFn = getWindow;
  runtime = Object.assign({ apiBase: '', updateChannel: 'stable' }, runtimeCfg || {});
  feedUrl = util.buildFeedUrl(runtime.apiBase, runtime.updateChannel);
  disabled = !feedUrl || !app.isPackaged;
  if (disabled) {
    if (!feedUrl) console.warn('[updater] 未配置服务器地址，更新已禁用');
    return;
  }
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl, channel: 'latest' });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 清理历史回退临时目录
  try { fs.rmSync(path.join(app.getPath('userData'), 'rollback-tmp'), { recursive: true, force: true }); } catch (e) { /* ignore */ }

  // 启动延迟检查 + 每 6h 定时（受自动检查开关控制）
  const maybeCheck = () => {
    if (readAutoCheck()) checkAndPrompt().catch((e) => console.warn('[updater] 检查失败:', e.message));
  };
  setTimeout(maybeCheck, 8000);
  setInterval(maybeCheck, 6 * 60 * 60 * 1000);

  ipcMain.handle('qbao:check-updates', async () => {
    try {
      return await checkAndPrompt();
    } catch (e) {
      console.error('[updater] error:', e.message);
      return { hasUpdate: false, error: e.message };
    }
  });

  ipcMain.handle('qbao:quit-and-install', () => { autoUpdater.quitAndInstall(false, true); return true; });

  ipcMain.handle('qbao:get-update-info', () => ({
    feedUrl: feedUrl || '',
    channel: runtime.updateChannel,
    autoCheck: readAutoCheck(),
    lastCheckAt,
  }));

  ipcMain.handle('qbao:set-auto-check', (_e, v) => {
    const ok = writeAutoCheck(!!v);
    return { ok, autoCheck: readAutoCheck(), error: ok ? null : '写入设置失败' };
  });

  ipcMain.handle('qbao:download-version', async (_e, args) => downloadVersion(args));

  autoUpdater.on('download-progress', (p) => send({ state: 'progress', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', async (info) => {
    send({ state: 'downloaded', version: info.version });
    notify('Qbao 更新已就绪', '新版本 ' + info.version + ' 已下载完成，重启应用即可安装');
    const w = getWindowFn && getWindowFn();
    const res = await dialog.showMessageBox(w || undefined, {
      type: 'info',
      buttons: ['重启并安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: '更新已就绪',
      message: 'Qbao ' + info.version + ' 已下载完成',
      detail: '重启应用即可完成安装（数据不受影响）。',
    });
    if (res.response === 0) autoUpdater.quitAndInstall(false, true);
  });
  autoUpdater.on('error', (e) => { console.error('[updater]', e.message); send({ state: 'error', message: e.message }); });
}

module.exports = { setupUpdater };
