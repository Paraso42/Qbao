// Qbao 桌面端自动更新（electron-updater）
// 更新源：GitHub Releases（desktop/package.json build.publish）
// 流程：启动检查 → 提示下载 → 下载进度 → 下载完成提示重启安装
const { app, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

let getWindowFn = null;

function setupUpdater(getWindow) {
  getWindowFn = getWindow;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 启动后延迟检查（静默：有新版本时提示）
  setTimeout(() => {
    if (app.isPackaged) autoUpdater.checkForUpdates().catch(e => console.warn('[updater] 检查失败:', e.message));
  }, 8000);

  ipcMain.handle('qbao:check-updates', async () => {
    try {
      const r = await autoUpdater.checkForUpdates();
      const hasUpdate = !!(r && r.updateInfo && r.updateInfo.version && r.updateInfo.version !== app.getVersion());
      if (hasUpdate) {
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
        if (res.response === 0) await autoUpdater.downloadUpdate();
        return { hasUpdate: true, version: r.updateInfo.version };
      }
      return { hasUpdate: false };
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
