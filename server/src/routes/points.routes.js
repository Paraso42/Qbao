'use strict';

// ============================================================
// points.routes.js — 积分 API（v3.29）
// 用户：台账/余额/规则/配额/成就领取；管理员：任意用户台账与调整。
// ============================================================

const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const {
  claimSchema,
  adjustBodySchema,
  ledgerQuerySchema,
  userIdParamsSchema,
} = require('../schemas/points.schema');
const P = require('../config/points');
const pts = require('../services/pointsService');

module.exports = function (app) {
  // —— 用户 ——

  // GET /api/v1/points/ledger — 本人台账（分页 + reason 过滤）
  app.get('/api/v1/points/ledger', validate({ query: ledgerQuerySchema }), requireAuth, asyncHandler(async (req, res) => {
    const r = await pts.getLedger(pool, req.userId, {
      page: req.query.page,
      limit: req.query.limit,
      reason: req.query.reason,
    });
    res.json(r);
  }));

  // GET /api/v1/points/balance — 当前余额
  app.get('/api/v1/points/balance', requireAuth, asyncHandler(async (req, res) => {
    res.json({ balance: await pts.getBalance(pool, req.userId) });
  }));

  // GET /api/v1/points/rules — 赚取/消耗规则 + 学期清零信息
  app.get('/api/v1/points/rules', requireAuth, asyncHandler(async (req, res) => {
    res.json(pts.getRules());
  }));

  // GET /api/v1/points/quota — 今日 AI 配额使用情况
  app.get('/api/v1/points/quota', requireAuth, asyncHandler(async (req, res) => {
    res.json(await pts.getQuotaStatus(pool, req.userId));
  }));

  // POST /api/v1/points/claims — 成就奖励领取（幂等）
  app.post('/api/v1/points/claims', validate({ body: claimSchema }), requireAuth, asyncHandler(async (req, res) => {
    const { refId } = req.body;
    const reward = P.ACHIEVEMENT_REWARDS[refId];
    if (!reward) throw new ApiError(400, '未知的成就');
    const r = await pts.awardPoints(pool, req.userId, reward, {
      reason: 'achievement', refType: 'achievement', refId, note: '成就奖励',
    });
    res.json({ awarded: r.awarded, points: reward, balance: r.balance });
  }));

  // —— 管理员 ——

  // GET /api/v1/users/:id/points/ledger — 任意用户台账
  app.get('/api/v1/users/:id/points/ledger', validate({ params: userIdParamsSchema, query: ledgerQuerySchema }), requireAdmin, asyncHandler(async (req, res) => {
    const r = await pts.getLedger(pool, req.params.id, {
      page: req.query.page,
      limit: req.query.limit,
      reason: req.query.reason,
    });
    res.json(r);
  }));

  // POST /api/v1/users/:id/points/adjust — 管理员调整（±，note 必填）
  app.post('/api/v1/users/:id/points/adjust', validate({ params: userIdParamsSchema, body: adjustBodySchema }), requireAdmin, asyncHandler(async (req, res) => {
    const r = await pts.adjustPoints(req.params.id, req.body.delta, req.body.note);
    res.json({ balance: r.balance });
  }));
};
