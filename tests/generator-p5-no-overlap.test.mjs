// Feature: dashboard-generator, Property 5: No two widgets overlap
// **Validates: Requirements 3.5**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('Property 5: generated widgets never overlap each other', () => {
  fc.assert(fc.property(arb.inputs, arb.columns, (inputs, columns) => {
    const current = { name: 'B', grid: { columns, showGrid: true }, widgets: [] };
    const { widgets } = generateDashboard(current, inputs, { mode: 'replace', makeId: arb.counter() }).dashboard;
    for (let i = 0; i < widgets.length; i += 1) {
      for (let j = i + 1; j < widgets.length; j += 1) assert.ok(!overlaps(widgets[i], widgets[j]), `${widgets[i].id} / ${widgets[j].id}`);
    }
  }));
});
