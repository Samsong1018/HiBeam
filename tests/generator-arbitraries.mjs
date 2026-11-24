// Shared fast-check arbitraries for the dashboard-generator property tests.
// Not a test file itself (the npm test glob only picks up *.test.mjs).
import fc from 'fast-check';

export const COLUMNS = [24, 48, 72, 96];

const LONG_NAME = 'n'.repeat(121);
export const FIELD_NAMES = [
  'id', 'ID', 'user_id', 'sessionId', 'status', 'up', 'time', 'Month', 'Category',
  'revenue', 'Amount ($)', 'cpuPct', 'Net Worth ($)', 'orderCount', 'note', 'region', LONG_NAME,
];

const value = fc.oneof(
  fc.integer({ min: -5, max: 5 }),
  fc.integer({ min: -1e6, max: 1e9 }),
  fc.double({ noNaN: false, noDefaultInfinity: false }),
  fc.constantFrom('1,200', '$40', '45%', ' 7 ', 'n/a'),
  fc.constantFrom('2026-01-01', '2026-11-24T18:31:07Z', '2026/02/03', '2026-13-45'),
  fc.constantFrom('June', 'Jul', 'Aug 2026', '14:05', '09:30:15'),
  fc.constantFrom('N', 'S', 'E', 'W', 'alive', 'dead'),
  fc.string({ maxLength: 12 }),
  fc.string({ minLength: 81, maxLength: 90 }),
  fc.constantFrom(null, undefined, '', true, false),
  fc.constant({ nested: 1 }),
);

const row = fc.dictionary(fc.constantFrom(...FIELD_NAMES), value, { maxKeys: 6 });

export const rows = fc.array(
  fc.oneof({ weight: 12, arbitrary: row }, { weight: 1, arbitrary: fc.constantFrom(null, 3, 'row', [1, 2]) }),
  { maxLength: 40 },
);

export const source = fc.record({
  id: fc.stringMatching(/^[A-Za-z0-9_-]{1,64}$/),
  name: fc.string({ maxLength: 100 }),
});

export const inputs = fc.array(fc.record({ source, rows }), { minLength: 1, maxLength: 4 });

export const columns = fc.constantFrom(...COLUMNS);

export function counter() {
  let n = 0;
  return (prefix = 'w') => `${prefix}_${++n}`;
}

// A small, already-normalized dashboard to append to.
export const current = fc.record({
  columns,
  existing: fc.array(fc.record({
    y: fc.integer({ min: 0, max: 200 }),
    h: fc.integer({ min: 1, max: 20 }),
  }), { maxLength: 8 }),
}).map(({ columns: cols, existing }) => ({
  name: 'Board',
  grid: { columns: cols, showGrid: true },
  widgets: existing.map(({ y, h }, i) => ({
    id: `old_${i}`, type: 'text', x: 0, y, w: Math.min(12, cols), h,
    config: { title: '', body: 'note', fontSize: 'md', bindings: [] },
  })),
}));

export const plainRows = (list) => (Array.isArray(list) ? list : [])
  .filter((r) => r !== null && typeof r === 'object' && !Array.isArray(r)).slice(0, 100);
