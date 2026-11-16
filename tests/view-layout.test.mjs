// Unit tests for the dashboard viewer's pure layout helpers (no DOM needed).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readingOrder, placement, cellSize, updatedLabel } from '../Web/frontend/scripts/view/layout.js';

test('readingOrder sorts top-to-bottom, then left-to-right, without mutating', () => {
  const widgets = [
    { id: 'c', x: 20, y: 10 },
    { id: 'b', x: 30, y: 0 },
    { id: 'a', x: 0, y: 0 },
    { id: 'd', x: 0, y: 10 },
  ];
  const before = widgets.map((w) => w.id);
  assert.deepEqual(readingOrder(widgets).map((w) => w.id), ['a', 'b', 'd', 'c']);
  assert.deepEqual(widgets.map((w) => w.id), before);
});

test('placement maps 0-based cells to 1-based CSS grid lines', () => {
  assert.deepEqual(placement({ x: 0, y: 0, w: 16, h: 10 }), { gridColumn: '1 / span 16', gridRow: '1 / span 10' });
  assert.deepEqual(placement({ x: 32, y: 4, w: 16, h: 6 }), { gridColumn: '33 / span 16', gridRow: '5 / span 6' });
});

test('cellSize is width / columns and 0 for unusable input', () => {
  assert.equal(cellSize(960, 48), 20);
  assert.equal(cellSize(0, 48), 0);
  assert.equal(cellSize(960, 0), 0);
  assert.equal(cellSize(Number.NaN, 48), 0);
});

test('updatedLabel is relative when fresh and a date when old', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  assert.equal(updatedLabel(new Date('2026-11-15T11:59:50Z'), now), 'Updated just now');
  assert.equal(updatedLabel(new Date('2026-11-15T11:55:00Z'), now), 'Updated 5m ago');
  assert.equal(updatedLabel(new Date('2026-11-15T09:00:00Z'), now), 'Updated 3h ago');
  assert.match(updatedLabel(new Date('2026-11-01T12:00:00Z'), now), /^Updated \D*\d/);
  assert.equal(updatedLabel(new Date('nope'), now), '');
  assert.equal(updatedLabel(null, now), '');
});
