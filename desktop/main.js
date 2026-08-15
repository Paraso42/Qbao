// Qbao 桌面端主进程
// 职责：窗口管理、单实例、运行时配置注入、系统级操作（打开外链/更新）。
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { setupUpdater } = require('./updater');

let mainWindow = null;

function loadRuntimeConfig() {
  let cfg = { apiBase: '', serverLabel: '', updateChannel: 'stable' };
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))); } catch (e) { console.warn('[desktop] config.json 读取失败，使用默认'); }
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8'))); } catch (e) { /* 本地覆盖不存在，忽略 */ }
  if (process.env.QBAO_API_BASE) cfg.apiBase = process.env.QBAO_API_BASE;
  if (!cfg.apiBase) console.warn('[desktop] 未配置 apiBase（config.local.json 或 QBAO_API_BASE），桌面端将运行在纯本地/离线模式');
  return cfg;
}

function createWindow() {
  const runtime = loadRuntimeConfig();
  const runtimeArg = '--qbao-runtime=' + encodeURIComponent(JSON.stringify({ apiBase: runtime.apiBase, serverLabel: runtime.serverLabel, updateChannel: runtime.updateChannel, isDesktop: true }));
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: 'Qbao',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [runtimeArg],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    createWindow();
    setupUpdater(() => mainWindow);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

// 系统级 IPC
ipcMain.handle('qbao:get-version', () => app.getVersion());
ipcMain.handle('qbao:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  return true;
});
