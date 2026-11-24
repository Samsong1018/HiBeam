// Feature: dashboard-generator, Property 6: normalizeDashboard leaves generated output unchanged
// **Validates: Requirements 4.1**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

import { normalizeDashboard } from '../Web/frontend/scripts/editor/model.js';

test('Property 6: normalizing a generated dashboard is a no-op', () => {
  fc.assert(fc.property(arb.inputs, arb.current, fc.constantFrom('replace', 'append'), (inputs, current, mode) => {
    const { dashboard, error } = generateDashboard(current, inputs, { mode, makeId: arb.counter() });
    if (error) return;
    assert.deepEqual(normalizeDashboard(dashboard), dashboard);
  }));
});
