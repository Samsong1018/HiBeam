// Unit tests for the Gauge and Uptime strip widgets
// (Web/frontend/scripts/editor/gauge.js, status-strip.js) and how the
// model, templates and public projection treat them.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { gaugeFraction, gaugeTone, normalizeGaugeConfig } from '../Web/frontend/scripts/editor/gauge.js';
import { statusStrips, normalizeStatusConfig, uptimeText, SLOT_OPTIONS } from '../Web/frontend/scripts/editor/status-strip.js';
import { WIDGET_TYPES, PALETTE_ORDER, isDataWidget } from '../Web/frontend/scripts/editor/widget-types.js';
import { normalizeDashboard } from '../Web/frontend/scripts/editor/model.js';
import { toTemplate, templateSlots, fillTemplate, suggestMapping } from '../Web/frontend/scripts/editor/template.js';

const require = createRequire(import.meta.url);
const { AllowedFields } = require('../Web/backend/lib/public-projection.js');
const { validateDashboardDefinition } = require('../Web/backend/lib/validators.js');

const board = (type, config = {}) => normalizeDashboard({
  widgets: [{ id: 'w1', type, x: 0, y: 0, w: 10, h: 8, config }],
}).widgets[0];

// ------------------------------------------------------------
// Registry
// ------------------------------------------------------------
test('gauge and status are registered data widgets after kpi', () => {
  for (const type of ['gauge', 'status']) {
    const def = WIDGET_TYPES[type];
    assert.ok(def, type);
    assert.equal(def.maxBindings, 1);
    assert.ok(isDataWidget(type));
    assert.ok('quietAfter' in def.defaults && 'quietField' in def.defaults && 'refresh' in def.defaults);
  }
  const at = PALETTE_ORDER.indexOf('kpi');
  assert.deepEqual(PALETTE_ORDER.slice(at, at + 3), ['kpi', 'gauge', 'status']);
  assert.equal(WIDGET_TYPES.gauge.label, 'Gauge');
  assert.equal(WIDGET_TYPES.status.label, 'Uptime strip');
});

// ------------------------------------------------------------
// Gauge
// ------------------------------------------------------------
test('gaugeFraction fills proportionally and clamps to the range', () => {
  assert.equal(gaugeFraction(50, 0, 100), 0.5);
  assert.equal(gaugeFraction(0, 0, 100), 0);
  assert.equal(gaugeFraction(100, 0, 100), 1);
  assert.equal(gaugeFraction(150, 0, 100), 1, 'past max fills to the end');
  assert.equal(gaugeFraction(-20, 0, 100), 0, 'below min stays empty');
  assert.equal(gaugeFraction(15, 10, 20), 0.5);
  assert.equal(gaugeFraction(-5, -10, 0), 0.5);
  assert.equal(gaugeFraction('75%', 0, 100), 0.75, 'numeric strings parse like elsewhere');
});

test('gaugeFraction handles empty, backwards and non-finite input', () => {
  assert.equal(gaugeFraction(5, 10, 10), null, 'min == max');
  assert.equal(gaugeFraction(5, 100, 0), null, 'min > max');
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, '', 'n/a', {}]) {
    assert.equal(gaugeFraction(bad, 0, 100), null, `value ${String(bad)}`);
    assert.equal(gaugeFraction(50, bad, 100), null, `min ${String(bad)}`);
    assert.equal(gaugeFraction(50, 0, bad), null, `max ${String(bad)}`);
  }
});

test('gaugeTone reuses the KPI thresholds on the real value', () => {
  const cfg = { warnAt: 70, alertAt: 90 };
  assert.equal(gaugeTone(40, cfg), 'ok');
  assert.equal(gaugeTone(70, cfg), 'warn');
  assert.equal(gaugeTone(250, cfg), 'danger', 'unclamped value trips the alert');
  assert.equal(gaugeTone(500, { warnAt: 1000, alertAt: 0, higherIs: 'good' }), 'warn');
  assert.equal(gaugeTone(50, {}), null, 'no thresholds: no tone, widget colour');
  assert.equal(gaugeTone('n/a', cfg), null);
});

test('model normalizes gauge config; invalid values fall back to defaults', () => {
  const fresh = board('gauge');
  assert.equal(fresh.config.min, 0);
  assert.equal(fresh.config.max, 100);
  assert.equal(fresh.config.higherIs, 'bad');
  assert.equal(fresh.config.warnAt, null);

  const bad = board('gauge', { min: 'x', max: 5, decimals: 9, prefix: 'x'.repeat(50), warnAt: 'nope', alertAt: '90', higherIs: 'weird', reverseData: 'yes', quietAfter: 7, refresh: 5 });
  assert.equal(bad.config.min, 0);
  assert.equal(bad.config.max, 5);
  assert.equal(bad.config.decimals, 0);
  assert.equal(bad.config.prefix.length, 8);
  assert.equal(bad.config.warnAt, null);
  assert.equal(bad.config.alertAt, 90);
  assert.equal(bad.config.higherIs, 'bad');
  assert.equal(bad.config.reverseData, false);
  assert.equal(bad.config.quietAfter, 0);
  assert.equal(bad.config.refresh, 0);

  assert.deepEqual([board('gauge', { min: 50, max: 10 }).config.min, board('gauge', { min: 50, max: 10 }).config.max], [0, 100], 'backwards range resets');
  assert.deepEqual([board('gauge', { min: -5, max: 5 }).config.min, board('gauge', { min: -5, max: 5 }).config.max], [-5, 5]);
  assert.equal(board('gauge', { decimals: 2 }).config.decimals, 2);
  assert.equal(normalizeGaugeConfig(null).max, 100);
  assert.ok(!('showDelta' in board('gauge').config), 'KPI-only settings stay off the gauge');
  assert.equal(board('gauge', { bindings: [{ sourceId: 's' }, { sourceId: 't' }] }).config.bindings.length, 1);
});

// ------------------------------------------------------------
// Uptime strip
// ------------------------------------------------------------
const FIELDS = { xField: 'service', yField: 'status' };

test('statusStrips groups by service in first-seen order, oldest to newest, padded with empties', () => {
  const rows = [
    { service: 'api', status: 'up' },
    { service: 'db', status: 'down' },
    { service: 'api', status: 'down' },
    { service: 'api', status: 'up' },
  ];
  const [api, db] = statusStrips(rows, { ...FIELDS, slots: 15 });
  assert.equal(api.name, 'api');
  assert.equal(db.name, 'db');
  assert.equal(api.slots.length, 15);
  assert.deepEqual(api.slots.slice(-3).map((s) => s.value), ['up', 'down', 'up']);
  assert.ok(api.slots.slice(0, 12).every((s) => s === null), 'missing checks on the left are empty');
  assert.deepEqual(api.slots.slice(-3).map((s) => s.tone), ['ok', 'danger', 'ok']);
  assert.equal(db.slots[14].tone, 'danger');
});

test('statusStrips keeps only the newest `slots` checks per service', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ service: 'web', status: i < 10 ? 'down' : 'up' }));
  const [web] = statusStrips(rows, { ...FIELDS, slots: 30 });
  assert.equal(web.slots.length, 30);
  assert.ok(web.slots.every((s) => s && s.tone === 'ok'), 'the 10 oldest (down) rows are cut');
  assert.equal(web.uptime, 1);
  const bad = statusStrips(rows, { ...FIELDS, slots: 7 })[0];
  assert.equal(bad.slots.length, 30, 'an off-menu slot count means the default');
  assert.deepEqual(SLOT_OPTIONS, [15, 30, 60, 90]);
});

test('statusStrips orders by the time column and drops rows whose time does not parse', () => {
  const rows = [
    { service: 'api', status: 'up', at: '2026-11-24T10:02:00Z' },
    { service: 'api', status: 'down', at: '2026-11-24T10:00:00Z' },
    { service: 'api', status: 'degraded', at: 'whenever' },
    { service: 'api', status: 'active', at: '2026-11-24T10:01:00Z' },
  ];
  const [api] = statusStrips(rows, { ...FIELDS, timeField: 'at', slots: 15 });
  assert.deepEqual(api.slots.filter(Boolean).map((s) => s.value), ['down', 'active', 'up']);
  assert.equal(api.slots[14].at, Date.parse('2026-11-24T10:02:00Z'));
  // without a time column the row order stands
  const [plain] = statusStrips(rows, { ...FIELDS, slots: 15 });
  assert.deepEqual(plain.slots.filter(Boolean).map((s) => s.value), ['up', 'down', 'degraded', 'active']);
  // a time column with nothing parseable falls back to row order instead of showing nothing
  const [fallback] = statusStrips(rows, { ...FIELDS, timeField: 'status', slots: 15 });
  assert.equal(fallback.filled, 4);
});

test('uptime counts OK slots out of non-empty ones; blanks and unknown statuses', () => {
  const rows = [
    { service: 'api', status: 'up' },
    { service: 'api', status: '' },
    { service: 'api', status: null },
    { service: 'api', status: 'down' },
    { service: 'api', status: 'banana' },
    { service: 'api', status: 'ok' },
  ];
  const [api] = statusStrips(rows, { ...FIELDS, slots: 15 });
  assert.equal(api.filled, 4, 'blank statuses are empty slots');
  assert.equal(api.ok, 2);
  assert.equal(api.uptime, 0.5);
  const unknown = api.slots.find((s) => s?.value === 'banana');
  assert.equal(unknown.tone, 'unknown', 'a value with no meaning is not ok and not empty');
  assert.equal(statusStrips([{ service: 'x', status: '' }], FIELDS)[0].uptime, null);
});

test('HTTP codes in a status column tone like everywhere else', () => {
  const rows = [200, 301, 404, 503].map((status) => ({ service: 'site', status }));
  const [site] = statusStrips(rows, { ...FIELDS, slots: 15 });
  assert.deepEqual(site.slots.filter(Boolean).map((s) => s.tone), ['ok', 'info', 'warn', 'danger']);
  assert.equal(site.uptime, 0.5); // 200 and the 301 redirect count as up
});

test('statusStrips ignores junk rows and names blank services', () => {
  const rows = [null, 'x', { service: '', status: 'up' }, { status: 'up' }];
  const strips = statusStrips(rows, FIELDS);
  assert.deepEqual(strips.map((s) => s.name), ['(blank)']);
  assert.equal(strips[0].filled, 2);
  assert.deepEqual(statusStrips(null, FIELDS), []);
  assert.deepEqual(statusStrips(rows, { xField: '', yField: 'status' }), []);
});

test('uptimeText never rounds a miss up to 100%', () => {
  assert.equal(uptimeText(1), '100%');
  assert.equal(uptimeText(0.9999), '99.9%');
  assert.equal(uptimeText(0.995), '99.5%');
  assert.equal(uptimeText(0.876), '87%');
  assert.equal(uptimeText(0), '0%');
  assert.equal(uptimeText(null), '—');
});

test('model normalizes status config; invalid values fall back to defaults', () => {
  const fresh = board('status');
  assert.equal(fresh.config.slots, 30);
  assert.equal(fresh.config.timeField, '');
  assert.equal(board('status', { slots: 90 }).config.slots, 90);
  for (const slots of [7, null, 1e9, NaN, 'lots']) assert.equal(board('status', { slots }).config.slots, 30, String(slots));
  assert.equal(board('status', { slots: '60' }).config.slots, 60, 'a numeric string reads like quietAfter does');
  assert.equal(board('status', { timeField: 42 }).config.timeField, '');
  assert.equal(board('status', { timeField: 'x'.repeat(500) }).config.timeField.length, 120);
  assert.equal(board('status', { timeField: 'checkedAt' }).config.timeField, 'checkedAt');
  assert.deepEqual(normalizeStatusConfig(undefined), { slots: 30, timeField: '', reverseData: false });
});

// ------------------------------------------------------------
// Templates, public links, saving
// ------------------------------------------------------------
const DEF = {
  name: 'Homelab',
  grid: { columns: 48, showGrid: true },
  widgets: [
    { id: 'w_up', type: 'status', x: 0, y: 0, w: 18, h: 8, config: { title: 'Uptime', slots: 60, timeField: 'checkedAt', bindings: [{ sourceId: 'src_checks', xField: 'service', yField: 'state', agg: 'sum' }] } },
    { id: 'w_cpu', type: 'gauge', x: 18, y: 0, w: 10, h: 8, config: { title: 'CPU', max: 100, suffix: '%', warnAt: 70, alertAt: 90, bindings: [{ sourceId: 'src_metrics', yField: 'cpuPct', agg: 'last' }] } },
  ],
};

test('template round-trip keeps a status widget and lists its time column as a needed field', () => {
  const names = { src_checks: 'Service checks', src_metrics: 'Metrics' };
  const { definition, sources } = toTemplate(DEF, (id) => names[id] || null);
  assert.deepEqual(sources, { 'service-checks': 'Service checks', metrics: 'Metrics' });
  assert.equal(definition.widgets[0].config.bindings[0].sourceId, '{{service-checks}}');

  const slots = templateSlots(definition);
  const checks = slots.find((s) => s.label === 'service-checks');
  assert.deepEqual(checks.fields.sort(), ['checkedAt', 'service', 'state']);
  assert.deepEqual(slots.find((s) => s.label === 'metrics').fields, ['cpuPct']);

  const mine = [{ id: 'a1', name: 'service checks' }, { id: 'a2', name: 'metrics' }];
  const filled = normalizeDashboard(JSON.parse(JSON.stringify(fillTemplate(definition, suggestMapping(slots, mine)))));
  const [status, gauge] = filled.widgets;
  assert.equal(status.type, 'status');
  assert.equal(status.config.slots, 60);
  assert.equal(status.config.timeField, 'checkedAt');
  assert.deepEqual(status.config.bindings[0], { sourceId: 'a1', xField: 'service', yField: 'state', agg: 'sum' });
  assert.equal(gauge.type, 'gauge');
  assert.equal(gauge.config.bindings[0].sourceId, 'a2');
  assert.equal(gauge.config.alertAt, 90);
});

test('public links get the strip\'s time column; the backend accepts both types', () => {
  const allowed = AllowedFields(DEF);
  assert.deepEqual([...allowed.get('src_checks')].sort(), ['checkedAt', 'service', 'state']);
  assert.deepEqual([...allowed.get('src_metrics')], ['cpuPct']);
  const result = validateDashboardDefinition(DEF);
  assert.ok(!result?.error, JSON.stringify(result?.error));
});
