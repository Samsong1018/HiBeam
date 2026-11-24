// Unit + property tests for "gone quiet" detection (Web/frontend/scripts/editor/quiet.js)
// and the public projection carrying the quiet check's time column.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fc from 'fast-check';

import { parseTime, findTimeField, lastSeen, staleState, normalizeQuietConfig, ageText, quietText } from '../Web/frontend/scripts/editor/quiet.js';
import { normalizeDashboard } from '../Web/frontend/scripts/editor/model.js';

const require = createRequire(import.meta.url);
const { AllowedFields } = require('../Web/backend/lib/public-projection.js');

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const MIN = 60000;

test('parseTime reads ISO, epoch seconds/ms and nginx timestamps', () => {
  assert.equal(parseTime('2026-11-24T12:00:00.000Z'), NOW);
  assert.equal(parseTime('2026-11-24 12:00:00Z'), NOW);
  assert.equal(parseTime(NOW), NOW);
  assert.equal(parseTime(NOW / 1000), NOW);
  assert.equal(parseTime(String(NOW / 1000)), NOW);
  assert.equal(parseTime('24/Nov/2026:13:00:00 +0100'), NOW);
  assert.equal(parseTime('24/Nov/2026:12:00:00'), NOW);
});

test('parseTime refuses values that carry no date', () => {
  ['14:05', '42', 42, 'Nov', '', '   ', null, undefined, true, {}, 'cpu 42%', '2026-13-45T99:99'].forEach((v) => {
    assert.equal(parseTime(v), null, `${JSON.stringify(v)} should not parse`);
  });
});

test('findTimeField picks the timestamp column, not clock labels or numbers', () => {
  const rows = [
    { time: '11:58', cpuPct: 12, sampledAt: '2026-11-24T11:58:00Z' },
    { time: '11:59', cpuPct: 14, sampledAt: '2026-11-24T11:59:00Z' },
  ];
  assert.equal(findTimeField(rows), 'sampledAt');
  assert.equal(findTimeField([{ time: '11:58', cpu: 1 }]), '');
  assert.equal(findTimeField([]), '');
  assert.equal(findTimeField(null), '');
});

test('lastSeen is the newest timestamp regardless of row order', () => {
  const rows = [{ at: '2026-11-24T10:00:00Z' }, { at: '2026-11-24T11:30:00Z' }, { at: '2026-11-24T09:00:00Z' }, { at: 'junk' }];
  assert.equal(lastSeen(rows, 'at'), Date.UTC(2026, 10, 24, 11, 30));
  assert.equal(lastSeen(rows, ''), null);
  assert.equal(lastSeen(rows, 'missing'), null);
});

test('staleState: off by default, quiet past the window, fine inside it', () => {
  const rows = [{ sampledAt: new Date(NOW - 20 * MIN).toISOString(), v: 1 }];
  assert.equal(staleState(rows, {}, NOW).quiet, false);
  assert.equal(staleState(rows, { quietAfter: 15 }, NOW).quiet, true);
  assert.equal(staleState(rows, { quietAfter: 60 }, NOW).quiet, false);
  const st = staleState(rows, { quietAfter: 15 }, NOW);
  assert.equal(st.field, 'sampledAt');
  assert.equal(st.lastSeen, NOW - 20 * MIN);
});

test('staleState never calls a board without dates quiet', () => {
  assert.equal(staleState([{ time: '03:00', cpu: 5 }], { quietAfter: 5 }, NOW).quiet, false);
  assert.equal(staleState([], { quietAfter: 5 }, NOW).quiet, false);
});

test('staleState honours an explicit quietField', () => {
  const rows = [{ a: new Date(NOW - 2 * MIN).toISOString(), b: new Date(NOW - 90 * MIN).toISOString() }];
  assert.equal(staleState(rows, { quietAfter: 60, quietField: 'a' }, NOW).quiet, false);
  assert.equal(staleState(rows, { quietAfter: 60, quietField: 'b' }, NOW).quiet, true);
});

test('property: quiet exactly when the newest row is older than the window', () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 0, max: 60 * 24 * 40 }), { minLength: 1, maxLength: 30 }),
    fc.constantFrom(5, 15, 60, 1440, 10080, 44640),
    (agesMin, window) => {
      const rows = agesMin.map((m) => ({ at: new Date(NOW - m * MIN).toISOString() }));
      const youngest = Math.min(...agesMin);
      return staleState(rows, { quietAfter: window }, NOW).quiet === youngest > window;
    },
  ));
});

test('normalizeQuietConfig only keeps offered windows and caps the field', () => {
  assert.deepEqual(normalizeQuietConfig({ quietAfter: 15, quietField: 'at' }), { quietAfter: 15, quietField: 'at' });
  assert.deepEqual(normalizeQuietConfig({ quietAfter: 7, quietField: 3 }), { quietAfter: 0, quietField: '' });
  assert.deepEqual(normalizeQuietConfig({ quietAfter: '60' }), { quietAfter: 60, quietField: '' });
  assert.equal(normalizeQuietConfig({ quietField: 'x'.repeat(500) }).quietField.length, 120);
  assert.deepEqual(normalizeQuietConfig(null), { quietAfter: 0, quietField: '' });
});

test('normalizeDashboard cleans quiet settings on data widgets', () => {
  const dash = normalizeDashboard({ widgets: [
    { id: 'k', type: 'kpi', x: 0, y: 0, w: 4, h: 4, config: { quietAfter: 9999, quietField: 'sampledAt' } },
    { id: 'l', type: 'label', x: 0, y: 4, w: 4, h: 2, config: { quietAfter: 15 } },
  ] });
  assert.equal(dash.widgets[0].config.quietAfter, 0);
  assert.equal(dash.widgets[0].config.quietField, 'sampledAt');
  assert.ok(!('quietAfter' in dash.widgets[1].config), 'static widgets have no quiet check');
});

test('ageText and quietText wording', () => {
  assert.equal(ageText(10_000), 'under a minute');
  assert.equal(ageText(12 * MIN), '12 min');
  assert.equal(ageText(3 * 60 * MIN), '3 h');
  assert.equal(ageText(3 * 24 * 60 * MIN), '3 days');
  assert.equal(quietText('stale', NOW - 12 * MIN, NOW).detail, 'No new rows · last heard 12 min ago');
  assert.match(quietText('unreachable', NOW - 2 * MIN, NOW).detail, /^Can't reach the source/);
  assert.equal(quietText('stale', null, NOW).title, 'Gone quiet');
});

test('public projection sends the quiet time column only when the check is on', () => {
  const def = { widgets: [
    { type: 'kpi', config: { quietAfter: 15, quietField: 'sampledAt', bindings: [{ sourceId: 's1', yField: 'cpuPct' }] } },
    { type: 'kpi', config: { quietAfter: 0, quietField: 'secret', bindings: [{ sourceId: 's2', yField: 'memPct' }] } },
  ] };
  const allowed = AllowedFields(def);
  assert.deepEqual([...allowed.get('s1')].sort(), ['cpuPct', 'sampledAt']);
  assert.deepEqual([...allowed.get('s2')], ['memPct']);
});
