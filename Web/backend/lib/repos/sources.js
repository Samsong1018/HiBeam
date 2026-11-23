'use strict';

const db = require('../db');

const exec = (ex) => ex || db;

// Columns for toSourceView. key_enc is never selected except by the *WithKey functions.
const VIEW_COLUMNS = 'id, name, type, status, key_last4, last_sync_at';

async function list(userId, ex) {
  return exec(ex).query(
    `SELECT ${VIEW_COLUMNS} FROM sources WHERE owner_id = ? ORDER BY created_at ASC, id ASC`,
    [userId]
  );
}

async function get(userId, id, ex) {
  const rows = await exec(ex).query(
    `SELECT ${VIEW_COLUMNS} FROM sources WHERE id = ? AND owner_id = ?`,
    [id, userId]
  );
  return rows[0] || null;
}

// Includes key_enc, for test/preview calls only. Never pass the result to a view.
async function getWithKey(userId, id, ex) {
  const rows = await exec(ex).query(
    `SELECT ${VIEW_COLUMNS}, owner_id, key_enc FROM sources WHERE id = ? AND owner_id = ?`,
    [id, userId]
  );
  return rows[0] || null;
}

// Owned sources among `ids`, with key_enc. Foreign and missing ids are simply absent.
async function getManyWithKey(userId, ids, ex) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return exec(ex).query(
    `SELECT ${VIEW_COLUMNS}, owner_id, key_enc FROM sources WHERE owner_id = ? AND id IN (?)`,
    [userId, ids]
  );
}

// Returns the subset of `ids` owned by userId (for the dashboard binding check).
async function findOwnedIds(userId, ids, ex) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const rows = await exec(ex).query('SELECT id FROM sources WHERE owner_id = ? AND id IN (?)', [
    userId,
    ids,
  ]);
  return rows.map((r) => r.id);
}

async function create(userId, { id, name, type, keyEnc, keyLast4 }, ex) {
  await exec(ex).query(
    'INSERT INTO sources (id, owner_id, name, type, key_enc, key_last4) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, name, type, keyEnc, keyLast4]
  );
  return id;
}

// Uploaded spreadsheet bytes (excel sources). Returns a Buffer or null.
async function getFile(userId, id, ex) {
  const rows = await exec(ex).query('SELECT file_data FROM sources WHERE id = ? AND owner_id = ?', [
    id,
    userId,
  ]);
  return rows[0] && rows[0].file_data ? rows[0].file_data : null;
}

// Replaces any earlier upload. Only excel sources take a file.
async function setFile(userId, id, buffer, ex) {
  const res = await exec(ex).query(
    "UPDATE sources SET file_data = ?, status = 'untested' WHERE id = ? AND owner_id = ? AND type = 'excel'",
    [buffer, id, userId]
  );
  return res.affectedRows > 0;
}

// status: 'ok' | 'failed' | 'untested'. A successful test also sets last_sync_at.
async function setStatus(userId, id, status, ex) {
  const res = await exec(ex).query(
    "UPDATE sources SET status = ?, last_sync_at = IF(? = 'ok', NOW(), last_sync_at) " +
      'WHERE id = ? AND owner_id = ?',
    [status, status, id, userId]
  );
  return res.affectedRows > 0;
}

async function remove(userId, id, ex) {
  const res = await exec(ex).query('DELETE FROM sources WHERE id = ? AND owner_id = ?', [
    id,
    userId,
  ]);
  return res.affectedRows > 0;
}

module.exports = {
  list,
  get,
  getWithKey,
  getManyWithKey,
  findOwnedIds,
  create,
  getFile,
  setFile,
  setStatus,
  remove,
};
