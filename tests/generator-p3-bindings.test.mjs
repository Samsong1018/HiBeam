// Feature: dashboard-generator, Property 3: Bindings reference the section's source and real fields
// **Validates: Requirements 2.13**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { profileFields, generateSection, generateDashboard } from '../Web/frontend/scripts/editor/generator.js';
import * as arb from './generator-arbitraries.mjs';

test('Property 3: every binding points at its source and at fields in the sample', () => {
  fc.assert(fc.property(arb.source, arb.rows, arb.columns, (source, rows, columns) => {
    const fields = new Set(profileFields(rows).map((p) => p.name));
    generateSection(source, rows, { columns, makeId: arb.counter() }).forEach((w) => {
      w.config.bindings.forEach((b) => {
        assert.equal(b.sourceId, source.id);
        if (b.xField) assert.ok(fields.has(b.xField), b.xField);
        if (b.yField) assert.ok(fields.has(b.yField), b.yField);
      });
    });
  }));
});
