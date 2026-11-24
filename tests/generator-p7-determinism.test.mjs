// Feature: dashboard-generator, Property 7: Determinism
// **Validates: Requirements 4.2**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

test('Property 7: same inputs and id sequence give the same dashboard', () => {
  fc.assert(fc.property(arb.inputs, arb.current, fc.constantFrom('replace', 'append'), (inputs, current, mode) => {
    const a = generateDashboard(current, inputs, { mode, makeId: arb.counter() });
    const b = generateDashboard(current, inputs, { mode, makeId: arb.counter() });
    assert.deepEqual(a, b);
  }));
});
