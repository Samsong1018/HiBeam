'use strict';

const db = require('../db');

// Queries for the demo route (routes/demo.js). Every function takes an optional executor `ex`
// (a tx from withTransaction), defaulting to the pool, like the other repos.
const exec = (ex) => ex || db;

// The showcase account's id, looked up by username. Null when it doesn't exist.
async function findUserIdByUsername(username, ex) {
  const rows = await exec(ex).query('SELECT id FROM users WHERE username_lc = ? LIMIT 1', [
    String(username).trim().toLowerCase(),
  ]);
  return rows[0] ? rows[0].id : null;
}

// The showcase boards: an owner's public dashboards, oldest first, so the order is stable.
async function listPublicDashboards(ownerId, ex) {
  const rows = await exec(ex).query(
    'SELECT id, name, definition FROM dashboards WHERE owner_id = ? AND is_public = 1 ' +
      'ORDER BY updated_at ASC, id ASC LIMIT 20',
    [ownerId]
  );
  return rows.map((r) => ({
    ...r,
    definition: typeof r.definition === 'string' ? JSON.parse(r.definition) : r.definition,
  }));
}

// Full source rows to copy, including key_enc and file bytes. Owner-scoped; foreign ids are absent.
async function listSourcesForCopy(ownerId, ids, ex) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return exec(ex).query(
    'SELECT id, name, type, status, key_enc, key_last4, file_data, last_sync_at ' +
      'FROM sources WHERE owner_id = ? AND id IN (?)',
    [ownerId, ids]
  );
}

async function insertSourceCopy(ownerId, { id, name, type, status, keyEnc, keyLast4, fileData, lastSyncAt }, ex) {
  await exec(ex).query(
    'INSERT INTO sources (id, owner_id, name, type, status, key_enc, key_last4, file_data, last_sync_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ownerId, name, type, status, keyEnc, keyLast4, fileData || null, lastSyncAt || null]
  );
  return id;
}

async function countDemoUsers(domain, ex) {
  const rows = await exec(ex).query('SELECT COUNT(*) AS n FROM users WHERE email_lc LIKE ?', [
    `%@${domain}`,
  ]);
  return Number(rows[0] ? rows[0].n : 0);
}

// Deletes the oldest demo account created at least minAgeHours ago. Its sessions, sources, boards
// and tokens go with it (ON DELETE CASCADE). Returns true when one was deleted. The derived table
// is how MySQL allows a DELETE to select from its own table.
async function recycleOldestDemoUser(domain, minAgeHours, ex) {
  const res = await exec(ex).query(
    'DELETE FROM users WHERE id = (SELECT id FROM (SELECT id FROM users WHERE email_lc LIKE ? ' +
      'AND created_at < NOW() - INTERVAL ? HOUR ORDER BY created_at ASC, id ASC LIMIT 1) AS oldest)',
    [`%@${domain}`, Number(minAgeHours)]
  );
  return Boolean(res && res.affectedRows > 0);
}

module.exports = {
  findUserIdByUsername,
  listPublicDashboards,
  listSourcesForCopy,
  insertSourceCopy,
  countDemoUsers,
  recycleOldestDemoUser,
};
