'use strict';
const bcrypt = require('bcrypt');

const DEFAULT_COST = 12;
const MAX_BYTES = 72;

function byteLength(str) {
  return Buffer.byteLength(String(str), 'utf8');
}

async function hashPassword(plain, { cost = DEFAULT_COST } = {}) {
  return bcrypt.hash(plain, cost);
}

// Never throws; false for a bad password, null/non-string hash, or invalid hash.
async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || typeof hash !== 'string' || hash.length === 0) return false;
  try {
    return (await bcrypt.compare(plain, hash)) === true;
  } catch (err) {
    return false;
  }
}

function checkPasswordRules(plain, { min = 1 } = {}) {
  if (typeof plain !== 'string' || plain.length === 0) return { ok: false, reason: 'missing' };
  const bytes = byteLength(plain);
  if (bytes > MAX_BYTES) return { ok: false, reason: 'too_long' };
  if (bytes < min) return { ok: false, reason: 'too_short' };
  return { ok: true };
}

// Valid hash at the production cost, used to equalize login timing for unknown users.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', DEFAULT_COST);

module.exports = {
  DEFAULT_COST,
  MAX_BYTES,
  hashPassword,
  verifyPassword,
  byteLength,
  checkPasswordRules,
  DUMMY_HASH,
};
