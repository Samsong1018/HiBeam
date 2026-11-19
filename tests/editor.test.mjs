// Unit tests for the dashboard editor's pure modules (no DOM needed).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aggregate, fieldsOf, groupSeries, mergeSeries, scaleLayout, scaleSize, formatNumber } from '../Web/frontend/scripts/editor/data.js';
import { createStore } from '../Web/frontend/scripts/editor/store.js';
import {
  newDashboard, addWidget, removeWidget, updateConfig, applyLayout, setGrid, normalizeDashboard, duplicateWidget,
} from '../Web/frontend/scripts/editor/model.js';

const rows = [
  { month: 'Jan', region: 'N', revenue: 10 },
  { month: 'Jan', region: 'S', revenue: 30 },
  { month: 'Feb', region: 'N', revenue: '1,000' },
  { month: 'Feb', region: 'S', revenue: 'n/a' },
];

test('aggregate handles numbers, numeric strings and junk', () => {
  assert.equal(aggregate([1, '2', 'x', null], 'sum'), 3);
  assert.equal(aggregate([2, 4], 'avg'), 3);
  assert.equal(aggregate([], 'avg'), 0);
  assert.equal(aggregate(['a', 'b', 'c'], 'count'), 3);
  assert.equal(aggregate([5, 1, 9], 'min'), 1);
  assert.equal(aggregate([5, 1, 9], 'max'), 9);
  assert.equal(aggregate([5, 1, 9], 'last'), 9);
  assert.equal(aggregate([1, 2], 'bogus'), 3, 'unknown agg falls back to sum');
});

test('fieldsOf infers number vs string columns', () => {
  assert.deepEqual(fieldsOf([{ a: 1, b: 'x' }, { a: '2', b: 'y' }]), [
    { name: 'a', type: 'number' },
    { name: 'b', type: 'string' },
  ]);
  assert.deepEqual(fieldsOf([]), []);
  assert.deepEqual(fieldsOf(null), []);
});

test('groupSeries groups by x in first-seen order', () => {
  assert.deepEqual(groupSeries(rows, { xField: 'month', yField: 'revenue', agg: 'sum' }), {
    labels: ['Jan', 'Feb'],
    values: [40, 1000],
  });
  assert.deepEqual(groupSeries(rows, { xField: 'month', agg: 'count' }).values, [2, 2]);
  assert.deepEqual(groupSeries(rows, { xField: '', yField: 'revenue' }), { labels: [], values: [] });
});

test('mergeSeries aligns series on a shared axis with null gaps', () => {
  const merged = mergeSeries([
    { labels: ['a', 'b'], values: [1, 2] },
    { labels: ['b', 'c'], values: [3, 4] },
  ]);
  assert.deepEqual(merged.labels, ['a', 'b', 'c']);
  assert.deepEqual(merged.datasets, [[1, 2, null], [null, 3, 4]]);
});

test('scaleLayout keeps widgets inside the grid when density changes', () => {
  const [w] = scaleLayout([{ id: 'a', x: 40, y: 4, w: 8, h: 6 }], 48, 24);
  assert.deepEqual({ x: w.x, y: w.y, w: w.w, h: w.h }, { x: 20, y: 2, w: 4, h: 3 });
  const [up] = scaleLayout([{ id: 'a', x: 47, y: 0, w: 1, h: 1 }], 48, 96);
  assert.ok(up.x + up.w <= 96);
  assert.deepEqual(scaleSize({ w: 16, h: 10 }, 24), { w: 8, h: 5 });
});

test('formatNumber abbreviates and applies prefix/suffix', () => {
  assert.equal(formatNumber(2500000, { prefix: '$' }), '$2.5M');
  assert.equal(formatNumber('abc'), '—');
  assert.equal(formatNumber(12.345, { decimals: 1, suffix: '%' }), '12.3%');
});

test('store undo/redo walks history and clears redo on new commit', () => {
  const store = createStore({ n: 0 });
  store.commit({ n: 1 });
  store.commit({ n: 2 });
  assert.equal(store.undo(), true);
  assert.equal(store.get().n, 1);
  assert.equal(store.redo(), true);
  assert.equal(store.get().n, 2);
  store.undo();
  store.commit({ n: 9 });
  assert.equal(store.canRedo(), false);
  store.undo();
  store.undo();
  assert.equal(store.get().n, 0);
  assert.equal(store.undo(), false);
});

test('store coalesces rapid commits with the same key into one undo step', () => {
  const store = createStore({ t: '' });
  store.commit({ t: 'a' }, { coalesce: 'title' });
  store.commit({ t: 'ab' }, { coalesce: 'title' });
  store.commit({ t: 'abc' }, { coalesce: 'title' });
  store.undo();
  assert.equal(store.get().t, '');
});

test('store skips commits that return the same object', () => {
  const initial = { a: 1 };
  const store = createStore(initial);
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.commit(initial);
  assert.equal(calls, 0);
  assert.equal(store.canUndo(), false);
});

test('model operations are immutable', () => {
  const base = newDashboard();
  const widget = { id: 'w1', type: 'kpi', x: 0, y: 0, w: 8, h: 5, config: { title: 'A', bindings: [] } };
  const withOne = addWidget(base, widget);
  assert.equal(base.widgets.length, 0);
  assert.equal(withOne.widgets.length, 1);

  const renamed = updateConfig(withOne, 'w1', { title: 'B' });
  assert.equal(withOne.widgets[0].config.title, 'A');
  assert.equal(renamed.widgets[0].config.title, 'B');

  assert.equal(applyLayout(withOne, { w1: { x: 0, y: 0, w: 8, h: 5 } }), withOne, 'no-op layout returns same object');
  assert.equal(applyLayout(withOne, { w1: { x: 2, y: 0, w: 8, h: 5 } }).widgets[0].x, 2);

  const dup = duplicateWidget(withOne, 'w1', 'w2');
  assert.equal(dup.widgets.length, 2);
  assert.notEqual(dup.widgets[1].config, dup.widgets[0].config);

  assert.equal(removeWidget(withOne, 'w1').widgets.length, 0);
  assert.equal(setGrid(withOne, { columns: 24 }).widgets[0].w, 4);
});

test('normalizeDashboard drops unknown widgets and clamps untrusted values', () => {
  const dash = normalizeDashboard({
    id: 'dash_1',
    name: 'x'.repeat(500),
    grid: { columns: 13 },
    widgets: [
      { id: 'a', type: 'script', x: 0, y: 0, w: 1, h: 1 },
      { id: 'b', type: 'line', x: -5, y: 'NaN', w: 999, h: 4, config: { color: 'javascript:alert(1)', bindings: 'nope' } },
      { id: 'c', type: 'pie', x: 0, y: 0, w: 4, h: 4, config: { bindings: [{ sourceId: 's1' }, { sourceId: 's2' }] } },
    ],
  });
  assert.equal(dash.id, undefined, 'id is not part of the document');
  assert.equal(dash.name.length, 80);
  assert.equal(dash.grid.columns, 48);
  assert.deepEqual(dash.widgets.map((w) => w.id), ['b', 'c']);
  const line = dash.widgets[0];
  assert.deepEqual([line.x, line.y, line.w], [0, 0, 48]);
  assert.equal(line.config.color, 'c1');
  assert.deepEqual(line.config.bindings, []);
  assert.equal(dash.widgets[1].config.bindings.length, 1, 'pie takes one binding');
});

import { packSourceKey } from '../Web/frontend/scripts/editor/source-types.js';

test('packSourceKey builds the { url, token } blob the connector reads', () => {
  const rest = JSON.parse(packSourceKey('rest', { url: 'https://a.test/x', method: 'GET', auth: 'Bearer abc123' }));
  assert.deepEqual(rest, { url: 'https://a.test/x', method: 'GET', token: 'abc123' });
  assert.equal(rest.auth, undefined);

  const noAuth = JSON.parse(packSourceKey('rest', { url: 'https://a.test/x', auth: '  ' }));
  assert.equal(noAuth.token, undefined);

  assert.deepEqual(JSON.parse(packSourceKey('json', { url: 'https://a.test/d.json', path: 'data' })), { url: 'https://a.test/d.json', path: 'data' });
});
