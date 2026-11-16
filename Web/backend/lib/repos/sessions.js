'use strict';

const db = require('../db');
const { SESSION_MAX_AGE_SECONDS } = require('../session');

const exec = (ex) => ex || db;

// Returns the new session id. Expiry is computed by MySQL so it shares a clock with NOW().
async function create(userId, tokenHash, ex) {
  const res = await exec(ex).query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
    [userId, tokenHash, SESSION_MAX_AGE_SECONDS]
  );
  return res.insertId;
}

// Token-hash lookup (exception to owner scoping: this is how the user id is found).
// Returns { id, user_id, expires_at, revoked_at, is_valid } or null. is_valid is evaluated
// by MySQL (not revoked and expires_at > NOW()).
async function findByTokenHash(tokenHash, ex) {
  const rows = await exec(ex).query(
    'SELECT s.id, s.user_id, s.expires_at, s.revoked_at, ' +
      '(s.revoked_at IS NULL AND s.expires_at > NOW()) AS is_valid ' +
      'FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1',
    [tokenHash]
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, is_valid: Boolean(r.is_valid) };
}

async function revoke(userId, sessionId, ex) {
  const res = await exec(ex).query(
    'UPDATE sessions SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    [sessionId, userId]
  );
  return res.affectedRows > 0;
}

// Returns the number of sessions revoked.
async function revokeAll(userId, ex) {
  const res = await exec(ex).query(
    'UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
  return res.affectedRows;
}

async function revokeAllExcept(userId, keepSessionId, ex) {
  const res = await exec(ex).query(
    'UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
    [userId, keepSessionId]
  );
  return res.affectedRows;
}

module.exports = { create, findByTokenHash, revoke, revokeAll, revokeAllExcept };
