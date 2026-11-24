// Unit tests for chart axis/unit/ordering options (pure modules, no DOM).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatAxisValue, sortBars, foldPieSlices } from '../Web/frontend/scripts/editor/data.js';
import { normalizeDashboard, normalizeChartConfig } from '../Web/frontend/scripts/editor/model.js';
import { WIDGET_TYPES } from '../Web/frontend/scripts/editor/widget-types.js';
import { generateSection } from '../Web/frontend/scripts/editor/generator.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test('formatAxisValue adds prefix and suffix', () => {
  assert.equal(formatAxisValue(1200, { prefix: '$' }), '$1,200');
  assert.equal(formatAxisValue(42.5, { suffix: '%' }), '42.5%');
  assert.equal(formatAxisValue(0.125), '0.13');
  assert.equal(formatAxisValue(-5000, { prefix: '$' }), '-$5,000');
});

test('formatAxisValue compact shortens big numbers only when asked', () => {
  assert.equal(formatAxisValue(60000, { compact: true }), '60k');
  assert.equal(formatAxisValue(1500, { compact: true }), '1.5k');
  assert.equal(formatAxisValue(2500000, { compact: true, prefix: '$' }), '$2.5M');
  assert.equal(formatAxisValue(3e9, { compact: true }), '3B');
  assert.equal(formatAxisValue(-60000, { compact: true, prefix: '$' }), '-$60k');
  assert.equal(formatAxisValue(999, { compact: true }), '999');
  assert.equal(formatAxisValue(60000), '60,000');
});

test('formatAxisValue handles junk', () => {
  assert.equal(formatAxisValue(null), '—');
  assert.equal(formatAxisValue('abc'), '—');
  assert.equal(formatAxisValue('1,000', { compact: true }), '1k');
});

const bars = {
  labels: ['a', 'b', 'c', 'd'],
  series: [
    { label: 'rev', values: [10, 40, null, 20] },
    { label: 'cost', values: [1, 4, 3, 2] },
  ],
};

test('sortBars none / no topN is a no-op', () => {
  assert.equal(sortBars(bars, { sort: 'none', topN: 0 }), bars);
  assert.equal(sortBars(bars, {}), bars);
});

test('sortBars desc and asc keep series aligned, nulls last', () => {
  const desc = sortBars(bars, { sort: 'desc' });
  assert.deepEqual(desc.labels, ['b', 'd', 'a', 'c']);
  assert.deepEqual(desc.series[0].values, [40, 20, 10, null]);
  assert.deepEqual(desc.series[1].values, [4, 2, 1, 3]);
  assert.equal(desc.series[1].label, 'cost');

  const asc = sortBars(bars, { sort: 'asc' });
  assert.deepEqual(asc.labels, ['a', 'd', 'b', 'c']);
  assert.deepEqual(asc.series[1].values, [1, 2, 4, 3]);
});

test('sortBars topN keeps the largest N', () => {
  const top = sortBars(bars, { sort: 'desc', topN: 2 });
  assert.deepEqual(top.labels, ['b', 'd']);
  assert.deepEqual(top.series[1].values, [4, 2]);
  // sort none: the largest N in their original order
  const kept = sortBars(bars, { sort: 'none', topN: 2 });
  assert.deepEqual(kept.labels, ['b', 'd']);
  const ascTop = sortBars(bars, { sort: 'asc', topN: 3 });
  assert.deepEqual(ascTop.labels, ['a', 'd', 'b']);
  // topN >= length with no sort changes nothing
  assert.equal(sortBars(bars, { topN: 10 }), bars);
});

test('sortBars does not mutate its input', () => {
  const copy = structuredClone(bars);
  sortBars(bars, { sort: 'desc', topN: 2 });
  assert.deepEqual(bars, copy);
});

const pie = { labels: ['x', 'y', 'z', 'w', 'v'], series: [{ label: 'amt', values: [5, 30, 10, 50, 5] }] };

test('foldPieSlices keeps the N largest, largest first, plus Other', () => {
  const out = foldPieSlices(pie, 2);
  assert.deepEqual(out.labels, ['w', 'y', 'Other']);
  assert.deepEqual(out.series[0].values, [50, 30, 20]);
  assert.equal(out.otherIndex, 2);
  assert.equal(out.series[0].label, 'amt');
  assert.equal(sum(out.series[0].values), sum(pie.series[0].values));
});

test('foldPieSlices topN 0 or >= slice count is a no-op', () => {
  for (const n of [0, 5, 9]) {
    const out = foldPieSlices(pie, n);
    assert.deepEqual(out.labels, pie.labels);
    assert.deepEqual(out.series, pie.series);
    assert.equal(out.otherIndex, -1);
  }
});

test('foldPieSlices avoids clashing with a real "Other" label and treats nulls as 0', () => {
  const data = { labels: ['Other', 'b', 'c'], series: [{ label: 'n', values: [9, null, 1] }] };
  const out = foldPieSlices(data, 1);
  assert.deepEqual(out.labels, ['Other', 'All other']);
  assert.deepEqual(out.series[0].values, [9, 1]);
});

const board = (type, config) => normalizeDashboard({ widgets: [{ id: 'w1', type, x: 0, y: 0, w: 10, h: 10, config }] }).widgets[0].config;

test('missing chart fields get defaults (old boards unchanged)', () => {
  const line = board('line', { title: 'Old' });
  assert.equal(line.zeroBased, true);
  assert.equal(line.prefix, '');
  assert.equal(line.suffix, '');
  assert.equal(line.compact, false);
  assert.equal('sort' in line, false);
  const bar = board('bar', {});
  assert.equal(bar.sort, 'none');
  assert.equal(bar.topN, 0);
  assert.equal(bar.zeroBased, true);
  const p = board('pie', {});
  assert.equal(p.topN, 0);
  assert.equal('prefix' in p, false);
});

test('good chart values survive normalization', () => {
  const bar = board('bar', { zeroBased: false, prefix: '$', suffix: ' ms', compact: true, sort: 'desc', topN: 10 });
  assert.deepEqual(
    { zeroBased: bar.zeroBased, prefix: bar.prefix, suffix: bar.suffix, compact: bar.compact, sort: bar.sort, topN: bar.topN },
    { zeroBased: false, prefix: '$', suffix: ' ms', compact: true, sort: 'desc', topN: 10 },
  );
});

test('bad chart values are rejected', () => {
  const bar = board('bar', { zeroBased: 'no', prefix: 42, suffix: 'x'.repeat(50), compact: 'yes', sort: 'random', topN: -3 });
  assert.equal(bar.zeroBased, true);
  assert.equal(bar.prefix, '');
  assert.equal(bar.suffix.length, 8);
  assert.equal(bar.compact, false);
  assert.equal(bar.sort, 'none');
  assert.equal(bar.topN, 0);
  for (const topN of [2.5, '5', NaN, null]) assert.equal(board('pie', { topN }).topN, 0);
  assert.equal(board('pie', { topN: 1e6 }).topN, 50);
});

test('normalizeChartConfig only touches keys the type has', () => {
  assert.deepEqual(normalizeChartConfig({ topN: 3 }, WIDGET_TYPES.pie.defaults), { topN: 3 });
  assert.deepEqual(normalizeChartConfig({ sort: 'asc' }, WIDGET_TYPES.kpi.defaults), { prefix: '', suffix: '' });
});

test('generator drops the zero baseline for stock-style lines only', () => {
  let n = 0;
  const makeId = (p = 'w') => `${p}_${(n += 1)}`;
  const rows = ['2026-01-01', '2026-02-01', '2026-03-01'].map((date, i) => ({ date, net_worth: 50000 + i * 100 }));
  const stock = generateSection({ id: 's1', name: 'Money' }, rows, { columns: 48, makeId }).find((w) => w.type === 'line');
  assert.equal(stock.config.zeroBased, false);

  const flows = ['2026-01-01', '2026-02-01', '2026-03-01'].map((date, i) => ({ date, spent: 100 + i }));
  const flow = generateSection({ id: 's2', name: 'Spend' }, flows, { columns: 48, makeId }).find((w) => w.type === 'line');
  assert.equal(flow.config.zeroBased, true);
});

test('review fixes: compact promotes at step edges, pie never folds a single slice', async () => {
  const { formatAxisValue: fmt, foldPieSlices: fold } = await import('../Web/frontend/scripts/editor/data.js');
  assert.equal(fmt(999999, { compact: true }), '1M');
  assert.equal(fmt(999.96, { compact: true }), '1k');
  assert.equal(fmt(950, { compact: true }), '950');
  const pie = { labels: ['a', 'b', 'c'], series: [{ values: [3, 2, 1] }] };
  assert.deepEqual(fold(pie, 2).labels, ['a', 'b', 'c']);
  assert.deepEqual(fold({ ...pie, labels: ['a', 'b', 'c', 'd'], series: [{ values: [4, 3, 2, 1] }] }, 2).labels, ['a', 'b', 'Other']);
});
