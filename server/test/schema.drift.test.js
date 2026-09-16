'use strict';

// 迁移完整性守卫（P0-2 / P0-3 / P0-4 回归）
//
// 本轮复查发现：server/init.sql + server/sql/*.sql 建出的库，与线上库结构不一致 ——
//   * users 缺 role / is_banned / avatar_url / last_login_at / last_active_at；
//   * notices 表在仓库内没有任何 DDL。
// 而 docs/DEPLOY.md 的「全新安装」路径正是 init.sql + run_migration.js，
// 结果新环境注册即 42703、所有鉴权请求 500。这三条断言把该缺口钉死在 CI 里：
// 任何被 server/src 引用的关键表/列，必须在仓库的 DDL 中可复现。

const fs = require('fs');
const path = require('path');

const SQL_DIR = path.join(__dirname, '..', 'sql');
const INIT_SQL = path.join(__dirname, '..', 'init.sql');
const SRC_DIR = path.join(__dirname, '..', 'src');

function readAllSchemaSql() {
  const parts = [fs.readFileSync(INIT_SQL, 'utf8')];
  fs.readdirSync(SQL_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .forEach((f) => parts.push(fs.readFileSync(path.join(SQL_DIR, f), 'utf8')));
  return parts.join('\n');
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const SCHEMA = readAllSchemaSql();

describe('迁移完整性（DDL 与代码引用一致）', () => {
  it('users 表含全部被 auth/middleware/users 路由引用的身份列', () => {
    // 每一列都从 server/src 的真实 SQL 引用中反向确认过（见下方 grep 依据）：
    //   role            → auth.routes.js:31,39,47 / middleware.js:76 / bootstrap_admin.js
    //   is_banned       → middleware.js:38 / auth.routes.js:61 / users.routes.v2.js:63
    //   avatar_url      → auth.routes.js:39,76 / chat.routes.v2.js:109 / users.routes.v2.js:62
    //   last_login_at   → auth.routes.js:66,76 / users.routes.v2.js:63
    //   last_active_at  → middleware.js:56 / auth.routes.js:76 / users.routes.v2.js:63
    const required = ['role', 'is_banned', 'avatar_url', 'last_login_at', 'last_active_at'];
    const usersDdl = SCHEMA.match(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/);
    expect(usersDdl).not.toBeNull();
    for (const col of required) {
      const inCreate = new RegExp('^\\s*' + col + '\\s', 'm').test(usersDdl[0]);
      const inAlter = new RegExp('ALTER TABLE users ADD COLUMN IF NOT EXISTS ' + col + '\\b').test(SCHEMA);
      expect(inCreate || inAlter, 'users.' + col + ' 在 init.sql + sql/*.sql 中没有任何 DDL').toBe(true);
    }
  });

  it('notices 表在仓库内存在 DDL，且覆盖 notices.routes.v2.js 读写的全部字段', () => {
    // notices.routes.v2.js 引用：content/type/link/enabled/sort_order/duration/
    // expire_at/created_by/created_at/updated_at（7 个端点）。
    const required = ['content', 'type', 'link', 'enabled', 'sort_order', 'duration',
      'expire_at', 'created_by', 'created_at', 'updated_at'];
    const ddl = SCHEMA.match(/CREATE TABLE IF NOT EXISTS notices \([\s\S]*?\n\);/);
    expect(ddl, 'notices 表在仓库中缺少 CREATE TABLE').not.toBeNull();
    for (const col of required) {
      expect(new RegExp('^\\s*' + col + '\\s', 'm').test(ddl[0]), 'notices.' + col + ' 缺少 DDL').toBe(true);
    }
  });

  it('server/src 引用的每一张业务表，都能在仓库 DDL 中找到建表语句', () => {
    // 反向守卫：防止再出现「代码用了某张表，但仓库里查不到 DDL」的情况（P0-3 的成因）。
    //
    // 说明：JS 里是字符串拼 SQL，无法用真实解析器。这里只做两侧夹逼，避免误报：
    //   (a) 必须紧跟 FROM / INSERT INTO / UPDATE / DELETE FROM；
    //   (b) 后面不能紧跟 '(' —— 排除 jsonb_array_elements_text(...) 这类函数调用；
    //   (c) 名字不在「SQL 关键字/CTE 别名」白名单内。
    // 宁可漏报也不误报：本用例的价值在于「有人新增了一张表却忘了写 DDL」时立刻变红。
    const IGNORE = new Set([
      'schema_migrations', // 由 run_migration.js 自行 CREATE，不属于业务表
      'current_date', 'partially', 'providers', 'streaming', 'failed', 'skip', 'reset',
      'jsonb_array_elements_text', 'unnest', 'generate_series', 'only', 'lateral',
      // 动态拼 SQL 的残留（'UPDATE answer_sessions SET ' + cols / 'UPDATE users SET ' + updates）
      'answer', 'set',
    ]);
    const declared = new Set();
    const cre = /CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi;
    let c;
    while ((c = cre.exec(SCHEMA)) !== null) declared.add(c[1]);
    expect(declared.size).toBeGreaterThan(10); // 自检：DDL 确实被读进来了

    const referenced = new Set();
    const RE = /\b(?:FROM|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)(\s*\()?/gi;
    for (const file of walk(SRC_DIR)) {
      const code = fs.readFileSync(file, 'utf8');
      let m;
      RE.lastIndex = 0;
      while ((m = RE.exec(code)) !== null) {
        if (m[2]) continue;       // 函数调用，不是表（如 jsonb_array_elements_text( ... )）
        referenced.add(m[1].toLowerCase());
      }
    }

    const missing = [...referenced].filter((t) => !IGNORE.has(t) && !declared.has(t));
    expect(missing, '以下表被 server/src 引用但仓库 DDL 中不存在: ' + missing.join(', ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 路由注册唯一性守卫（R4 回归）
//
// files.routes.v2.js 曾经把 DELETE /files/:id 等四个端点注册了两遍：Express 对
// 同一方法+路径只命中先注册的那个「更早」处理器……反过来，当两处实现不一致时，
// 真正生效的是**先注册**的那个，而维护者往往只改后面那个副本 —— 于是「改了没生效」。
// 这类重复注册不会报错、不会 500，只会在生产上表现为「我的改动没生效」，极难排查。
// 本用例把「同一路由文件内 method+path 不得重复」钉死，顺带守住跨文件重复。
// ---------------------------------------------------------------------------
describe('路由注册唯一性（同一 method+path 不得注册两次）', () => {
  const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');

  function collectRegistrations() {
    const seen = new Map();
    let total = 0;
    for (const file of walk(ROUTES_DIR)) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const m = line.match(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/);
        if (!m) return;
        total++;
        const key = m[1].toUpperCase() + ' ' + m[2];
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push(path.relative(ROUTES_DIR, file) + ':' + (i + 1));
      });
    }
    return { seen, total };
  }

  it('扫描到的端点数量合理（自检：守卫确实读到了路由文件）', () => {
    const { seen, total } = collectRegistrations();
    expect(total).toBeGreaterThan(80);
    expect(seen.size).toBe(total); // 若有重复，unique 会小于 total
  });

  it('不存在重复注册', () => {
    const { seen } = collectRegistrations();
    const dup = [...seen.entries()].filter(([, locs]) => locs.length > 1);
    const msg = dup.map(([k, locs]) => k + ' → ' + locs.join(' , ')).join('\n');
    expect(dup, '以下路由被注册了多次（Express 只命中先注册者）:\n' + msg).toEqual([]);
  });
});

