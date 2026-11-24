// Feature: dashboard-generator, Property 2: Identifiers and bare numbers
// **Validates: Requirements 1.3, 1.4**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

test('Property 2: identifier fields are text; all-number fields are never time', () => {
  fc.assert(fc.property(arb.rows, (rows) => {
    const sample = arb.plainRows(rows);
    profileFields(rows).forEach((p) => {
      if (/^id$/i.test(p.name) || /_id$/i.test(p.name) || /[a-z]Id$/.test(p.name)) {
        assert.ok(p.role === 'text' || p.role === 'empty', `${p.name} → ${p.role}`);
      }
      const present = sample.map((r) => r[p.name]).filter((v) => v !== null && v !== undefined && v !== '');
      if (present.length && present.every((v) => typeof v === 'number')) assert.notEqual(p.role, 'time');
    });
  }));
});
