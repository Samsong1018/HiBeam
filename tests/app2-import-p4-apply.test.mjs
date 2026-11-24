// Feature: app2-monthly-import, Property 4: Surgical update, Property 5: Thresholds
// **Validates: Requirements 3.2, 3.3**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { BuildReport, ApplyReport } from '../APP2/import/report.mjs';
import { kpiStatus } from '../Web/frontend/scripts/editor/kpi.js';
import { workbookArb } from './app2-import-arbitraries.mjs';

const TOUCHED = new Set(['w_title', 'w_where', 'w_note', 'w_spent']);
const widgetArb = fc.record({
  id: fc.oneof(fc.constantFrom(...TOUCHED), fc.stringMatching(/^w_[a-z]{1,6}$/)),
  type: fc.constantFrom('kpi', 'label', 'text', 'pie', 'table'),
  x: fc.nat(40), y: fc.nat(80), w: fc.integer({ min: 1, max: 48 }), h: fc.integer({ min: 1, max: 20 }),
  config: fc.record({ title: fc.string({ maxLength: 10 }) }),
});

test('only the four month widgets change, and nothing is mutated', () => {
  fc.assert(fc.property(workbookArb, fc.array(widgetArb, { maxLength: 12 }), (sheets, widgets) => {
    const def = { name: 'Money', grid: { columns: 48, showGrid: true }, widgets };
    const frozen = JSON.stringify(def); // fast-check objects have a null prototype, so compare as JSON
    const { definition } = ApplyReport(def, BuildReport(sheets, { year: 2026 }));
    assert.equal(JSON.stringify(def), frozen);
    assert.equal(definition.widgets.length, widgets.length);
    definition.widgets.forEach((w, i) => {
      if (TOUCHED.has(w.id)) {
        const { config: _c, ...posAfter } = w;
        const { config: _d, ...posBefore } = widgets[i];
        assert.equal(JSON.stringify(posAfter), JSON.stringify({ ...posBefore }), 'position never moves');
      } else {
        assert.equal(w, widgets[i]);
      }
    });
  }));
});

test('spend alert fires exactly when spent reaches the budget total', () => {
  fc.assert(fc.property(workbookArb, (sheets) => {
    const r = BuildReport(sheets, { year: 2026 });
    const def = { name: 'M', grid: { columns: 48, showGrid: true }, widgets: [{ id: 'w_spent', type: 'kpi', x: 0, y: 0, w: 12, h: 6, config: {} }] };
    const { config } = ApplyReport(def, r).definition.widgets[0];
    assert.equal(config.alertAt, r.budgetTotal);
    assert.equal(config.warnAt, Math.round(r.budgetTotal * 0.95));
    assert.equal(kpiStatus(r.spentTotal, config) === 'alert', r.spentTotal >= r.budgetTotal);
  }));
});
