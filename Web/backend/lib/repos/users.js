'use strict';

const db = require('../db');

// Every function takes an optional trailing executor `ex` (a `tx` from withTransaction, or
// anything with query(sql, params) -> Promise). It defaults to the pool.
const exec = (ex) => ex || db;

const PROFILE_COLUMNS =
  'u.username, u.display_name, u.email, u.avatar_updated_at, u.preferences';

// Not owner-scoped: there is no user id yet. Unique indexes raise ER_DUP_ENTRY on conflict.
async function create({ username, email, displayName, passwordHash, preferences }, ex) {
  const res = await exec(ex).query(
    'INSERT INTO users (username, username_lc, email, email_lc, display_name, password_hash, preferences) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      username,
      String(username).toLowerCase(),
      email,
      String(email).toLowerCase(),
      displayName,
      passwordHash,
      JSON.stringify(preferences),
    ]
  );
  return res.insertId;
}

// Login-identifier lookup (exception to owner scoping). Matches username_lc or email_lc.
async function findByIdentifier(identifier, ex) {
  const id = String(identifier).trim().toLowerCase();
  const rows = await exec(ex).query(
    'SELECT id, password_hash FROM users WHERE username_lc = ? OR email_lc = ? LIMIT 1',
    [id, id]
  );
  return rows[0] || null;
}

// Uniqueness check across all users (needed for the email-change 409; the row is never returned).
async function emailExists(email, ex) {
  const rows = await exec(ex).query('SELECT 1 AS x FROM users WHERE email_lc = ? LIMIT 1', [
    String(email).toLowerCase(),
  ]);
  return rows.length > 0;
}

// Profile row for toPublicProfile: no avatar bytes, includes source_count.
async function getProfile(userId, ex) {
  const rows = await exec(ex).query(
    `SELECT ${PROFILE_COLUMNS}, ` +
      '(SELECT COUNT(*) FROM sources s WHERE s.owner_id = u.id) AS source_count ' +
      'FROM users u WHERE u.id = ?',
    [userId]
  );
  return rows[0] || null;
}

async function getPasswordHash(userId, ex) {
  const rows = await exec(ex).query('SELECT password_hash FROM users WHERE id = ?', [userId]);
  return rows[0] ? rows[0].password_hash : null;
}

// Returns true when a row was matched. Throws ER_DUP_ENTRY if the username is taken.
async function updateProfile(userId, { displayName, username }, ex) {
  const res = await exec(ex).query(
    'UPDATE users SET display_name = ?, username = ?, username_lc = ? WHERE id = ?',
    [displayName, username, String(username).toLowerCase(), userId]
  );
  return res.affectedRows > 0;
}

async function setPasswordHash(userId, passwordHash, ex) {
  const res = await exec(ex).query('UPDATE users SET password_hash = ? WHERE id = ?', [
    passwordHash,
    userId,
  ]);
  return res.affectedRows > 0;
}

// Throws ER_DUP_ENTRY if the email now belongs to another user.
async function setEmail(userId, email, ex) {
  const res = await exec(ex).query(
    'UPDATE users SET email = ?, email_lc = ? WHERE id = ?',
    [email, String(email).toLowerCase(), userId]
  );
  return res.affectedRows > 0;
}

async function updatePreferences(userId, preferences, ex) {
  const res = await exec(ex).query('UPDATE users SET preferences = ? WHERE id = ?', [
    JSON.stringify(preferences),
    userId,
  ]);
  return res.affectedRows > 0;
}

// Replaces any earlier avatar. avatar_updated_at is epoch seconds.
async function setAvatar(userId, buffer, mime, ex) {
  const res = await exec(ex).query(
    'UPDATE users SET avatar = ?, avatar_mime = ?, avatar_updated_at = UNIX_TIMESTAMP() WHERE id = ?',
    [buffer, mime, userId]
  );
  return res.affectedRows > 0;
}

async function clearAvatar(userId, ex) {
  const res = await exec(ex).query(
    'UPDATE users SET avatar = NULL, avatar_mime = NULL, avatar_updated_at = NULL WHERE id = ?',
    [userId]
  );
  return res.affectedRows > 0;
}

// Returns { avatar: Buffer, avatar_mime } or null when the user has no avatar.
async function getAvatar(userId, ex) {
  const rows = await exec(ex).query('SELECT avatar, avatar_mime FROM users WHERE id = ?', [userId]);
  const r = rows[0];
  if (!r || r.avatar == null || r.avatar_mime == null) return null;
  return { avatar: r.avatar, avatar_mime: r.avatar_mime };
}

// Deletes everything the user owns, then the user row. Runs in one transaction: when `ex` is
// given the caller owns the transaction, otherwise this opens one. Login attempts are keyed by
// identifier, so they are cleared for the user's username and email.
async function deleteAccount(userId, ex) {
  if (!ex) return db.withTransaction((tx) => deleteAccount(userId, tx));
  const rows = await ex.query('SELECT username_lc, email_lc FROM users WHERE id = ?', [userId]);
  const u = rows[0];
  await ex.query('DELETE FROM dashboards WHERE owner_id = ?', [userId]);
  await ex.query('DELETE FROM sources WHERE owner_id = ?', [userId]);
  await ex.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
  await ex.query('DELETE FROM reset_tokens WHERE user_id = ?', [userId]);
  await ex.query('DELETE FROM email_tokens WHERE user_id = ?', [userId]);
  if (u) {
    await ex.query('DELETE FROM login_attempts WHERE identifier IN (?, ?)', [
      u.username_lc,
      u.email_lc,
    ]);
  }
  const res = await ex.query('DELETE FROM users WHERE id = ?', [userId]);
  return res.affectedRows > 0;
}

module.exports = {
  create,
  findByIdentifier,
  emailExists,
  getProfile,
  getPasswordHash,
  updateProfile,
  setPasswordHash,
  setEmail,
  updatePreferences,
  setAvatar,
  clearAvatar,
  getAvatar,
  deleteAccount,
};
