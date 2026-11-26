import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { formatCellValue } from '../Web/frontend/scripts/editor/data.js';

test('ISO date-times are shortened and keep the raw value', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  const out = formatCellValue('2026-11-26T03:41:34.000Z', now);
  assert.equal(out.raw, '2026-11-26T03:41:34.000Z');
  assert.notEqual(out.text, out.raw);
  assert.doesNotMatch(out.text, /T\d{2}:/);
});

test('a date-time on another day includes the date', () => {
  const out = formatCellValue('2026-01-02T10:00:00Z', new Date('2026-11-26T12:00:00Z'));
  assert.match(out.text, /,/);
});

test('plain dates, numbers, empty and free text pass through untouched', () => {
  for (const v of ['2026-11-26', 'dead', '/wp-login.php', 200, 18025, '', null, undefined]) {
    const out = formatCellValue(v);
    assert.equal(out.raw, null);
    assert.equal(out.text, v ?? '');
  }
});

test('property: non-ISO strings are never changed', () => {
  fc.assert(fc.property(fc.string(), (s) => {
    fc.pre(!/^\d{4}-\d{2}-\d{2}T/.test(s.trim()));
    const out = formatCellValue(s);
    return out.text === s && out.raw === null;
  }));
});
