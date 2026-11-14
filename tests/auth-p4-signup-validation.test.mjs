// Feature: auth-account-endpoints, Property 4: Signup validation and normalization
// **Validates: Requirements 2.2, 2.3, 2.5**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateSignup } = require('../Web/backend/lib/validators.js');

// Independent oracle for each field.
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const expectUsername = (v) => typeof v === 'string' && /^[a-z0-9_]{3,24}$/.test(v.trim().toLowerCase());
const expectEmail = (v) => {
  if (typeof v !== 'string') return false;
  const e = v.trim().toLowerCase();
  return e.length >= 1 && e.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e);
};
const expectDisplay = (v) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 60;
const expectPassword = (v) => typeof v === 'string' && bytes(v) >= 10 && bytes(v) <= 72;

const ws = fc.constantFrom('', ' ', '  ', '\t', '\n');
const padded = (inner) => fc.tuple(ws, inner, ws).map(([a, s, b]) => a + s + b);
const nonString = fc.constantFrom(undefined, null, 42, true, {}, []);

const usernameArb = fc.oneof(
  padded(fc.stringMatching(/^[A-Za-z0-9_]{3,24}$/)),
  padded(fc.string({ maxLength: 30 })),
  fc.string({ unit: 'binary', maxLength: 30 }),
  nonString,
);
const emailArb = fc.oneof(
  padded(fc.emailAddress()),
  padded(fc.tuple(fc.stringMatching(/^[A-Za-z0-9]{1,200}$/), fc.stringMatching(/^[a-z]{1,60}$/))
    .map(([l, d]) => `${l}@${d}.com`)),
  padded(fc.string({ maxLength: 40 })),
  nonString,
);
const displayArb = fc.oneof(
  padded(fc.string({ minLength: 1, maxLength: 60 })),
  padded(fc.string({ minLength: 55, maxLength: 70 })),
  fc.constantFrom('', '   ', '\t'),
  nonString,
);
const passwordArb = fc.oneof(
  fc.string({ minLength: 10, maxLength: 72 }),
  fc.string({ unit: 'binary', maxLength: 80 }),
  fc.string({ unit: 'grapheme', maxLength: 30 }),
  fc.string({ maxLength: 12 }),
  fc.string({ minLength: 70, maxLength: 80 }),
  nonString,
);

test('Property 4: validateSignup accepts exactly valid bodies and normalizes them', () => {
  fc.assert(
    fc.property(usernameArb, emailArb, displayArb, passwordArb, (username, email, displayName, password) => {
      const r = validateSignup({ username, email, displayName, password });
      const expected = {
        username: expectUsername(username),
        email: expectEmail(email),
        displayName: expectDisplay(displayName),
        password: expectPassword(password),
      };
      const allValid = Object.values(expected).every(Boolean);
      assert.equal(r.ok, allValid);
      if (r.ok) {
        assert.equal(r.value.username, username.trim().toLowerCase());
        assert.equal(r.value.email, email.trim().toLowerCase());
        assert.equal(r.value.displayName, displayName.trim());
        assert.equal(r.value.password, password);
      } else {
        const invalid = Object.keys(expected).filter((k) => !expected[k]).sort();
        assert.deepEqual(Object.keys(r.fields).sort(), invalid);
        for (const k of invalid) assert.ok(typeof r.fields[k] === 'string' && r.fields[k].length > 0);
      }
    }),
    { numRuns: 300 },
  );
});

test('Property 4: non-object bodies reject with every field named', () => {
  fc.assert(
    fc.property(fc.constantFrom(undefined, null, 'x', 5, []), (body) => {
      const r = validateSignup(body);
      assert.equal(r.ok, false);
      assert.deepEqual(Object.keys(r.fields).sort(), ['displayName', 'email', 'password', 'username']);
    }),
  );
});
