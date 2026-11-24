// Unit + property tests for KPI thresholds and deltas (Web/frontend/scripts/editor/kpi.js).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { kpiStatus, kpiDelta, deltaTone, normalizeKpiConfig } from '../Web/frontend/scripts/editor/kpi.js';
import { normalizeDashboard } from '../Web/frontend/scripts/editor/model.js';

test('higher is bad: CPU crosses warn then alert', () => {
  const cfg = { warnAt: 70, alertAt: 85 };
  assert.equal(kpiStatus(40, cfg), 'ok');
  assert.equal(kpiStatus(70, cfg), 'warn', 'reaching the threshold trips it');
  assert.equal(kpiStatus(90, cfg), 'alert');
});

test('higher is good: savings below the floor alert', () => {
  const cfg = { warnAt: 1000, alertAt: 0, higherIs: 'good' };
  assert.equal(kpiStatus(5000, cfg), 'ok');
  assert.equal(kpiStatus(800, cfg), 'warn');
  assert.equal(kpiStatus(-20, cfg), 'alert');
});

test('no thresholds, or a non-number value, means no status', () => {
  assert.equal(kpiStatus(99, {}), null);
  assert.equal(kpiStatus(99, { warnAt: null, alertAt: '' }), null);
  assert.equal(kpiStatus('n/a', { alertAt: 1 }), null);
});

test('one threshold on its own works', () => {
  assert.equal(kpiStatus(5, { alertAt: 4 }), 'alert');
  assert.equal(kpiStatus(3, { alertAt: 4 }), 'ok');
  assert.equal(kpiStatus(5, { warnAt: 4 }), 'warn');
});

test('delta follows the aggregation', () => {
  assert.equal(kpiDelta([100, 120, 150], 'last'), 30);
  assert.equal(kpiDelta([10, 20, 5], 'sum'), 5, 'sum: the newest row is the change');
  assert.equal(kpiDelta([1, 2, 3], 'max'), 1);
  assert.equal(kpiDelta([7], 'last'), null, 'nothing to compare with one row');
  assert.equal(kpiDelta([1, 2], 'count'), null);
  assert.equal(kpiDelta(['$1,000', '$1,200'], 'last'), 200, 'money strings parse');
});

test('delta tone depends on which way is better', () => {
  assert.equal(deltaTone(30, { higherIs: 'good' }), 'good');
  assert.equal(deltaTone(30, { higherIs: 'bad' }), 'bad');
  assert.equal(deltaTone(-5, {}), 'good', 'default: higher is bad, so a drop is good');
  assert.equal(deltaTone(0, {}), 'flat');
  assert.equal(deltaTone(null, {}), 'flat');
});

test('normalizeDashboard cleans KPI threshold settings from the server', () => {
  const dash = normalizeDashboard({
    name: 'x', grid: { columns: 48, showGrid: true },
    widgets: [{ id: 'k', type: 'kpi', x: 0, y: 0, w: 10, h: 6, config: { warnAt: '70', alertAt: 'lots', higherIs: 'sideways', showDelta: 'yes' } }],
  });
  const { config } = dash.widgets[0];
  assert.equal(config.warnAt, 70);
  assert.equal(config.alertAt, null);
  assert.equal(config.higherIs, 'bad');
  assert.equal(config.showDelta, false, 'only a real true turns it on');
});

test('property: status is monotone when higher is bad', () => {
  const rank = { ok: 0, warn: 1, alert: 2 };
  fc.assert(fc.property(
    fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }),
    fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }),
    fc.double({ noNaN: true, noDefaultInfinity: true, min: 0, max: 1e6 }),
    (value, warnAt, gap) => {
      const cfg = { warnAt, alertAt: warnAt + gap };
      return rank[kpiStatus(value, cfg)] <= rank[kpiStatus(value + 1, cfg)];
    },
  ));
});

test('property: normalizeKpiConfig always yields finite-or-null thresholds', () => {
  fc.assert(fc.property(fc.anything(), fc.anything(), (warnAt, alertAt) => {
    const c = normalizeKpiConfig({ warnAt, alertAt });
    return [c.warnAt, c.alertAt].every((v) => v === null || Number.isFinite(v));
  }));
});
