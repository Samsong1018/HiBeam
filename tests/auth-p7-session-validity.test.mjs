// Feature: auth-account-endpoints, Property 7: Session validity
// **Validates: Requirements 4.3**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const session = require('../Web/backend/lib/session.js');
const tokens = require('../Web/backend/lib/tokens.js');
const { isSessionValid } = session;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const time = fc.integer({ min: 0, max: 4_000_000_000_000 });

test('Property 7: valid iff not revoked and expires_at > now', () => {
  fc.assert(
    fc.property(
      time,
      time,
      fc.option(time, { nil: null }),
      fc.constantFrom('date', 'ms'),
      (expiresMs, nowMs, revokedMs, form) => {
        const expires_at = form === 'date' ? new Date(expiresMs) : expiresMs;
        const revoked_at = revokedMs === null ? null : new Date(revokedMs);
        const expected = revoked_at === null && expiresMs > nowMs;
        assert.equal(isSessionValid({ expires_at, revoked_at }, new Date(nowMs)), expected);
      },
    ),
    { numRuns: 100 },
  );
});

test('isSessionValid is false for missing session or expiry', () => {
  assert.equal(isSessionValid(null, Date.now()), false);
  assert.equal(isSessionValid(undefined, Date.now()), false);
  assert.equal(isSessionValid({ revoked_at: null }, Date.now()), false);
});

test('session cookie has required attributes', () => {
  const c = session.buildSessionCookie('abc');
  assert.ok(c.startsWith('sid=abc'));
  for (const a of ['HttpOnly', 'SameSite=Lax', 'Max-Age=604800', 'Path=/']) {
    assert.ok(c.includes(a), a);
  }
  const clear = session.buildClearCookie();
  assert.ok(clear.startsWith('sid=;'));
  assert.ok(clear.includes('Max-Age=0'));
  assert.ok(clear.includes('HttpOnly'));
});

test('cookie parse round trip for generated session tokens', () => {
  fc.assert(
    fc.property(fc.constant(null), () => {
      const { token } = session.newSessionToken();
      const header = session.buildSessionCookie(token).split(';')[0];
      assert.equal(session.parseCookies(header + '; other=1').sid, token);
    }),
    { numRuns: 20 },
  );
  assert.deepEqual(session.parseCookies(''), {});
  assert.deepEqual(session.parseCookies(undefined), {});
});

test('session and reset/email tokens are 32 bytes with SHA-256 hex hashes', () => {
  const makers = [
    session.newSessionToken(),
    tokens.createToken(),
    tokens.createResetToken(),
    tokens.createEmailToken(),
  ];
  for (const t of makers) {
    assert.equal(Buffer.from(t.token, 'base64url').length, 32);
    assert.match(t.tokenHash, SHA256_HEX);
    assert.equal(t.tokenHash, crypto.createHash('sha256').update(t.token).digest('hex'));
    assert.notEqual(t.tokenHash, t.token);
  }
  assert.equal(tokens.hashToken('x'), crypto.createHash('sha256').update('x').digest('hex'));
});

test('reset and email token expiry windows', () => {
  const now = 1_700_000_000_000;
  assert.equal(tokens.createResetToken(now).expiresAt.getTime() - now, 30 * 60 * 1000);
  assert.equal(tokens.createEmailToken(now).expiresAt.getTime() - now, 24 * 60 * 60 * 1000);
});
