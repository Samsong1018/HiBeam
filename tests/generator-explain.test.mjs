// Tests for the generator's reasons (explainSection) and the board theme field.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createRequire } from 'node:module';

import { explainSection, profileFields } from '../Web/frontend/scripts/editor/generator.js';
import { normalizeDashboard, setTheme, newDashboard } from '../Web/frontend/scripts/editor/model.js';
import { DemoHistory, DemoServices } from '../APP1/agent/simulate.mjs';

const require = createRequire(import.meta.url);
const { validateDashboardDefinition } = require('../Web/backend/lib/validators.js');

const NOW = new Date('2026-11-24T18:31:07Z');

const why = (rows) => Object.fromEntries(explainSection({ id: 's', name: 'S' }, rows).reasons.map((r) => [r.field, r.reason]));

test('a rate is explained as averaged / latest, never summed', () => {
  const reasons = why(DemoHistory(NOW, 30, 60));
  assert.match(reasons.cpuPct, /rate/);
  assert.match(reasons.cpuPct, /latest value/);
});

test('ids and status codes are explained as never added up', () => {
  const reasons = why([
    { id: 1, status: 200, bytes: 10 }, { id: 2, status: 404, bytes: 20 },
    { id: 3, status: 200, bytes: 30 }, { id: 4, status: 200, bytes: 40 }, { id: 5, status: 404, bytes: 5 },
  ]);
  assert.match(reasons.id, /identifier/);
  assert.match(reasons.status, /never added up/);
});

test('a category with too many values says why there is no pie', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ cat: `c${i % 9}`, amount: i }));
  assert.match(why(rows).cat, /no pie/);
});

test('service list fixture gets a reason for every field', () => {
  const rows = DemoServices(NOW);
  const out = explainSection({ id: 's', name: 'Services' }, rows);
  assert.equal(out.reasons.length, profileFields(rows).length);
  assert.ok(out.reasons.every((r) => r.reason.length > 0));
});

test('no rows: no reasons, no crash', () => {
  assert.deepEqual(explainSection({ id: 's', name: 'Empty' }, []), { source: 'Empty', rows: 0, reasons: [] });
  assert.deepEqual(explainSection(null, null).reasons, []);
});

test('property: explainSection is deterministic and covers every profiled field', () => {
  const row = fc.dictionary(fc.constantFrom('a', 'b', 'status', 'cpuPct', 'id', 'Balance ($)'), fc.oneof(fc.integer(), fc.string(), fc.constant(null)));
  fc.assert(fc.property(fc.array(row, { maxLength: 30 }), (rows) => {
    const a = explainSection({ id: 's', name: 'S' }, rows);
    const b = explainSection({ id: 's', name: 'S' }, rows);
    assert.deepEqual(a, b);
    return a.rows === 0 || a.reasons.length === profileFields(rows).length;
  }));
});

test('board theme: only known themes survive, and the backend accepts them', () => {
  const base = newDashboard();
  assert.equal(normalizeDashboard({ ...base, theme: 'kiroween' }).theme, 'kiroween');
  assert.equal('theme' in normalizeDashboard({ ...base, theme: 'neon' }), false);
  assert.equal('theme' in setTheme({ ...base, theme: 'kiroween' }, ''), false);
  assert.equal(setTheme(base, ''), base, 'no-op returns the same object');
  assert.equal(validateDashboardDefinition({ ...base, theme: 'kiroween' }).ok, true);
  const bad = validateDashboardDefinition({ ...base, theme: 'neon' });
  assert.equal(bad.ok, false);
});
