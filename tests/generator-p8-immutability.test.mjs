// Feature: dashboard-generator, Property 8: Inputs are not modified
// **Validates: Requirements 4.3**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

test('Property 8: generation never mutates rows, sources or the current dashboard', () => {
  fc.assert(fc.property(arb.inputs, arb.current, fc.constantFrom('replace', 'append'), (inputs, current, mode) => {
    const before = structuredClone({ inputs, current });
    generateDashboard(current, inputs, { mode, makeId: arb.counter() });
    assert.deepEqual(structuredClone({ inputs, current }), before); // clone both: fast-check records have a null prototype
  }));
});
