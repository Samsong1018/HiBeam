// Unit tests for the APP2 monthly import against the real sample workbook.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

import { ReadWorkbook, CheckSheets, CellValue } from '../APP2/import/workbook.mjs';
import { BuildReport, ApplyReport, PdfName, IsSavings } from '../APP2/import/report.mjs';

const require = createRequire(import.meta.url);
const { validateDashboardDefinition } = require('../Web/backend/lib/validators.js');

const WORKBOOK = new URL('../APP2/John_Doe_finance.xlsx', import.meta.url).pathname;
const TEMPLATE = new URL('../APP2/dashboard.template.json', import.meta.url);
const sheets = await ReadWorkbook(WORKBOOK);

test('the sample workbook reads and passes the layout check', () => {
  CheckSheets(sheets);
  assert.equal(sheets['Budget vs Actual'].length, 11);
  assert.deepEqual(sheets['Net Worth'].at(-1), { Month: 'November', 'Net Worth ($)': 58250 });
});

test('the sample workbook gives the November caption we used to write by hand', () => {
  const r = BuildReport(sheets, { year: 2026 });
  assert.equal(r.name, 'John Doe');
  assert.equal(r.month, 'November');
  assert.equal(r.budgetTotal, 3400);
  assert.equal(r.spentTotal, 3393);
  assert.equal(r.caption, [
    'Clothing (+$110) and Dining Out (+$87) went furthest over budget.',
    'Savings came in $200 under the $600 target.',
    'Net worth rose $950 to $58,250.',
    'Total spending was $357 lower than October.',
    "The Credit Card is the 22.9% APR one, so it's first in line for extra payments.",
  ].join(' '));
  assert.equal(PdfName(r), 'money-report-2026-11.pdf');
});

test('a missing sheet or column is named before anything is uploaded', () => {
  const { 'Net Worth': _gone, ...noNetWorth } = sheets;
  assert.throws(() => CheckSheets(noNetWorth), /missing sheet "Net Worth"/);
  const badDebts = { ...sheets, Debts: [{ Debt: 'Car', 'Balance ($)': 1 }] };
  assert.throws(() => CheckSheets(badDebts), /"Debts" has no "APR \(%\)" column/);
});

test('cells: formula results, rich text and dates become plain values', () => {
  assert.equal(CellValue({ formula: 'A1+B1', result: 42 }), 42);
  assert.equal(CellValue({ richText: [{ text: 'Din' }, { text: 'ing' }] }), 'Dining');
  assert.equal(CellValue(new Date('2026-11-01T00:00:00Z')), '2026-11-01');
  assert.equal(CellValue({ error: '#REF!' }), null);
});

test('savings lines are recognised, other categories are not', () => {
  assert.ok(IsSavings('Savings'));
  assert.ok(IsSavings('Roth IRA'));
  assert.ok(IsSavings('401(k) contribution'));
  assert.ok(!IsSavings('Dining Out'));
  assert.ok(!IsSavings('Pirate costume'), '"ira" inside a word does not count');
});

test('no overspend and a month on the up read correctly', () => {
  const calm = {
    ...sheets,
    'Budget vs Actual': [{ Category: 'Rent', 'Budget ($)': 1400, 'Actual ($)': 1400 }, { Category: 'Savings', 'Budget ($)': 600, 'Actual ($)': 700 }],
    'Monthly Spending': [{ Month: 'November', 'Spending ($)': 3000 }, { Month: 'December', 'Spending ($)': 3200 }],
  };
  const r = BuildReport(calm, { year: 2026 });
  assert.match(r.caption, /^Every category stayed within budget\./);
  assert.match(r.caption, /Savings hit the \$600 target with \$100 to spare\./);
  assert.match(r.caption, /Total spending was \$200 higher than November\./);
  assert.equal(r.month, 'December');
});

test('filled template + report passes the real backend validator', async () => {
  const ids = { budget: 'src_a', spending: 'src_b', networth: 'src_c', accounts: 'src_d', debts: 'src_e' };
  const filled = JSON.parse((await fs.readFile(TEMPLATE, 'utf8')).replace(/\{\{(\w+)\}\}/g, (_, k) => ids[k]));
  const { definition, warnings } = ApplyReport(filled, BuildReport(sheets, { year: 2026 }));
  assert.deepEqual(warnings, []);
  const v = validateDashboardDefinition(definition);
  assert.equal(v.ok, true, JSON.stringify(v.fields));
  const byId = Object.fromEntries(definition.widgets.map((w) => [w.id, w]));
  assert.equal(byId.w_title.config.text, 'John Doe · November 2026');
  assert.equal(byId.w_where.config.title, 'Where November went');
});

test('a board missing a widget is warned about, not broken', () => {
  const { definition, warnings } = ApplyReport({ name: 'x', grid: { columns: 48, showGrid: true }, widgets: [] }, BuildReport(sheets, { year: 2026 }));
  assert.equal(definition.widgets.length, 0);
  assert.equal(warnings.length, 4);
});
