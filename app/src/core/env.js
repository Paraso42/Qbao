// 运行时环境（Electron 桌面端由 preload 注入；网页版缺省同源）
// window.__QBAO_RUNTIME__ = { apiBase, isDesktop, updateChannel, serverLabel }
const RUNTIME = (typeof window !== 'undefined' && window.__QBAO_RUNTIME__) || null

export const API_BASE = (RUNTIME && RUNTIME.apiBase) || '/api/v1'
export const IS_DESKTOP = !!(RUNTIME && RUNTIME.isDesktop)
export const UPDATE_CHANNEL = (RUNTIME && RUNTIME.updateChannel) || 'stable'
export const SERVER_LABEL = (RUNTIME && RUNTIME.serverLabel) || ''

export function desktopBridge() {
  return (typeof window !== 'undefined' && window.__qbaoDesktop) || null
}
