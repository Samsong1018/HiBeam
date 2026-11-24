// Client-side check for a replacement spreadsheet (pure module, no DOM).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkSpreadsheetFile, MAX_SOURCE_FILE_BYTES, SPREADSHEET_ACCEPT } from '../Web/frontend/scripts/editor/source-file.js';

test('accepts .xlsx and .csv files of a sane size, any case', () => {
  assert.equal(checkSpreadsheetFile({ name: 'budget.xlsx', size: 2048 }), null);
  assert.equal(checkSpreadsheetFile({ name: 'BUDGET.CSV', size: 1 }), null);
  assert.equal(checkSpreadsheetFile({ name: 'q4.final.xlsx', size: MAX_SOURCE_FILE_BYTES }), null, 'exactly 5 MB is allowed');
});

test('rejects a missing file', () => {
  assert.equal(checkSpreadsheetFile(undefined), 'Choose a file.');
  assert.equal(checkSpreadsheetFile(null), 'Choose a file.');
  assert.equal(checkSpreadsheetFile({ size: 10 }), 'Choose a file.');
});

test('rejects other extensions, including look-alikes', () => {
  for (const name of ['budget.xls', 'budget.xlsm', 'notes.txt', 'budget', 'budget.csv.exe', 'xlsx']) {
    assert.equal(checkSpreadsheetFile({ name, size: 10 }), 'Use a .xlsx or .csv file.', name);
  }
});

test('rejects empty and oversized files', () => {
  assert.equal(checkSpreadsheetFile({ name: 'a.csv', size: 0 }), 'That file is empty.');
  assert.equal(checkSpreadsheetFile({ name: 'a.csv', size: Number.NaN }), 'That file is empty.');
  assert.equal(checkSpreadsheetFile({ name: 'a.xlsx', size: MAX_SOURCE_FILE_BYTES + 1 }), 'Files must be under 5 MB.');
});

test('the 5 MB limit and accept list match the server and the create dialog', () => {
  assert.equal(MAX_SOURCE_FILE_BYTES, 5 * 1024 * 1024);
  assert.ok(SPREADSHEET_ACCEPT.split(',').includes('.xlsx'));
  assert.ok(SPREADSHEET_ACCEPT.split(',').includes('.csv'));
});
