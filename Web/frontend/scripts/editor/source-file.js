// ============================================================
// SPREADSHEET FILE CHECK (pure, no DOM)
// What the browser checks before it uploads a workbook for an excel
// source. The server checks the bytes again; this just saves a round
// trip and gives a friendlier message.
// ============================================================

// Same list as the excel field's `accept` in source-types.js.
export const SPREADSHEET_ACCEPT = '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Matches the server's 5 MB upload limit.
export const MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024;

const EXTENSIONS = ['.xlsx', '.csv'];

// file: anything with { name, size } (a File in the browser).
// Returns an error message to show, or null when the file looks fine.
export function checkSpreadsheetFile(file) {
  if (!file || typeof file.name !== 'string') return 'Choose a file.';
  const name = file.name.toLowerCase();
  if (!EXTENSIONS.some((ext) => name.endsWith(ext))) return 'Use a .xlsx or .csv file.';
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return 'That file is empty.';
  if (size > MAX_SOURCE_FILE_BYTES) return 'Files must be under 5 MB.';
  return null;
}
