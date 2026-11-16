'use strict';

const db = require('../db');

const exec = (ex) => ex || db;

// Login attempts are keyed by identifier (the user may not exist), not by user id.
// Identifiers are trimmed and lowercased here, matching lib/lockout.js.
const norm = (identifier) => String(identifier).trim().toLowerCase();

async function record(identifier, success, ex) {
  await exec(ex).query('INSERT INTO login_attempts (identifier, success) VALUES (?, ?)', [
    norm(identifier),
    success ? 1 : 0,
  ]);
}

// Returns [{ at: ms, success: boolean }] for lib/lockout.evaluateLockout.
// Only attempts from the last `windowSeconds` are read (default 24h; older ones cannot matter).
async function listRecent(identifier, windowSeconds = 86400, ex) {
  const rows = await exec(ex).query(
    'SELECT UNIX_TIMESTAMP(`at`) * 1000 AS at_ms, success FROM login_attempts ' +
      'WHERE identifier = ? AND `at` > DATE_SUB(NOW(3), INTERVAL ? SECOND) ORDER BY `at` ASC, id ASC',
    [norm(identifier), windowSeconds]
  );
  return rows.map((r) => ({ at: Math.round(Number(r.at_ms)), success: Boolean(r.success) }));
}

// Clears the history after a successful login.
async function clear(identifier, ex) {
  const res = await exec(ex).query('DELETE FROM login_attempts WHERE identifier = ?', [
    norm(identifier),
  ]);
  return res.affectedRows;
}

module.exports = { record, listRecent, clear };
