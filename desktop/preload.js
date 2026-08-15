// Qbao 桌面端预加载脚本
// 职责：解析主进程注入的运行时配置 → window.__QBAO_RUNTIME__；暴露桌面能力桥。
const { contextBridge, ipcRenderer } = require('electron');

let runtime = null;
try {
  const arg = process.argv.find(a => a.startsWith('--qbao-runtime='));
  if (arg) runtime = JSON.parse(decodeURIComponent(arg.slice('--qbao-runtime='.length)));
} catch (e) {
  console.error('[preload] runtime 解析失败', e);
}
if (!runtime) runtime = { apiBase: '', isDesktop: true, updateChannel: 'stable', serverLabel: '' };
runtime.isDesktop = true;

contextBridge.exposeInMainWorld('__QBAO_RUNTIME__', Object.freeze(runtime));
contextBridge.exposeInMainWorld('__qbaoDesktop', Object.freeze({
  getVersion: () => ipcRenderer.invoke('qbao:get-version'),
  getAppInfo: () => ipcRenderer.invoke('qbao:get-app-info'),
  setAutoStart: (enabled) => ipcRenderer.invoke('qbao:set-auto-start', enabled),
  setServer: (url, label) => ipcRenderer.invoke('qbao:save-server', url, label),
  checkForUpdates: () => ipcRenderer.invoke('qbao:check-updates'),
  quitAndInstall: () => ipcRenderer.invoke('qbao:quit-and-install'),
  openExternal: (url) => ipcRenderer.invoke('qbao:open-external', url),
  onUpdateStatus: (cb) => {
    ipcRenderer.on('qbao:update-status', (_e, s) => { try { cb(s); } catch (err) {} });
  }
}));
