// Feature: dashboard-generator, Property 9: Append places new widgets below and keeps old ones
// **Validates: Requirements 3.7**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

test('Property 9: append keeps old widgets as-is and puts new ones under them', () => {
  fc.assert(fc.property(arb.inputs, arb.current, (inputs, current) => {
    const { dashboard, error } = generateDashboard(current, inputs, { mode: 'append', makeId: arb.counter() });
    if (error) return;
    const old = current.widgets;
    const bottom = old.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    old.forEach((w, i) => assert.equal(dashboard.widgets[i], w));
    dashboard.widgets.slice(old.length).forEach((w) => assert.ok(w.y >= bottom, `${w.y} < ${bottom}`));
  }));
});
