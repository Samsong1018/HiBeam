'use strict';

const crypto = require('crypto');

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 604800
const COOKIE_NAME = 'sid';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// 32 random bytes as base64url; only the SHA-256 hex hash is meant to be stored.
function newSessionToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256Hex(token) };
}

function secureSuffix() {
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

function buildSessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/${secureSuffix()}`;
}

function buildClearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/${secureSuffix()}`;
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || header === '') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name || Object.prototype.hasOwnProperty.call(out, name)) continue;
    let value = part.slice(idx + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      value = decodeURIComponent(value);
    } catch (_) {
      // keep raw value
    }
    out[name] = value;
  }
  return out;
}

// session: { expires_at, revoked_at }; now: Date | ms number. Valid iff not revoked and expires_at > now.
function isSessionValid(session, now) {
  if (!session || session.revoked_at != null) return false;
  if (session.expires_at == null) return false;
  const exp = new Date(session.expires_at).getTime();
  const cur = new Date(now).getTime();
  if (Number.isNaN(exp) || Number.isNaN(cur)) return false;
  return exp > cur;
}

module.exports = {
  SESSION_MAX_AGE_SECONDS,
  COOKIE_NAME,
  sha256Hex,
  newSessionToken,
  buildSessionCookie,
  buildClearCookie,
  parseCookies,
  isSessionValid,
};
