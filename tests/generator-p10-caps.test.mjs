// Feature: dashboard-generator, Property 10: Section and dashboard widget caps
// **Validates: Requirements 2.15, 4.6**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

test('Property 10: a section has at most 10 widgets', () => {
  fc.assert(fc.property(arb.source, arb.rows, arb.columns, (source, rows, columns) => {
    assert.ok(generateSection(source, rows, { columns, makeId: arb.counter() }).length <= 10);
  }));
});

test('Property 10: going over 200 widgets returns too_many_widgets and the same dashboard', () => {
  fc.assert(fc.property(arb.inputs, fc.integer({ min: 190, max: 200 }), (inputs, count) => {
    const current = {
      name: 'Full', grid: { columns: 48, showGrid: true },
      widgets: Array.from({ length: count }, (_, i) => ({ id: `o${i}`, type: 'label', x: 0, y: i, w: 1, h: 1, config: {} })),
    };
    const res = generateDashboard(current, inputs, { mode: 'append', makeId: arb.counter() });
    const added = inputs.reduce((n, { source, rows }) => n + generateSection(source, rows, { columns: 48, makeId: arb.counter() }).length, 0);
    if (count + added > 200) {
      assert.equal(res.error, 'too_many_widgets');
      assert.equal(res.dashboard, current);
    } else {
      assert.equal(res.error, null);
    }
  }));
});
