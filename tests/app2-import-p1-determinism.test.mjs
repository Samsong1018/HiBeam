// Feature: app2-monthly-import, Property 1: Determinism (and Property 3: caption bound)
// **Validates: Requirements 2.7, 2.8**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { BuildReport, MAX_CAPTION } from '../APP2/import/report.mjs';
import { workbookArb } from './app2-import-arbitraries.mjs';

test('BuildReport is deterministic, never mutates, and the caption fits a text box', () => {
  fc.assert(fc.property(workbookArb, fc.integer({ min: 2000, max: 2100 }), (sheets, year) => {
    const before = JSON.stringify(sheets); // fast-check objects have a null prototype, so compare as JSON
    const a = BuildReport(sheets, { year });
    const b = BuildReport(sheets, { year });
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(sheets), before);
    assert.equal(typeof a.caption, 'string');
    assert.ok(a.caption.length <= MAX_CAPTION);
  }));
});
