'use strict';

// ============================================================
// files.js — 上传文件共享配置（T2 整改：上传白名单收敛到一处）
// 供 chat/files/issues 等上传通道共用，避免各路由各自的
// 白名单漂移（原 files.routes.v2.js 内联 ALLOWED_FILE_EXTS）。
// ============================================================

// 文件池/AI 出题资料：文档类（服务端解析用）
const POOL_ALLOWED_EXTS = ['.pdf', '.doc', '.docx', '.pptx', '.txt', '.md'];

// 图片类（聊天图片 / issue 附图 / 头像）
const IMAGE_ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

// 聊天文件：文档 + 图片 + 常用压缩包（拒绝可执行/可脚本化类型）
const CHAT_ALLOWED_EXTS = [].concat(
  IMAGE_ALLOWED_EXTS,
  POOL_ALLOWED_EXTS,
  ['.xlsx', '.zip']
);

// 单次 AI 出题资料上传的文件数 / 总体积上限（P1-4）。
// 路由侧 upload.array('files', 10) 已限制个数；这里把「总体积」显式化，
// 免得以后有人单方面放宽 fileSize 就悄悄允许单请求 200MB。
const AI_UPLOAD_MAX_EXTS = 10;
const AI_UPLOAD_MAX_TOTAL_BYTES = 60 * 1024 * 1024;

// ============================================================
// 聊天媒体加固（v3.37.7）：带宽 / 磁盘 / 超大文件三重防护
// ============================================================
//
// 背景：聊天上传此前只有一条 50MB 的单文件上限，其余什么都没有 ——
//   * 上传不计数、不限额：一个账号循环 POST /chat/upload 就能把磁盘写满；
//   * 上传后不发送也留在盘上：孤儿文件没有任何清理路径，长期只涨不减；
//   * 附件可以永久留存：聊天被当成免费网盘，与「学习资料传递」的产品定位背离；
//   * 下载只看次数不看流量：签名 ticket 在有效期内可无限重放，反复拉同一个
//     大文件即可持续占用服务器出口带宽（跨境按流量计费）。
// 下面这组常量是上述四个问题的唯一口径来源（路由/服务/文档都引用这里）。

// —— 单文件上限：学习资料级别 ——
// 文件 20MB（与文件池 /files 一致），图片 8MB（客户端已压到 1600px/webp，
// 正常只有几十~几百 KB；8MB 只用于兜住「压缩失败的原图」这类边界）。
const CHAT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const CHAT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// 列表小图（?w=480 派生图）：客户端固定长边 480/webp，正常 < 50KB
const CHAT_MAX_THUMB_BYTES = 512 * 1024;
// 一条消息最多几张图（schema 的硬上限是 20，这里是业务上限）
const CHAT_MAX_IMAGES_PER_MESSAGE = 9;

// —— 配额（按账号，不按 IP：换 IP 绕不过去）——
// 每小时上传次数（防脚本刷）；每日上传字节（防「今天先把 10GB 存进来」）；
// 留存总量（防「把聊天当网盘」）。超限一律拒绝，且**在 multer 之前**拒绝，
// 这样被拒的请求不会真的把字节写进磁盘。
const CHAT_UPLOAD_MAX_PER_HOUR = 60;
// 200MB/天 ≈ 每天 10 个大文件。正常人一个学期也到不了；
// 而「今天先塞 10GB 进来」这种用法会被它挡在当天。
const CHAT_USER_DAILY_UPLOAD_BYTES = 200 * 1024 * 1024;
const CHAT_USER_TOTAL_BYTES = 500 * 1024 * 1024;

// —— 保留期 ——
// 孤儿（上传了但从未被消息引用）：24 小时后删除 —— 这是「只上传不发消息」
// 刷盘手法的唯一出口。
const CHAT_ORPHAN_TTL_HOURS = 24;
// 已引用媒体：180 天后释放字节（台账保留 purged_at 供审计）。消息行不动，
// 老图片会变成「无法加载」，这是明确的取舍：聊天不是长期存储。
const CHAT_MEDIA_RETENTION_DAYS = 180;

// —— 磁盘水位熔断 ——
// 剩余空间低于此值时拒绝一切新上传（最后一道防线：配额是「每人」，水位是「整机」）。
const CHAT_UPLOAD_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;

// —— 下载侧（按 IP，见 lib/mediaLimits.js）——
// 次数：媒体路径用独立限流器（校园 NAT 几百人共享一个公网 IP，
//       沿用通用 120/min 会误伤正常浏览）
const MEDIA_DOWNLOAD_MAX_PER_MIN = 300;
// 流量：真正的兜底。取 1GB/10min（≈1.7MB/s 持续），理由：
//   * 正常浏览一屏图（9 张 2MB）≈ 18MB，1GB 够连刷 ~55 屏 —— 不误伤；
//   * 而重放一个 20MB 附件要拉 50 次才触顶，脚本刷流量的性价比直接归零。
const MEDIA_DOWNLOAD_BYTES_PER_10MIN = 1024 * 1024 * 1024;

module.exports = {
  POOL_ALLOWED_EXTS,
  IMAGE_ALLOWED_EXTS,
  CHAT_ALLOWED_EXTS,
  AI_UPLOAD_MAX_EXTS,
  AI_UPLOAD_MAX_TOTAL_BYTES,
  CHAT_MAX_FILE_BYTES,
  CHAT_MAX_IMAGE_BYTES,
  CHAT_MAX_THUMB_BYTES,
  CHAT_MAX_IMAGES_PER_MESSAGE,
  CHAT_UPLOAD_MAX_PER_HOUR,
  CHAT_USER_DAILY_UPLOAD_BYTES,
  CHAT_USER_TOTAL_BYTES,
  CHAT_ORPHAN_TTL_HOURS,
  CHAT_MEDIA_RETENTION_DAYS,
  CHAT_UPLOAD_MIN_FREE_BYTES,
  MEDIA_DOWNLOAD_MAX_PER_MIN,
  MEDIA_DOWNLOAD_BYTES_PER_10MIN,
};