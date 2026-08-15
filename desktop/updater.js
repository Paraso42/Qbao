// Qbao 桌面端自动更新（electron-updater）
// 更新源：GitHub Releases（desktop/package.json build.publish）
// 流程：启动检查 → 提示下载 → 下载进度 → 下载完成提示重启安装
const { app, dialog, ipcMain, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');

let getWindowFn = null;

// 系统级通知（Windows 10/11 通知中心），失败仅告警不影响流程
function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body, silent: false }).show();
  } catch (e) {
    console.warn('[updater] 系统通知失败:', e.message);
  }
}

// 检查 + 提示 + 下载（启动自动检查与手动检查共用）
async function checkAndPrompt() {
  const r = await autoUpdater.checkForUpdates();
  const hasUpdate = !!(r && r.updateInfo && r.updateInfo.version && r.updateInfo.version !== app.getVersion());
  if (!hasUpdate) return { hasUpdate: false };
  notify('Qbao 新版本 ' + r.updateInfo.version, '已发现新版本，可在「设置 → 桌面端 → 软件更新」下载');
  const w = getWindowFn && getWindowFn();
  const detail = '当前版本 ' + app.getVersion() + ' → ' + r.updateInfo.version + '。是否现在下载？';
  const res = await dialog.showMessageBox(w || undefined, {
    type: 'info',
    buttons: ['下载更新', '稍后'],
    defaultId: 0,
    cancelId: 1,
    title: '发现新版本',
    message: 'Qbao 新版本 ' + r.updateInfo.version,
    detail
  });
  if (res.response === 0) {
    notify('正在下载更新', 'Qbao ' + r.updateInfo.version + ' 正在后台下载，完成后会提示安装');
    await autoUpdater.downloadUpdate();
  }
  return { hasUpdate: true, version: r.updateInfo.version };
}

function setupUpdater(getWindow) {
  getWindowFn = getWindow;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 启动后延迟检查（有新版本时弹窗提示）
  setTimeout(() => {
    if (app.isPackaged) checkAndPrompt().catch(e => console.warn('[updater] 检查失败:', e.message));
  }, 8000);

  ipcMain.handle('qbao:check-updates', async () => {
    try {
      return await checkAndPrompt();
    } catch (e) {
      console.error('[updater] error:', e.message);
      return { hasUpdate: false, error: e.message };
    }
  });

  ipcMain.handle('qbao:quit-and-install', () => { autoUpdater.quitAndInstall(false, true); return true; });

  const send = (status) => {
    const w = getWindowFn && getWindowFn();
    if (w && !w.isDestroyed()) w.webContents.send('qbao:update-status', status);
  };
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
      detail: '重启应用即可完成安装（数据不受影响）。'
    });
    if (res.response === 0) autoUpdater.quitAndInstall(false, true);
  });
  autoUpdater.on('error', (e) => { console.error('[updater]', e.message); send({ state: 'error', message: e.message }); });
}

module.exports = { setupUpdater };
