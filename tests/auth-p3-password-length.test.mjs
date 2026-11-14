// Feature: auth-account-endpoints, Property 3: Password length rules are measured in bytes
// **Validates: Requirements 1.5, 1.6, 2.2, 5.6, 9.3**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkPasswordRules, byteLength } = require('../Web/backend/lib/passwords.js');
const { validateNewPassword, validateSignup, validateChangePassword } = require('../Web/backend/lib/validators.js');

// Mix of ASCII and 2/3/4-byte characters so char count differs from byte count.
const piece = fc.oneof(
  { weight: 3, arbitrary: fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 1 }) },
  { weight: 2, arbitrary: fc.constantFrom('é', 'ñ', 'ü', '€', '日', '本', '😀', '🔒') },
);
const pwd = fc.array(piece, { maxLength: 80 }).map((a) => a.join(''));
// Biased toward the 10 and 72 byte boundaries.
const boundary = fc.tuple(
  fc.constantFrom(8, 9, 10, 11, 70, 71, 72, 73, 74),
  fc.constantFrom('a', 'é', '€', '😀'),
).map(([n, ch]) => {
  const w = Buffer.byteLength(ch);
  let s = '';
  while (Buffer.byteLength(s) + w <= n) s += ch;
  while (Buffer.byteLength(s) < n) s += 'a';
  return s;
});
const anyPwd = fc.oneof(pwd, boundary);

const opts = { numRuns: 200 };

test('checkPasswordRules(min 10) classifies by UTF-8 byte length', () => {
  fc.assert(fc.property(anyPwd, (s) => {
    const n = Buffer.byteLength(s, 'utf8');
    assert.equal(byteLength(s), n);
    const r = checkPasswordRules(s, { min: 10 });
    if (n === 0) assert.deepEqual(r, { ok: false, reason: 'missing' });
    else if (n > 72) assert.deepEqual(r, { ok: false, reason: 'too_long' });
    else if (n < 10) assert.deepEqual(r, { ok: false, reason: 'too_short' });
    else assert.deepEqual(r, { ok: true });
  }), opts);
});

test('checkPasswordRules(min 1) rejects only empty and over 72 bytes', () => {
  fc.assert(fc.property(anyPwd, (s) => {
    const n = Buffer.byteLength(s, 'utf8');
    const r = checkPasswordRules(s, { min: 1 });
    if (n === 0) assert.deepEqual(r, { ok: false, reason: 'missing' });
    else if (n > 72) assert.deepEqual(r, { ok: false, reason: 'too_long' });
    else assert.deepEqual(r, { ok: true });
  }), opts);
});

test('non-string passwords are missing', () => {
  fc.assert(fc.property(fc.oneof(fc.constant(null), fc.constant(undefined), fc.integer(), fc.boolean()), (v) => {
    assert.deepEqual(checkPasswordRules(v, { min: 10 }), { ok: false, reason: 'missing' });
  }), opts);
});

test('validators agree with the byte rule for new passwords', () => {
  fc.assert(fc.property(anyPwd, (s) => {
    const n = Buffer.byteLength(s, 'utf8');
    const expectOk = n >= 10 && n <= 72;

    const r = validateNewPassword(s);
    assert.equal(r.ok, expectOk);
    if (expectOk) assert.equal(r.value, s);
    else assert.ok('password' in r.fields);

    const signup = validateSignup({ username: 'valid_user', email: 'a@b.co', displayName: 'Name', password: s });
    assert.equal(signup.ok, expectOk);
    if (expectOk) assert.equal(signup.value.password, s);
    else assert.deepEqual(Object.keys(signup.fields), ['password']);

    const change = validateChangePassword({ currentPassword: 'old-password-1', newPassword: s });
    assert.equal(change.ok, expectOk);
    if (!expectOk) assert.ok('newPassword' in change.fields);
  }), opts);
});

test('multi-byte strings: 5 emoji (5 chars, 20 bytes) pass; 19 chars of 4 bytes exceed 72', () => {
  assert.equal(validateNewPassword('😀'.repeat(5)).ok, true);
  assert.equal(validateNewPassword('😀'.repeat(18)).ok, true); // 72 bytes
  assert.equal(validateNewPassword('😀'.repeat(19)).ok, false); // 76 bytes
  assert.equal(validateNewPassword('€€€').ok, false); // 3 chars, 9 bytes
  assert.equal(validateNewPassword('€€€€').ok, true); // 4 chars, 12 bytes
});
