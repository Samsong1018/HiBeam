// Feature: auth-account-endpoints, Property 10: Preferences validation
// **Validates: Requirements 11.1, 11.2**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import validators from '../Web/backend/lib/validators.js';

const { validatePreferences } = validators;
const CHARTS = ['line', 'bar', 'pie', 'kpi', 'table'];

const anyValue = fc.oneof(
  fc.string(),
  fc.constantFrom(...CHARTS),
  fc.integer({ min: -100000, max: 200000 }),
  fc.double({ noNaN: false }),
  fc.constantFrom(null, undefined, true, false, NaN, Infinity, -Infinity),
  fc.array(fc.anything(), { maxLength: 3 }),
  fc.object({ maxDepth: 1 }),
);
const chartValue = fc.oneof(fc.constantFrom(...CHARTS), anyValue);
const rateValue = fc.oneof(fc.integer({ min: -10, max: 90000 }), fc.constantFrom(0, 86400, 86401, -1), anyValue);

const validChart = (v) => typeof v === 'string' && CHARTS.includes(v);
const validRate = (v) => Number.isInteger(v) && v >= 0 && v <= 86400;

test('Property 10: accepts exactly valid defaultChart + refreshRate and names invalid fields', () => {
  fc.assert(
    fc.property(chartValue, rateValue, (defaultChart, refreshRate) => {
      const r = validatePreferences({ defaultChart, refreshRate });
      const c = validChart(defaultChart);
      const n = validRate(refreshRate);
      assert.equal(r.ok, c && n);
      if (r.ok) {
        assert.deepEqual(r.value, { defaultChart, refreshRate });
      } else {
        assert.equal('defaultChart' in r.fields, !c);
        assert.equal('refreshRate' in r.fields, !n);
      }
    }),
    { numRuns: 100 },
  );
});

test('Property 10: non-object bodies are rejected naming both fields', () => {
  fc.assert(
    fc.property(fc.oneof(fc.constant(null), fc.constant(undefined), fc.string(), fc.integer(), fc.array(fc.integer())), (body) => {
      const r = validatePreferences(body);
      assert.equal(r.ok, false);
      assert.ok('defaultChart' in r.fields && 'refreshRate' in r.fields);
    }),
    { numRuns: 100 },
  );
});
