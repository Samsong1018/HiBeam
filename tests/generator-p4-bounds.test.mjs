// Feature: dashboard-generator, Property 4: Bounds
// **Validates: Requirements 3.4**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

test('Property 4: every widget sits inside the grid for all column options', () => {
  fc.assert(fc.property(arb.inputs, arb.current, (inputs, current) => {
    const { dashboard } = generateDashboard(current, inputs, { mode: 'replace', makeId: arb.counter() });
    const { columns } = current.grid;
    dashboard.widgets.forEach((w) => {
      assert.ok(w.x >= 0 && w.y >= 0 && w.w >= 1 && w.h >= 1, JSON.stringify(w));
      assert.ok(w.x + w.w <= columns, JSON.stringify(w));
    });
  }));
});
