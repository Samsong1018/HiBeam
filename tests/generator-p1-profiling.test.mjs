// Feature: dashboard-generator, Property 1: Profiling is total
// **Validates: Requirements 1.1, 1.10, 1.11**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

const ROLES = ['time', 'number', 'category', 'label', 'text', 'empty'];

test('Property 1: one profile per sampled field, first-seen order, valid role', () => {
  fc.assert(fc.property(arb.rows, (rows) => {
    const expected = [...new Set(arb.plainRows(rows).flatMap((r) => Object.keys(r)))].filter((n) => n.length <= 120);
    const profiles = profileFields(rows);
    assert.deepEqual(profiles.map((p) => p.name), expected);
    profiles.forEach((p) => assert.ok(ROLES.includes(p.role), p.role));
  }));
});
