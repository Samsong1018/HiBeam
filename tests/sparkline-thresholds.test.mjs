// Unit tests for the KPI sparkline points and line-chart reference lines
// (pure modules, no DOM). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { sparklinePoints, normalizeKpiConfig, SPARK_MAX_POINTS } from '../Web/frontend/scripts/editor/kpi.js';
import { normalizeThresholds, thresholdBounds, MAX_THRESHOLDS } from '../Web/frontend/scripts/editor/data.js';
import { normalizeDashboard } from '../Web/frontend/scripts/editor/model.js';
import { WIDGET_TYPES } from '../Web/frontend/scripts/editor/widget-types.js';

const parse = (points) => points.split(' ').map((p) => p.split(',').map(Number));

// ------------------------------------------------------------
// sparklinePoints
// ------------------------------------------------------------
test('sparkline: oldest left, newest right, higher values nearer the top', () => {
  const pts = parse(sparklinePoints([0, 5, 10], 100, 20, { pad: 0 }));
  assert.deepEqual(pts, [[0, 20], [50, 10], [100, 0]]);
});

test('sparkline: pad keeps the stroke inside the box', () => {
  const pts = parse(sparklinePoints([1, 3], 100, 24, { pad: 2 }));
  assert.deepEqual(pts, [[0, 22], [100, 2]]);
});

test('sparkline: a flat series is a flat line at mid-height', () => {
  const pts = parse(sparklinePoints([7, 7, 7, 7], 100, 24));
  assert.equal(pts.length, 4);
  assert.ok(pts.every(([, y]) => y === 12));
});

test('sparkline: non-numeric values are dropped, numeric strings kept', () => {
  const pts = parse(sparklinePoints([1, 'n/a', null, undefined, NaN, '3', Infinity], 100, 10, { pad: 0 }));
  assert.deepEqual(pts, [[0, 10], [100, 0]]);
});

test('sparkline: fewer than 2 numbers means nothing to draw', () => {
  assert.equal(sparklinePoints([], 100, 24), null);
  assert.equal(sparklinePoints([5], 100, 24), null);
  assert.equal(sparklinePoints([5, 'x', null], 100, 24), null);
  assert.equal(sparklinePoints(null, 100, 24), null);
  assert.equal(sparklinePoints([1, 2], 0, 24), null, 'no box, no line');
});

test('sparkline: long series are thinned, keeping the first and newest value', () => {
  const values = Array.from({ length: 1000 }, (_, i) => i);
  values[999] = 5000; // a spike on the newest row must survive
  const pts = parse(sparklinePoints(values, 100, 24, { pad: 0 }));
  assert.equal(pts.length, SPARK_MAX_POINTS);
  assert.deepEqual(pts[0], [0, 24]);
  assert.deepEqual(pts.at(-1), [100, 0]);
  assert.equal(parse(sparklinePoints(values, 100, 24, { maxPoints: 10 })).length, 10);
});

test('property: sparkline points stay inside the box and x only goes forward', () => {
  fc.assert(fc.property(
    fc.array(fc.oneof(fc.double({ noDefaultInfinity: true, min: -1e9, max: 1e9 }), fc.constant('x'), fc.constant(null)), { maxLength: 300 }),
    (values) => {
      const out = sparklinePoints(values, 100, 24);
      const numeric = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
      if (numeric.length < 2) return out === null;
      const pts = parse(out);
      return pts.length <= SPARK_MAX_POINTS
        && pts.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 24)
        && pts.every(([x], i) => i === 0 || x > pts[i - 1][0]);
    },
  ));
});

test('sparkline config is off by default and only a real true turns it on', () => {
  assert.equal(WIDGET_TYPES.kpi.defaults.sparkline, false);
  assert.equal(normalizeKpiConfig({}).sparkline, false);
  assert.equal(normalizeKpiConfig({ sparkline: 'yes' }).sparkline, false);
  assert.equal(normalizeKpiConfig({ sparkline: true }).sparkline, true);
});

// ------------------------------------------------------------
// Reference lines
// ------------------------------------------------------------
test('thresholds: drops non-finite values, clamps to 3, caps labels, fixes tones', () => {
  const out = normalizeThresholds([
    { value: 90, label: 'CPU limit', tone: 'danger' },
    { value: 'lots', label: 'gone' },
    { value: null },
    { value: '75', label: 'x'.repeat(40), tone: 'purple' },
    'junk',
    { value: 50, tone: 'ok', label: 7 },
    { value: 10, label: 'fourth' },
  ]);
  assert.deepEqual(out, [
    { value: 90, label: 'CPU limit', tone: 'danger' },
    { value: 75, label: 'x'.repeat(24), tone: 'warn' },
    { value: 50, label: '', tone: 'ok' },
  ]);
  assert.equal(out.length, MAX_THRESHOLDS);
});

test('thresholds: anything that is not a list is an empty list', () => {
  assert.deepEqual(normalizeThresholds(undefined), []);
  assert.deepEqual(normalizeThresholds({ value: 1 }), []);
  assert.deepEqual(normalizeThresholds([{ value: Infinity }, { value: '' }]), []);
});

test('normalizeDashboard: line charts get thresholds, defaulting to []', () => {
  const dash = normalizeDashboard({
    name: 'x', grid: { columns: 48, showGrid: true },
    widgets: [
      { id: 'a', type: 'line', x: 0, y: 0, w: 16, h: 10, config: {} },
      { id: 'b', type: 'line', x: 0, y: 10, w: 16, h: 10, config: { thresholds: [{ value: 80, tone: 'nope' }, { value: 'x' }] } },
      { id: 'c', type: 'bar', x: 0, y: 20, w: 16, h: 10, config: { thresholds: [{ value: 1 }] } },
      { id: 'k', type: 'kpi', x: 0, y: 30, w: 10, h: 6, config: { sparkline: true } },
    ],
  });
  const [a, b, c, k] = dash.widgets;
  assert.deepEqual(a.config.thresholds, []);
  assert.deepEqual(b.config.thresholds, [{ value: 80, label: '', tone: 'warn' }]);
  assert.equal('thresholds' in WIDGET_TYPES.bar.defaults, false);
  assert.ok(c.config.thresholds === undefined || Array.isArray(c.config.thresholds), 'bar ignores it');
  assert.equal(k.config.sparkline, true);
});

test('thresholdBounds: covers every line with a little headroom', () => {
  const b = thresholdBounds([{ value: 90 }, { value: 70 }]);
  assert.ok(b.suggestedMax > 90 && b.suggestedMax <= 92);
  assert.ok(b.suggestedMin < 70 && b.suggestedMin >= 68);
  assert.equal(thresholdBounds([]), null);
  assert.equal(thresholdBounds([{ value: NaN }]), null);
});

test('thresholdBounds: padding never drags a positive line below zero (or negative above)', () => {
  const zero = thresholdBounds([{ value: 0 }]);
  assert.equal(zero.suggestedMin, 0);
  assert.ok(zero.suggestedMax >= 0);
  assert.ok(thresholdBounds([{ value: 0.01 }, { value: 50 }]).suggestedMin >= 0);
  const neg = thresholdBounds([{ value: -10 }, { value: -2 }]);
  assert.ok(neg.suggestedMax <= 0 && neg.suggestedMin < -10);
  const mixed = thresholdBounds([{ value: -5 }, { value: 5 }]);
  assert.ok(mixed.suggestedMin < -5 && mixed.suggestedMax > 5);
});
