'use strict';

const db = require('../db');

const exec = (ex) => ex || db;

function parseDefinition(d) {
  if (typeof d === 'string') {
    try { return JSON.parse(d); } catch { return null; }
  }
  return d;
}

// List items: { id, name, updated_at }.
async function list(userId, ex) {
  return exec(ex).query(
    'SELECT id, name, updated_at FROM dashboards WHERE owner_id = ? ORDER BY updated_at DESC, id ASC',
    [userId]
  );
}

// Returns { id, name, definition (parsed object), is_public, updated_at } or null.
async function get(userId, id, ex) {
  const rows = await exec(ex).query(
    'SELECT id, name, definition, is_public, updated_at FROM dashboards WHERE id = ? AND owner_id = ?',
    [id, userId]
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, definition: parseDefinition(r.definition) };
}

// `definition` is the validated definition without id/updatedAt; name mirrors definition.name.
async function create(userId, { id, name, definition }, ex) {
  await exec(ex).query(
    'INSERT INTO dashboards (id, owner_id, name, definition) VALUES (?, ?, ?, ?)',
    [id, userId, name, JSON.stringify(definition)]
  );
  return id;
}

// Returns true when an owned dashboard matched.
async function update(userId, id, { name, definition }, ex) {
  const res = await exec(ex).query(
    'UPDATE dashboards SET name = ?, definition = ?, updated_at = NOW() WHERE id = ? AND owner_id = ?',
    [name, JSON.stringify(definition), id, userId]
  );
  return res.affectedRows > 0;
}

// Leaves updated_at alone: sharing isn't an edit to the dashboard.
async function setVisibility(userId, id, isPublic, ex) {
  const res = await exec(ex).query(
    'UPDATE dashboards SET is_public = ?, updated_at = updated_at WHERE id = ? AND owner_id = ?',
    [isPublic ? 1 : 0, id, userId]
  );
  return res.affectedRows > 0;
}

async function remove(userId, id, ex) {
  const res = await exec(ex).query('DELETE FROM dashboards WHERE id = ? AND owner_id = ?', [
    id,
    userId,
  ]);
  return res.affectedRows > 0;
}

module.exports = { list, get, create, update, setVisibility, remove };
