// Feature: app2-monthly-import, Property 2: Overspend accuracy
// **Validates: Requirements 2.2**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { BuildReport, OverBudget, IsSavings } from '../APP2/import/report.mjs';
import { workbookArb } from './app2-import-arbitraries.mjs';

test('named overspends are real, non-savings, and the largest ones', () => {
  fc.assert(fc.property(workbookArb, (sheets) => {
    const rows = sheets['Budget vs Actual'];
    const { caption } = BuildReport(sheets, { year: 2026 });
    const over = OverBudget(rows);
    const named = over.slice(0, 2);
    named.forEach((c) => {
      assert.ok(c.over > 0);
      assert.ok(!IsSavings(c.category));
      assert.ok(caption.includes(`${c.category} (+$`), `caption names ${c.category}`);
    });
    if (named.length) {
      const smallest = Math.min(...named.map((c) => c.over));
      over.slice(2).forEach((c) => assert.ok(c.over <= smallest));
    } else if (rows.length) {
      assert.match(caption, /Every category stayed within budget/);
    }
  }));
});
