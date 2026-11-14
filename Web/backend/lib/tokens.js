'use strict';

const crypto = require('crypto');

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// 32 random bytes; only tokenHash should be persisted.
function createToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

function createResetToken(now = Date.now()) {
  return { ...createToken(), expiresAt: new Date(new Date(now).getTime() + RESET_TOKEN_TTL_MS) };
}

function createEmailToken(now = Date.now()) {
  return { ...createToken(), expiresAt: new Date(new Date(now).getTime() + EMAIL_TOKEN_TTL_MS) };
}

module.exports = {
  RESET_TOKEN_TTL_MS,
  EMAIL_TOKEN_TTL_MS,
  hashToken,
  createToken,
  createResetToken,
  createEmailToken,
};
