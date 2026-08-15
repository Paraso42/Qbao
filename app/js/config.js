// 运行时环境（Electron 桌面端由 preload 注入；网页版缺省同源）
// window.__QBAO_RUNTIME__ = { apiBase, isDesktop, updateChannel, serverLabel }
const RUNTIME = (typeof window !== 'undefined' && window.__QBAO_RUNTIME__) || null;
const API_BASE = (RUNTIME && RUNTIME.apiBase) || '/api/v1';
const IS_DESKTOP = !!(RUNTIME && RUNTIME.isDesktop);
let authToken = null;
let authUser = null;
let isOnlineMode = false;
let syncPending = false;
let syncTimer = null;
let aiTimer = null;
let aiGenerating = false;
let aiTaskRunnerActive = false;
let aiTaskAbortController = null;
let aiProviders = [];
let aiCurrentProvider = 'ecnu';