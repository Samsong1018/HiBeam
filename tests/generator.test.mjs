// Unit tests for the dashboard Generator (Web/frontend/scripts/editor/generator.js).
// Fixtures are the real APP1/APP2 shapes, so a rule change that breaks the
// showcase boards fails here. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { profileFields, generateSection, generateDashboard, rankNumbers } from '../Web/frontend/scripts/editor/generator.js';
import { normalizeDashboard, newDashboard } from '../Web/frontend/scripts/editor/model.js';
import { DemoMetrics, DemoHistory, DemoServices, DemoAccessLog } from '../APP1/agent/simulate.mjs';

const require = createRequire(import.meta.url);
const { ParseLogs } = require('../Web/backend/lib/connectors/logs.js');

const NOW = new Date('2026-11-24T18:31:07Z');
const STARTED = new Date('2026-11-24T18:00:00Z');

function counter() {
  let n = 0;
  return (prefix = 'w') => `${prefix}_${++n}`;
}

const roleMap = (rows) => Object.fromEntries(profileFields(rows).map((f) => [f.name, f.role]));
const types = (widgets) => widgets.map((w) => w.type);
const section = (rows, columns = 48, name = 'Src') => generateSection({ id: 'src_1', name }, rows, { columns, makeId: counter() });
const byType = (widgets, type) => widgets.filter((w) => w.type === type);

// ------------------------------------------------------------
// APP2 workbook sheets (values copied from APP2/John_Doe_finance.xlsx)
// ------------------------------------------------------------
const BUDGET = [
  ['Rent', 1400, 1400, 0], ['Groceries', 350, 412, 62], ['Utilities', 180, 165, -15], ['Transport', 220, 240, 20],
  ['Dining Out', 150, 210, 60], ['Insurance', 180, 180, 0], ['Subscriptions', 45, 62, 17], ['Health', 100, 85, -15],
  ['Savings', 500, 500, 0], ['Entertainment', 100, 130, 30], ['Misc', null, 9, 9],
].map(([Category, b, a, d]) => ({ Category, 'Budget ($)': b, 'Actual ($)': a, Difference: d }));

const NET_WORTH = ['June', 'July', 'August', 'September', 'October', 'November']
  .map((Month, i) => ({ Month, 'Net Worth ($)': 54200 + i * 900 }));

const SPENDING = ['June', 'July', 'August', 'September', 'October', 'November']
  .map((Month, i) => ({ Month, 'Spending ($)': 3800 + i * 50 }));

const DEBTS = [
  { Debt: 'Student Loan', 'Balance ($)': 14200, 'Min Payment ($/mo)': 185, 'APR (%)': 5.5 },
  { Debt: 'Credit Card', 'Balance ($)': 1840, 'Min Payment ($/mo)': 37, 'APR (%)': 22.9 },
  { Debt: 'Car Loan', 'Balance ($)': 6400, 'Min Payment ($/mo)': 260, 'APR (%)': 6.9 },
];

// ------------------------------------------------------------
// Profiling
// ------------------------------------------------------------
test('profileFields: roles for basic shapes', () => {
  const rows = [
    { date: '2026-01-01', region: 'N', revenue: '1,200', note: 'first', id: 7, blank: '' },
    { date: '2026-01-02', region: 'S', revenue: 900, note: 'second', id: 8, blank: null },
    { date: '2026-01-03', region: 'N', revenue: '$40', note: 'third', id: 9 },
    { date: '2026-01-04', region: 'S', revenue: 10, note: 'fourth', id: 10 },
  ];
  assert.deepEqual(roleMap(rows), { date: 'time', region: 'category', revenue: 'number', note: 'label', id: 'text', blank: 'empty' });
});

test('profileFields: first-seen order, non-objects ignored, long names skipped', () => {
  const long = 'x'.repeat(121);
  const rows = [null, 5, 'row', [1, 2], { b: 1 }, { a: 2, [long]: 3 }];
  assert.deepEqual(profileFields(rows).map((f) => f.name), ['b', 'a']);
  assert.deepEqual(profileFields([]), []);
  assert.deepEqual(profileFields(null), []);
});

test('profileFields: bare numbers are numbers, never time', () => {
  assert.equal(roleMap([{ y: 2024 }, { y: 2025 }, { y: 1700000000 }]).y, 'number');
  assert.equal(roleMap([{ t: '2026/01/02' }, { t: '2026-01-03T10:00:00Z' }]).t, 'time');
  assert.equal(roleMap([{ t: '2026-13-45' }, { t: '2026-01-03' }]).t, 'label', 'invalid dates are not time');
});

test('profileFields: identifier names are text', () => {
  const rows = [1, 2, 3, 4].map((n) => ({ id: n, ID: n, user_id: n % 2, sessionId: n, valid: n, fluid: n }));
  const roles = roleMap(rows);
  assert.equal(roles.id, 'text');
  assert.equal(roles.ID, 'text');
  assert.equal(roles.user_id, 'text');
  assert.equal(roles.sessionId, 'text');
  assert.equal(roles.valid, 'number', '"valid" is not an identifier');
  assert.equal(roles.fluid, 'number');
});

test('profileFields: coded numbers need a name hint or 0/1 values', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    status: [200, 404, 500][i % 3],
    up: i % 2,
    units: [1, 2, 3][i % 3], // integer, low-cardinality, but a real measure
  }));
  const roles = roleMap(rows);
  assert.equal(roles.status, 'category');
  assert.equal(roles.up, 'category');
  assert.equal(roles.units, 'number');
});

test('profileFields: ordered labels may repeat, unordered labels must be unique', () => {
  const hist = DemoHistory(NOW, 30, 60);
  const time = profileFields(hist).find((f) => f.name === 'time');
  assert.equal(time.role, 'label');
  assert.equal(time.ordered, true);
  assert.ok(time.distinct < time.presentCount, 'HH:MM repeats at a 30s sample rate');

  const month = profileFields(NET_WORTH).find((f) => f.name === 'Month');
  assert.deepEqual([month.role, month.ordered], ['label', true]);

  const cat = profileFields(BUDGET).find((f) => f.name === 'Category');
  assert.deepEqual([cat.role, cat.ordered], ['label', false]);
});

test('profileFields: a single row never yields a label', () => {
  const roles = roleMap([DemoMetrics(NOW, STARTED, 'crypt-01')]);
  assert.equal(roles.host, 'text');
  assert.equal(roles.uptime, 'text');
  assert.equal(roles.sampledAt, 'time');
});

test('rankNumbers: rates, then totals/counts, then money, then the rest', () => {
  const names = (rows) => rankNumbers(profileFields(rows)).map((f) => f.name);
  assert.deepEqual(names(DEBTS), ['APR (%)', 'Balance ($)', 'Min Payment ($/mo)']);
  assert.deepEqual(names(BUDGET), ['Budget ($)', 'Actual ($)', 'Difference']);
  assert.deepEqual(names([DemoMetrics(NOW, STARTED, 'crypt-01')]).slice(0, 3), ['cpuPct', 'memPct', 'diskPct']);
  assert.deepEqual(names([{ a: 1, orderCount: 2, b: 3 }, { a: 2, orderCount: 3, b: 4 }]), ['orderCount', 'a', 'b']);
});

// ------------------------------------------------------------
// Widget picking: APP2
// ------------------------------------------------------------
test('APP2 Budget vs Actual: summed KPIs and a bar by category', () => {
  const ws = section(BUDGET, 48, 'Budget vs Actual');
  assert.deepEqual(types(ws), ['label', 'kpi', 'kpi', 'kpi', 'bar', 'table']);
  assert.equal(ws[0].config.text, 'Budget vs Actual');
  assert.deepEqual(byType(ws, 'kpi').map((w) => [w.config.title, w.config.bindings[0].agg, w.config.prefix]), [
    ['Budget ($)', 'sum', '$'], ['Actual ($)', 'sum', '$'], ['Difference', 'sum', ''],
  ]);
  const [bar] = byType(ws, 'bar');
  assert.deepEqual(bar.config.bindings, [{ sourceId: 'src_1', xField: 'Category', yField: 'Budget ($)', agg: 'sum' }]);
});

test('APP2 Net Worth: latest-value KPI and a line over months', () => {
  const ws = section(NET_WORTH);
  assert.deepEqual(types(ws), ['label', 'kpi', 'line', 'table']);
  assert.equal(ws[1].config.bindings[0].agg, 'last', 'net worth is a balance: show the latest');
  assert.deepEqual(ws[2].config.bindings, [{ sourceId: 'src_1', xField: 'Month', yField: 'Net Worth ($)', agg: 'last' }]);
});

test('APP2 Monthly Spending: spending is a flow, so it sums', () => {
  const ws = section(SPENDING);
  assert.deepEqual(types(ws), ['label', 'kpi', 'line', 'table']);
  assert.equal(ws[1].config.bindings[0].agg, 'sum');
  assert.equal(ws[2].config.bindings[0].agg, 'sum');
});

test('APP2 Debts: APR averages, balances sum, bar by debt', () => {
  const ws = section(DEBTS);
  assert.deepEqual(types(ws), ['label', 'kpi', 'kpi', 'kpi', 'bar', 'table']);
  const kpis = byType(ws, 'kpi');
  assert.deepEqual(kpis.map((w) => w.config.bindings[0].agg), ['avg', 'sum', 'sum']);
  assert.equal(kpis[0].config.suffix, '%');
  assert.equal(byType(ws, 'bar')[0].config.bindings[0].yField, 'Balance ($)', 'a bar of averages per row is not useful; use the first non-rate');
});

// ------------------------------------------------------------
// Widget picking: APP1
// ------------------------------------------------------------
test('APP1 history: Pct KPIs show the latest and the line averages repeats', () => {
  const ws = section(DemoHistory(NOW, 30, 60));
  assert.deepEqual(types(ws), ['label', 'kpi', 'kpi', 'kpi', 'line', 'table']);
  assert.deepEqual(byType(ws, 'kpi').map((w) => [w.config.title, w.config.bindings[0].agg]), [
    ['cpuPct', 'last'], ['memPct', 'last'], ['diskPct', 'last'],
  ]);
  const [line] = byType(ws, 'line');
  assert.deepEqual(line.config.bindings.map((b) => [b.xField, b.yField, b.agg]), [
    ['time', 'cpuPct', 'avg'], ['time', 'memPct', 'avg'], ['time', 'diskPct', 'avg'],
  ]);
  assert.equal(line.config.reverseData, false, 'history is oldest-first already');
});

test('APP1 metrics (one row): KPIs and a table, no charts', () => {
  const ws = section([DemoMetrics(NOW, STARTED, 'crypt-01')]);
  assert.deepEqual(types(ws), ['label', 'kpi', 'kpi', 'kpi', 'table']);
  assert.deepEqual(byType(ws, 'kpi').map((w) => w.config.title), ['cpuPct', 'memPct', 'diskPct']);
});

test('APP1 services: no measures, so counts by status', () => {
  const ws = section(DemoServices(NOW));
  assert.deepEqual(types(ws), ['label', 'kpi', 'bar', 'pie', 'table']);
  assert.deepEqual(ws[1].config.bindings[0], { sourceId: 'src_1', xField: '', yField: '', agg: 'count' });
  assert.equal(ws[1].config.title, 'Rows');
  assert.deepEqual(ws[2].config.bindings[0], { sourceId: 'src_1', xField: 'status', yField: '', agg: 'count' });
});

test('APP1 nginx logs: status is never summed, newest-first is reversed', () => {
  const { rows } = ParseLogs(DemoAccessLog(NOW, 100), 'nginx', 100);
  const roles = roleMap(rows);
  assert.equal(roles.status, 'category');
  assert.equal(roles.userAgent, 'category');
  assert.equal(roles.time, 'time');

  const ws = section(rows);
  assert.deepEqual(types(ws), ['label', 'kpi', 'line', 'bar', 'pie', 'table']);
  const [kpi] = byType(ws, 'kpi');
  assert.deepEqual([kpi.config.title, kpi.config.bindings[0].agg], ['bytes', 'sum']);
  const [line] = byType(ws, 'line');
  assert.equal(line.config.reverseData, true);
  assert.deepEqual(line.config.bindings[0], { sourceId: 'src_1', xField: 'time', yField: 'bytes', agg: 'sum' });
  assert.equal(byType(ws, 'bar')[0].config.bindings[0].xField, 'status');
  for (const w of ws) for (const b of w.config.bindings) assert.notEqual(b.yField, 'status');
});

// ------------------------------------------------------------
// Edge shapes
// ------------------------------------------------------------
test('time series: line binds up to three measures over the time field', () => {
  const rows = ['2026-01-01', '2026-01-02', '2026-01-03'].map((date, i) => ({ date, revenue: 100 + i, orders: 5 + i * 3 }));
  const ws = section(rows);
  assert.deepEqual(types(ws), ['label', 'kpi', 'kpi', 'line', 'table']);
  assert.deepEqual(byType(ws, 'line')[0].config.bindings.map((b) => b.yField), ['revenue', 'orders']);
});

test('text only: a row count and the table', () => {
  const rows = [{ note: 'a long free text value that is unique' }, { note: 'another long free text value' }, { note: 'a long free text value that is unique' }];
  assert.deepEqual(types(section(rows)), ['label', 'kpi', 'table']);
});

test('identifier columns only: a row count and the table', () => {
  const rows = [{ id: 1, user_id: 'u1', sessionId: 's1' }, { id: 2, user_id: 'u2', sessionId: 's2' }];
  assert.deepEqual(types(section(rows)), ['label', 'kpi', 'table']);
});

test('zero rows: label plus a "no rows" note', () => {
  const ws = section([]);
  assert.deepEqual(types(ws), ['label', 'text']);
  assert.equal(ws[1].config.body, 'This source returned no rows.');
});

// ------------------------------------------------------------
// Layout and dashboard assembly
// ------------------------------------------------------------
test('layout: bands span the full width, top to bottom', () => {
  const ws = section(BUDGET, 48);
  const rowsOf = new Map();
  ws.forEach((w) => rowsOf.set(w.y, [...(rowsOf.get(w.y) || []), w]));
  for (const band of rowsOf.values()) {
    assert.equal(band.reduce((s, w) => s + w.w, 0), 48);
    assert.equal(band[0].x, 0);
  }
  const ys = [...rowsOf.keys()];
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
});

test('generateDashboard: replace stacks sections and normalizes cleanly', () => {
  const current = { ...newDashboard(), name: 'Money', widgets: [] };
  const { dashboard, error } = generateDashboard(current, [
    { source: { id: 'a', name: 'Budget' }, rows: BUDGET },
    { source: { id: 'b', name: 'Net worth' }, rows: NET_WORTH },
  ], { mode: 'replace', makeId: counter() });
  assert.equal(error, null);
  assert.equal(dashboard.name, 'Money');
  assert.deepEqual(dashboard.grid, current.grid);
  assert.deepEqual(normalizeDashboard(dashboard), dashboard);
  const firstB = dashboard.widgets.find((w) => w.config.text === 'Net worth');
  const bottomA = Math.max(...dashboard.widgets.filter((w) => w.y < firstB.y).map((w) => w.y + w.h));
  assert.equal(firstB.y, bottomA);
});

test('generateDashboard: append keeps existing widgets and goes below them', () => {
  const existing = { id: 'old', type: 'text', x: 0, y: 4, w: 12, h: 6, config: { title: '', body: 'hi', fontSize: 'md', bindings: [] } };
  const current = { ...newDashboard(), widgets: [existing] };
  const { dashboard } = generateDashboard(current, [{ source: { id: 'a', name: 'A' }, rows: DEBTS }], { mode: 'append', makeId: counter() });
  assert.equal(dashboard.widgets[0], existing);
  assert.ok(dashboard.widgets.slice(1).every((w) => w.y >= 10));
});

test('generateDashboard: errors leave the dashboard untouched', () => {
  const current = newDashboard();
  assert.deepEqual(generateDashboard(current, [], { mode: 'replace', makeId: counter() }), { dashboard: current, error: 'no_sources' });

  const full = { ...current, widgets: Array.from({ length: 198 }, (_, i) => ({ id: `w${i}`, type: 'label', x: 0, y: i, w: 1, h: 1, config: {} })) };
  const res = generateDashboard(full, [{ source: { id: 'a', name: 'A' }, rows: BUDGET }], { mode: 'append', makeId: counter() });
  assert.equal(res.error, 'too_many_widgets');
  assert.equal(res.dashboard, full);
});
