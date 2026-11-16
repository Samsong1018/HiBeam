'use strict';

const db = require('../db');

const exec = (ex) => ex || db;

// ---- Password reset tokens ----

async function createReset(userId, tokenHash, ttlSeconds, ex) {
  const res = await exec(ex).query(
    'INSERT INTO reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
    [userId, tokenHash, ttlSeconds]
  );
  return res.insertId;
}

// Marks the user's earlier unused reset tokens as used.
async function invalidateUnusedReset(userId, ex) {
  const res = await exec(ex).query(
    'UPDATE reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
    [userId]
  );
  return res.affectedRows;
}

// Token-hash lookup. Atomic single-use consume: the conditional UPDATE decides, via
// affectedRows, whether this caller won. Returns { consumed: false } or
// { consumed: true, userId }. Call inside a transaction so a later failure rolls it back.
async function consumeReset(tokenHash, ex) {
  const e = exec(ex);
  const res = await e.query(
    'UPDATE reset_tokens SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
    [tokenHash]
  );
  if (res.affectedRows !== 1) return { consumed: false };
  const rows = await e.query('SELECT user_id FROM reset_tokens WHERE token_hash = ?', [tokenHash]);
  return { consumed: true, userId: rows[0].user_id };
}

// ---- Email confirmation tokens ----

async function createEmail(userId, newEmail, tokenHash, ttlSeconds, ex) {
  const res = await exec(ex).query(
    'INSERT INTO email_tokens (user_id, new_email, token_hash, expires_at) ' +
      'VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
    [userId, newEmail, tokenHash, ttlSeconds]
  );
  return res.insertId;
}

// Token-hash lookup, same conditional UPDATE as consumeReset.
// Returns { consumed: false } or { consumed: true, userId, newEmail }.
async function consumeEmail(tokenHash, ex) {
  const e = exec(ex);
  const res = await e.query(
    'UPDATE email_tokens SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
    [tokenHash]
  );
  if (res.affectedRows !== 1) return { consumed: false };
  const rows = await e.query('SELECT user_id, new_email FROM email_tokens WHERE token_hash = ?', [
    tokenHash,
  ]);
  return { consumed: true, userId: rows[0].user_id, newEmail: rows[0].new_email };
}

module.exports = { createReset, invalidateUnusedReset, consumeReset, createEmail, consumeEmail };
