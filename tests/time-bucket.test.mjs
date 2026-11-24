// Unit + property tests for line/bar "Group by time" (time bucketing in
// Web/frontend/scripts/editor/data.js). Bucket boundaries are local time, so
// fixtures are built with the local Date constructor. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  parseTime, bucketStart, nextBucket, bucketLabel, bucketSeries, mergeTimeSeries,
  TIME_BUCKETS, MAX_FILLED_BUCKETS,
} from '../Web/frontend/scripts/editor/data.js';
import { normalizeDashboard } from '../Web/frontend/scripts/editor/model.js';
import { WIDGET_TYPES } from '../Web/frontend/scripts/editor/widget-types.js';
import { generateSection } from '../Web/frontend/scripts/editor/generator.js';

const local = (...args) => new Date(...args).getTime();
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;
const HOUR = 60 * MIN;

// ------------------------------------------------------------
// parseTime
// ------------------------------------------------------------
test('parseTime reads ISO, date-only (local midnight), epoch s/ms and nginx', () => {
  const t = Date.UTC(2026, 10, 24, 12, 0, 0);
  assert.equal(parseTime('2026-11-24T12:00:00Z'), t);
  assert.equal(parseTime('2026-11-24T12:00:00.000Z'), t);
  assert.equal(parseTime('2026-11-24 12:00:00Z'), t);
  assert.equal(parseTime(t), t);
  assert.equal(parseTime(t / 1000), t);
  assert.equal(parseTime(String(t / 1000)), t);
  assert.equal(parseTime('24/Nov/2026:13:00:00 +0100'), t);
  assert.equal(parseTime('2026-11-24'), local(2026, 10, 24));
  assert.equal(parseTime(' 2026-11-24 '), local(2026, 10, 24));
  assert.equal(parseTime('2026-11-24T14:05'), local(2026, 10, 24, 14, 5), 'no zone means local');
});

test('parseTime refuses junk and impossible dates', () => {
  ['14:05', '42', 42, 'Nov', '', null, undefined, true, {}, '2026-13-45', '2026-02-30', 'cpu 42%'].forEach((v) => {
    assert.equal(parseTime(v), null, `${JSON.stringify(v)} should not parse`);
  });
});

// ------------------------------------------------------------
// Bucket boundaries and labels
// ------------------------------------------------------------
test('bucketStart floors to local minute, hour, day, Monday week and month', () => {
  const t = local(2026, 10, 26, 14, 5, 42, 123); // Thursday Nov 26 2026
  assert.equal(bucketStart(t, 'minute'), local(2026, 10, 26, 14, 5));
  assert.equal(bucketStart(t, 'hour'), local(2026, 10, 26, 14));
  assert.equal(bucketStart(t, 'day'), local(2026, 10, 26));
  assert.equal(bucketStart(t, 'week'), local(2026, 10, 23), 'weeks start Monday');
  assert.equal(bucketStart(local(2026, 10, 29, 23), 'week'), local(2026, 10, 23), 'Sunday belongs to the week before');
  assert.equal(bucketStart(local(2026, 10, 30, 1), 'week'), local(2026, 10, 30), 'Monday starts a new week');
  assert.equal(bucketStart(t, 'month'), local(2026, 10, 1));
});

test('nextBucket steps one bucket, across month and year ends', () => {
  assert.equal(nextBucket(local(2026, 10, 24, 23, 59), 'minute'), local(2026, 10, 25, 0, 0));
  assert.equal(nextBucket(local(2026, 10, 24, 23), 'hour'), local(2026, 10, 25, 0));
  assert.equal(nextBucket(local(2026, 10, 30), 'day'), local(2026, 11, 1));
  assert.equal(nextBucket(local(2026, 10, 30), 'week'), local(2026, 11, 7));
  assert.equal(nextBucket(local(2026, 11, 1), 'month'), local(2027, 0, 1));
});

test('bucketLabel is compact and only adds the date or year when needed', () => {
  const t = local(2026, 10, 24, 14, 5);
  assert.equal(bucketLabel(t, 'minute'), '14:05');
  assert.equal(bucketLabel(t, 'minute', { multiDay: true }), 'Nov 24 14:05');
  assert.equal(bucketLabel(local(2026, 10, 24, 9), 'hour'), '09:00');
  assert.equal(bucketLabel(local(2026, 10, 24), 'day'), 'Nov 24');
  assert.equal(bucketLabel(local(2026, 10, 24), 'day', { multiYear: true }), 'Nov 24, 2026');
  assert.equal(bucketLabel(local(2026, 10, 23), 'week'), 'Wk of Nov 23');
  assert.equal(bucketLabel(local(2026, 10, 1), 'month'), 'Nov 2026');
});

// ------------------------------------------------------------
// Bucketing one series
// ------------------------------------------------------------
const base = local(2026, 10, 24, 10, 0);

test('each bucket size groups and aggregates with the binding agg', () => {
  const rows = [
    { at: iso(base), v: 1 },
    { at: iso(base + 20 * 1000), v: 2 },
    { at: iso(base + MIN), v: 4 },
    { at: iso(base + HOUR), v: 8 },
    { at: iso(base + 24 * HOUR), v: 16 },
    { at: iso(local(2026, 11, 2, 10)), v: 32 },
  ];
  const b = { xField: 'at', yField: 'v', agg: 'sum' };
  assert.deepEqual(bucketSeries(rows, b, 'minute').values, [3, 4, 8, 16, 32]);
  assert.deepEqual(bucketSeries(rows, b, 'hour').values, [7, 8, 16, 32]);
  assert.deepEqual(bucketSeries(rows, b, 'day').values, [15, 16, 32]);
  assert.deepEqual(bucketSeries(rows, b, 'week').values, [31, 32]);
  assert.deepEqual(bucketSeries(rows, b, 'month').values, [31, 32]);
  assert.deepEqual(bucketSeries(rows, { ...b, agg: 'count' }, 'day').values, [4, 1, 1]);
  assert.deepEqual(bucketSeries(rows, { ...b, agg: 'max' }, 'hour').values, [4, 8, 16, 32]);
  assert.deepEqual(bucketSeries(rows, b, 'none'), { keys: [], values: [] });
  assert.deepEqual(bucketSeries(rows, b, 'fortnight'), { keys: [], values: [] });
});

test('output is chronological whatever the row order; "Latest" is the newest row', () => {
  const rows = [
    { at: iso(base + 2 * HOUR + 30 * MIN), v: 5 },
    { at: iso(base + 10 * MIN), v: 1 },
    { at: iso(base + 2 * HOUR), v: 4 },
    { at: iso(base + 50 * MIN), v: 2 },
  ];
  const out = bucketSeries(rows, { xField: 'at', yField: 'v', agg: 'last' }, 'hour');
  assert.deepEqual(out.keys, [base, base + 2 * HOUR]);
  assert.deepEqual(out.values, [2, 5]);
  const reversed = bucketSeries([...rows].reverse(), { xField: 'at', yField: 'v', agg: 'last' }, 'hour');
  assert.deepEqual(reversed, out);
});

test('rows whose x does not parse are dropped', () => {
  const rows = [{ at: iso(base), v: 1 }, { at: 'yesterday', v: 100 }, { at: null, v: 100 }, { v: 100 }, null, { at: iso(base + MIN), v: 2 }];
  const out = bucketSeries(rows, { xField: 'at', yField: 'v', agg: 'sum' }, 'hour');
  assert.deepEqual(out.values, [3]);
  assert.deepEqual(bucketSeries(rows, { xField: 'at', yField: 'v', agg: 'count' }, 'hour').values, [2]);
});

// ------------------------------------------------------------
// Merging, gaps, the cap
// ------------------------------------------------------------
test('gaps: empty buckets between first and last are filled with null', () => {
  // an agent reporting every minute, silent from 10:03 to 10:06
  const rows = [0, 1, 2, 7, 8].map((m) => ({ at: iso(base + m * MIN), cpu: 10 + m }));
  const series = bucketSeries(rows, { xField: 'at', yField: 'cpu', agg: 'avg' }, 'minute');
  const merged = mergeTimeSeries([series], 'minute');
  assert.deepEqual(merged.labels, ['10:00', '10:01', '10:02', '10:03', '10:04', '10:05', '10:06', '10:07', '10:08']);
  assert.deepEqual(merged.datasets[0], [10, 11, 12, null, null, null, null, 17, 18]);
  assert.deepEqual(mergeTimeSeries([series], 'minute', { fill: false }).datasets[0], [10, 11, 12, 17, 18]);
});

test('gap filling is skipped past the bucket cap', () => {
  const rows = [{ at: iso(base), v: 1 }, { at: iso(base + (MAX_FILLED_BUCKETS + 10) * MIN), v: 2 }];
  const merged = mergeTimeSeries([bucketSeries(rows, { xField: 'at', yField: 'v' }, 'minute')], 'minute');
  assert.equal(merged.labels.length, 2);
  assert.deepEqual(merged.datasets[0], [1, 2]);
  assert.ok(merged.labels[0].includes('10:00'));

  const atCap = [{ at: iso(base), v: 1 }, { at: iso(base + (MAX_FILLED_BUCKETS - 1) * MIN), v: 2 }];
  assert.equal(mergeTimeSeries([bucketSeries(atCap, { xField: 'at', yField: 'v' }, 'minute')], 'minute').labels.length, MAX_FILLED_BUCKETS);
});

test('multi-series from different sources share one sorted axis and stay aligned', () => {
  const a = [{ t: iso(base + 2 * HOUR), v: 3 }, { t: iso(base), v: 1 }];
  const b = [{ when: String((base + HOUR) / 1000), n: 20 }, { when: String((base + 4 * HOUR) / 1000), n: 50 }];
  const merged = mergeTimeSeries([
    bucketSeries(a, { xField: 't', yField: 'v', agg: 'sum' }, 'hour'),
    bucketSeries(b, { xField: 'when', yField: 'n', agg: 'sum' }, 'hour'),
  ], 'hour');
  assert.deepEqual(merged.labels, ['10:00', '11:00', '12:00', '13:00', '14:00']);
  assert.deepEqual(merged.datasets[0], [1, null, 3, null, null]);
  assert.deepEqual(merged.datasets[1], [null, 20, null, null, 50]);
  assert.deepEqual(merged.keys, [0, 1, 2, 3, 4].map((h) => base + h * HOUR));
});

test('labels carry the date once the axis spans more than one day', () => {
  const rows = [{ at: iso(local(2026, 10, 24, 23)), v: 1 }, { at: iso(local(2026, 10, 25, 1)), v: 2 }];
  const merged = mergeTimeSeries([bucketSeries(rows, { xField: 'at', yField: 'v' }, 'hour')], 'hour');
  assert.deepEqual(merged.labels, ['Nov 24 23:00', 'Nov 25 00:00', 'Nov 25 01:00']);
  assert.deepEqual(mergeTimeSeries([], 'hour'), { keys: [], labels: [], datasets: [] });
});

test('property: with sum, the buckets add up to the parseable rows', () => {
  const lo = local(2026, 0, 1);
  const hi = local(2027, 0, 1);
  const row = fc.record({
    at: fc.oneof(
      { weight: 5, arbitrary: fc.integer({ min: lo, max: hi }).map(iso) },
      { weight: 2, arbitrary: fc.integer({ min: lo, max: hi }) },
      { weight: 1, arbitrary: fc.constantFrom('junk', '', null, '14:05', '2026-02-30') },
    ),
    v: fc.integer({ min: -1000, max: 1000 }),
  });
  fc.assert(fc.property(fc.array(row, { maxLength: 60 }), fc.constantFrom(...TIME_BUCKETS.filter((b) => b !== 'none')), (rows, bucket) => {
    const b = { xField: 'at', yField: 'v', agg: 'sum' };
    const merged = mergeTimeSeries([bucketSeries(rows, b, bucket)], bucket);
    const total = merged.datasets.flat().reduce((s, x) => s + (x ?? 0), 0);
    const expected = rows.filter((r) => parseTime(r.at) !== null).reduce((s, r) => s + r.v, 0);
    assert.equal(total, expected);
    // the axis is strictly increasing
    merged.keys.forEach((k, i) => i && assert.ok(k > merged.keys[i - 1]));
  }), { numRuns: 200 });
});

// ------------------------------------------------------------
// Model + generator
// ------------------------------------------------------------
const board = (type, config) => normalizeDashboard({ widgets: [{ id: 'a', type, config }] }).widgets[0].config;

test('bucket defaults to none on line and bar, and only there', () => {
  assert.equal(WIDGET_TYPES.line.defaults.bucket, 'none');
  assert.equal(WIDGET_TYPES.bar.defaults.bucket, 'none');
  assert.equal(board('line', {}).bucket, 'none');
  assert.equal(board('bar', {}).bucket, 'none');
});

test('model normalization keeps valid buckets and resets anything else to none', () => {
  TIME_BUCKETS.forEach((b) => assert.equal(board('line', { bucket: b }).bucket, b));
  assert.equal(board('bar', { bucket: 'week' }).bucket, 'week');
  ['fortnight', '', 5, null, { x: 1 }, 'HOUR'].forEach((b) => {
    assert.equal(board('line', { bucket: b }).bucket, 'none', `${JSON.stringify(b)} → none`);
  });
});

test('generator buckets a log-like timestamp line by its typical spacing', () => {
  let n = 0;
  const makeId = () => `w_${++n}`;
  const lineOf = (rows) => generateSection({ id: 's', name: 'S' }, rows, { columns: 48, makeId }).find((w) => w.type === 'line');
  const every = (step, count) => Array.from({ length: count }, (_, i) => ({ at: iso(base + i * step), bytes: i }));
  assert.equal(lineOf(every(5000, 40)).config.bucket, 'minute');
  assert.equal(lineOf(every(HOUR, 40)).config.bucket, 'hour');
  assert.equal(lineOf(every(10 * MIN, 40)).config.bucket, 'hour');
  assert.equal(lineOf(every(5000, 10)).config.bucket, 'none', 'too few rows');
  const daily = Array.from({ length: 30 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, revenue: i }));
  assert.equal(lineOf(daily).config.bucket, 'none', 'plain dates keep their axis');
});
