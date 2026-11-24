// Feature: dashboard-generator, Property 11: Only measures are aggregated
// **Validates: Requirements 2.14**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

test('Property 11: every yField is a number field (never a coded number, id or label)', () => {
  fc.assert(fc.property(arb.source, arb.rows, arb.columns, (source, rows, columns) => {
    const roles = new Map(profileFields(rows).map((p) => [p.name, p.role]));
    generateSection(source, rows, { columns, makeId: arb.counter() }).forEach((w) => {
      w.config.bindings.forEach((b) => {
        if (b.yField) assert.equal(roles.get(b.yField), 'number', `${w.type} uses ${b.yField}`);
      });
    });
  }));
});
