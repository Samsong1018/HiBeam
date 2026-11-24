// Combo charts: a bar chart whose series can each draw as bars or a line.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { normalizeDashboard } from '../Web/frontend/scripts/editor/model.js';
import { toTemplate, fillTemplate, parseTemplate } from '../Web/frontend/scripts/editor/template.js';
import { comboAllowed, seriesKind, comboDatasetOptions, normalizeSeriesKind, BAR_ORDER } from '../Web/frontend/scripts/editor/combo.js';

const require = createRequire(import.meta.url);
const { validateDashboardDefinition } = require('../Web/backend/lib/validators.js');

const binding = (extra = {}) => ({ sourceId: 's1', xField: 'month', yField: 'actual', agg: 'sum', ...extra });
const widget = (type, bindings, config = {}) => ({ id: 'w1', type, x: 0, y: 0, w: 16, h: 10, config: { bindings, ...config } });
const board = (...widgets) => ({ name: 'Budget', grid: { columns: 48, showGrid: true }, widgets });
const norm = (w) => normalizeDashboard(board(w)).widgets[0];

test('normalize keeps as: line on bar bindings', () => {
  const w = norm(widget('bar', [binding(), binding({ yField: 'budget', as: 'line' })]));
  assert.equal(w.config.bindings[1].as, 'line');
  assert.equal('as' in w.config.bindings[0], false);
});

test('normalize drops as: bar, junk values and as on other widget types', () => {
  const w = norm(widget('bar', [binding({ as: 'bar' }), binding({ as: 'area' }), binding({ as: 1 }), binding({ as: { x: 1 } })]));
  w.config.bindings.forEach((b) => assert.equal('as' in b, false));
  ['line', 'pie', 'kpi', 'gauge', 'table'].forEach((type) => {
    const other = norm(widget(type, [binding({ as: 'line' })]));
    other.config.bindings.forEach((b) => assert.equal('as' in b, false, type));
  });
  assert.equal(normalizeSeriesKind('bar', 'line'), 'line');
  assert.equal(normalizeSeriesKind('line', 'line'), undefined);
});

test('boards without as normalize exactly as before', () => {
  const w = norm(widget('bar', [binding(), binding({ yField: 'budget' })]));
  assert.deepEqual(w.config.bindings, [binding(), binding({ yField: 'budget' })]);
  // and normalizing twice changes nothing
  const twice = normalizeDashboard(normalizeDashboard(board(widget('bar', [binding(), binding({ as: 'line' })]))));
  assert.deepEqual(twice.widgets[0].config.bindings, [binding(), binding({ as: 'line' })]);
});

test('validators accept as: bar | line and reject anything else', () => {
  const ok = validateDashboardDefinition(board(widget('bar', [binding({ as: 'bar' }), binding({ as: 'line' })])));
  assert.equal(ok.ok, true);
  assert.equal(validateDashboardDefinition(board(widget('bar', [binding({ as: 'area' })]))).ok, false);
  assert.equal(validateDashboardDefinition(board(widget('bar', [binding({ as: 1 })]))).ok, false);
  assert.equal(validateDashboardDefinition(board(widget('bar', [binding()]))).ok, true);
});

test('validator output keeps as (save does not strip it)', () => {
  const def = board(widget('bar', [binding(), binding({ as: 'line' })]));
  const result = validateDashboardDefinition(def);
  assert.equal(result.ok, true);
  assert.equal(result.value.widgets[0].config.bindings[1].as, 'line');
});

test('template export and import keep as', () => {
  const def = board(widget('bar', [binding(), binding({ yField: 'budget', as: 'line' })]));
  const { definition } = toTemplate(def, () => 'Finance');
  assert.equal(definition.widgets[0].config.bindings[0].sourceId, '{{finance}}');
  assert.equal(definition.widgets[0].config.bindings[1].as, 'line');
  const parsed = parseTemplate(JSON.stringify(definition));
  const filled = fillTemplate(parsed, { '{{finance}}': 's9' });
  const back = normalizeDashboard(filled).widgets[0].config.bindings;
  assert.deepEqual(back.map((b) => [b.sourceId, b.as]), [['s9', undefined], ['s9', 'line']]);
});

test('comboAllowed: vertical bar with 2+ series only', () => {
  assert.equal(comboAllowed(widget('bar', [binding(), binding()])), true);
  assert.equal(comboAllowed(widget('bar', [binding()])), false);
  assert.equal(comboAllowed(widget('bar', [binding(), binding()], { horizontal: true })), false);
  assert.equal(comboAllowed(widget('line', [binding(), binding()])), false);
});

test('seriesKind: horizontal, single series and non-bar widgets ignore as', () => {
  const bindings = [binding(), binding({ as: 'line' })];
  assert.deepEqual([0, 1].map((i) => seriesKind(widget('bar', bindings), i, 2)), ['bar', 'line']);
  assert.deepEqual([0, 1].map((i) => seriesKind(widget('bar', bindings, { horizontal: true }), i, 2)), ['bar', 'bar']);
  assert.equal(seriesKind(widget('bar', [binding({ as: 'line' })]), 0, 1), 'bar');
  assert.equal(seriesKind(widget('line', bindings), 1, 2), 'bar');
});

test('comboDatasetOptions: line series is a straight unfilled line on top, in its own stack', () => {
  const bindings = [binding(), binding({ as: 'line' }), binding({ as: 'line' })];
  const w = widget('bar', bindings, { stacked: true });
  const opts = [0, 1, 2].map((i) => comboDatasetOptions(w, i, 3));
  assert.deepEqual(opts[0], {}, 'bars get nothing extra');
  [opts[1], opts[2]].forEach((o) => {
    assert.equal(o.type, 'line');
    assert.equal(o.fill, false);
    assert.equal(o.tension, 0);
    assert.ok(o.order < BAR_ORDER, 'line draws over the bars');
    assert.ok(o.pointRadius > 0 && o.pointRadius <= 3);
  });
  // two lines never share a stack with each other or with the bars (bars have no stack key)
  assert.notEqual(opts[1].stack, opts[2].stack);
  assert.ok(opts[1].stack && opts[2].stack);
});

test('comboDatasetOptions: horizontal bars ignore as', () => {
  const w = widget('bar', [binding(), binding({ as: 'line' })], { horizontal: true, stacked: true });
  assert.deepEqual(comboDatasetOptions(w, 1, 2), {});
});
