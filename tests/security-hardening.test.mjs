// Public data projection, rate limits, security headers, trust proxy, and expired-row pruning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { AllowedFields, ProjectRows } = require('../Web/backend/lib/public-projection.js');
const { SecurityHeaders, CreateLimiters, TrustProxySetting, TOO_MANY } = require('../Web/backend/lib/security.js');
const { PruneExpired, PRUNE_QUERIES, DEMO_PRUNE_QUERIES } = require('../Web/backend/lib/maintenance.js');
const CreatePublicDashboardsRouter = require('../Web/backend/lib/routes/public-dashboards.js');

async function withApp(app, fn) {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

// ---- projection ----

test('charts and KPIs expose only their bound x/y fields, merged per source', () => {
  const allowed = AllowedFields({
    widgets: [
      { type: 'bar', config: { bindings: [{ sourceId: 's1', xField: 'month', yField: 'revenue' }] } },
      { type: 'kpi', config: { bindings: [{ sourceId: 's1', yField: 'orders', agg: 'sum' }] } },
      { type: 'kpi', config: { bindings: [{ sourceId: 's2', agg: 'count' }] } },
    ],
  });
  assert.deepEqual([...allowed.get('s1')].sort(), ['month', 'orders', 'revenue']);
  assert.deepEqual([...allowed.get('s2')], []);
});

test('a table with chosen columns exposes those; a table showing all columns exposes everything', () => {
  const chosen = AllowedFields({ widgets: [{ type: 'table', config: { bindings: [{ sourceId: 's1' }], columns: ['name', 'total'] } }] });
  assert.deepEqual([...chosen.get('s1')].sort(), ['name', 'total']);

  const all = AllowedFields({
    widgets: [
      { type: 'bar', config: { bindings: [{ sourceId: 's1', xField: 'a', yField: 'b' }] } },
      { type: 'table', config: { bindings: [{ sourceId: 's1' }], columns: [] } },
      { type: 'line', config: { bindings: [{ sourceId: 's1', xField: 'c', yField: 'd' }] } },
    ],
  });
  assert.equal(all.get('s1'), null);
});

test('ProjectRows keeps allowed keys only, copies rows, and tolerates junk', () => {
  const rows = [{ month: 'Jan', revenue: 5, email: 'a@b.c' }, null, 'x'];
  const out = ProjectRows(rows, new Set(['month', 'revenue', 'missing']));
  assert.deepEqual(out, [{ month: 'Jan', revenue: 5 }, {}, {}]);
  assert.equal(rows[0].email, 'a@b.c'); // input untouched

  const copied = ProjectRows([{ a: 1 }], null);
  assert.deepEqual(copied, [{ a: 1 }]);
  assert.notEqual(copied[0], rows[0]);
  assert.deepEqual(ProjectRows('nope', null), []);
  assert.deepEqual(ProjectRows([{ a: 1 }], undefined), [{}]); // unknown source: nothing
});

test('public /data never sends columns the widgets do not display', async () => {
  const def = {
    name: 'Shared',
    widgets: [{ id: 'w1', type: 'kpi', config: { bindings: [{ sourceId: 'src_a', yField: 'total', agg: 'sum' }] } }],
  };
  const repos = {
    dashboards: { getPublic: async () => ({ id: 'dash_x', owner_id: 1, definition: def, is_public: 1, updated_at: new Date() }) },
    sources: { getManyWithKey: async () => [{ id: 'src_a', name: 'Orders' }] },
  };
  const previewSource = async () => [{ total: 10, email: 'secret@example.com', ssn: '123' }];
  const app = express();
  app.use('/api/public/dashboards', CreatePublicDashboardsRouter({ repos, previewSource }));
  await withApp(app, async (base) => {
    const res = await fetch(`${base}/api/public/dashboards/dash_x/data`);
    const body = await res.json();
    assert.deepEqual(body.data.src_a, { name: 'Orders', rows: [{ total: 10 }] });
    assert.ok(!JSON.stringify(body).includes('secret@example.com'));
  });
});

// ---- rate limits ----

test('limiters answer 429 with the standard error envelope once the limit is hit', async () => {
  const app = express();
  const { authSensitive } = CreateLimiters();
  app.use('/limited', authSensitive, (req, res) => res.json({ success: true, data: null }));
  await withApp(app, async (base) => {
    for (let i = 0; i < 10; i += 1) assert.equal((await fetch(`${base}/limited`)).status, 200);
    const res = await fetch(`${base}/limited`);
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { success: false, error: TOO_MANY });
    assert.ok(res.headers.get('ratelimit-policy'));
  });
});

test('the per-user limiter keys on req.userId, so users behind one IP have separate budgets', async () => {
  const app = express();
  const { sourceFetch } = CreateLimiters();
  app.use((req, res, next) => { req.userId = Number(req.headers['x-user']); next(); });
  app.use('/fetch', sourceFetch, (req, res) => res.json({ success: true, data: null }));
  await withApp(app, async (base) => {
    const hit = (user) => fetch(`${base}/fetch`, { headers: { 'x-user': String(user) } });
    for (let i = 0; i < 120; i += 1) await hit(1);
    assert.equal((await hit(1)).status, 429);
    assert.equal((await hit(2)).status, 200);
  });
});

test('TRUST_PROXY parsing', () => {
  assert.equal(TrustProxySetting(undefined), false);
  assert.equal(TrustProxySetting(''), false);
  assert.equal(TrustProxySetting('false'), false);
  assert.equal(TrustProxySetting('1'), 1);
  assert.equal(TrustProxySetting('loopback'), 'loopback');
});

// ---- headers ----

test('security headers include a CSP that blocks inline scripts and framing', async () => {
  const app = express();
  app.use(SecurityHeaders());
  app.get('/', (req, res) => res.send('ok'));
  await withApp(app, async (base) => {
    const res = await fetch(base);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('strict-transport-security'), null); // not in dev
  });
});

// ---- pruning ----

test('PruneExpired runs every prune query, sums deletions, and survives a failing table', async () => {
  const seen = [];
  const errors = [];
  const db = {
    query: async (sql) => {
      seen.push(sql);
      if (sql.includes('email_tokens')) throw Object.assign(new Error('boom'), { code: 'ER_NO_SUCH_TABLE' });
      return { affectedRows: 2 };
    },
  };
  const deleted = await PruneExpired(db, { error: (m) => errors.push(m) });
  assert.deepEqual(seen, [...PRUNE_QUERIES, ...DEMO_PRUNE_QUERIES]);
  // 10 queries, 2 of them touch email_tokens and fail; the other 8 delete 2 rows each
  assert.equal(deleted, 16);
  assert.deepEqual(errors, ['[maintenance] prune failed: ER_NO_SUCH_TABLE', '[maintenance] prune failed: ER_NO_SUCH_TABLE']);
});
