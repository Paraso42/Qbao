'use strict';

// 优雅停机（P1-7）
//
// 背景：server.js 此前直接 createApp().listen(...)，没有任何信号处理。
// 部署（docs/DEPLOY.md 用 pm2 restart / systemctl restart）时进程被 SIGTERM 直接杀掉：
//   * 正在进行的 AI 出题、数据同步、上传下载被硬切断，客户端只看到网络错误；
//   * 正在写的用户数据可能只落了一半（客户端有 rev 兜底，但会留下无谓冲突）；
//   * ai_tasks 里的任务停在 running，直到下次启动才被 markStaleTasksFailed 判失败。
//
// 本模块把停机做成有序动作：
//   1. 停止接受新连接（server.close）并停止两个后台定时器（AI worker / 积分解算）；
//   2. 等待在途 AI 任务与在途 HTTP 连接收尾（宽限期，默认 15s）；
//   3. 关闭 PostgreSQL 连接池；
//   4. 退出。超时则强制退出（返回码仍为 0，避免 pm2 误判为崩溃重启风暴）。
//
// 采用依赖注入以便单测：不真实监听端口、不真实建连接池。

const DEFAULT_GRACE_MS = 15000;

function createShutdownHandler(deps) {
  const {
    server,
    pool,
    stopAiTaskWorker,
    stopExpiryJob,
    stopChatMediaJob,
    drainAiTaskWorker,
    logger,
    graceMs,
    exit,
  } = deps || {};
  const log = logger || console;
  const grace = typeof graceMs === 'number' ? graceMs : DEFAULT_GRACE_MS;
  let shuttingDown = false;

  return function shutdown(signal) {
    if (shuttingDown) {
      // 第二次信号：用户/编排器已经不耐烦，直接退出
      log.warn('[shutdown] 收到第二次 ' + signal + '，强制退出');
      try { exit(0) } catch (_) { /* 忽略 */ }
      return Promise.resolve();
    }
    shuttingDown = true;
    log.log('[shutdown] 收到 ' + signal + '，开始优雅停机（宽限 ' + grace + 'ms）');

    // 1) 停止后台定时器：不再领取新任务
    try { if (stopAiTaskWorker) stopAiTaskWorker() } catch (e) { log.warn('[shutdown] 停止 AI worker 失败:', e && e.message) }
    try { if (stopExpiryJob) stopExpiryJob() } catch (e) { log.warn('[shutdown] 停止积分定时任务失败:', e && e.message) }
    try { if (stopChatMediaJob) stopChatMediaJob() } catch (e) { log.warn('[shutdown] 停止聊天媒体回收任务失败:', e && e.message) }

    // 2) 停止接收新连接
    const closed = new Promise((resolve) => {
      if (!server || typeof server.close !== 'function') return resolve();
      try {
        server.close(() => resolve());
      } catch (e) {
        log.warn('[shutdown] 关闭 HTTP server 失败:', e && e.message);
        resolve();
      }
    });

    // 3) 等在途工作收尾（最长 grace）
    // unref：若此时事件循环已无其它句柄（例如已无连接且 worker 空闲），
    // 这个宽限定时器不该单独把进程吊住。
    const deadline = new Promise((resolve) => {
      const t = setTimeout(resolve, grace);
      if (t && typeof t.unref === 'function') t.unref();
    });
    const drainInFlight = (typeof drainAiTaskWorker === 'function')
      ? drainAiTaskWorker(grace).catch((e) => {
        log.warn('[shutdown] 等待在途任务失败:', e && e.message);
        return false;
      })
      : Promise.resolve(true);
    const connectionDrain = Promise.race([closed, deadline]);
    const workDrain = Promise.race([drainInFlight, deadline]);
    const timedOut = Promise.race([
      Promise.all([closed, drainInFlight]).then(() => false),
      deadline.then(() => true),
    ]);

    return Promise.all([connectionDrain, workDrain, timedOut]).then(([, , wasTimeout]) => {
      if (wasTimeout) log.warn('[shutdown] 宽限期已到，仍有未完成的工作，强制继续');
      // 4) 关闭连接池
      return Promise.resolve()
        .then(() => (pool && typeof pool.end === 'function' ? pool.end() : null))
        .catch((e) => log.warn('[shutdown] 关闭连接池失败:', e && e.message))
        .then(() => {
          log.log('[shutdown] 已停止');
          exit(0);
        });
    });
  };
}

// 注册信号（幂等：重复注册不会叠加处理器）
function registerShutdownHandlers(handler, proc) {
  const p = proc || process;
  const onTerm = () => handler('SIGTERM');
  const onInt = () => handler('SIGINT');
  p.on('SIGTERM', onTerm);
  p.on('SIGINT', onInt);
  return () => {
    p.removeListener('SIGTERM', onTerm);
    p.removeListener('SIGINT', onInt);
  };
}

module.exports = { createShutdownHandler, registerShutdownHandlers, DEFAULT_GRACE_MS };
