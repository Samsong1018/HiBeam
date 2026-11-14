// Feature: auth-account-endpoints, Property 12: Id validation
// Validates: Requirements 14.10
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { isValidId } = require('../Web/backend/lib/validators.js');

const REFERENCE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('');
const validId = fc.string({ unit: fc.constantFrom(...ID_CHARS), minLength: 1, maxLength: 64 });

test('Property 12: isValidId agrees with the id regex for arbitrary strings', () => {
  fc.assert(
    fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' }), validId), (s) => {
      assert.equal(isValidId(s), REFERENCE.test(s));
    }),
    { numRuns: 100 },
  );
});

test('Property 12: accepts every 1-64 char id from the allowed alphabet', () => {
  fc.assert(fc.property(validId, (s) => assert.equal(isValidId(s), true)), { numRuns: 100 });
});

test('Property 12: rejects ids longer than 64 characters', () => {
  fc.assert(
    fc.property(fc.string({ unit: fc.constantFrom(...ID_CHARS), minLength: 65, maxLength: 200 }),
      (s) => assert.equal(isValidId(s), false)),
    { numRuns: 100 },
  );
});

test('Property 12: rejects a valid id with any disallowed character inserted (incl. trailing newline)', () => {
  const bad = fc.constantFrom('\n', '\r', ' ', '/', '\\', '.', '%', '\0', '?', '#', 'é', '\u2028');
  fc.assert(
    fc.property(validId.filter((s) => s.length <= 63), bad, fc.nat(), (s, ch, n) => {
      const i = n % (s.length + 1);
      assert.equal(isValidId(s.slice(0, i) + ch + s.slice(i)), false);
    }),
    { numRuns: 100 },
  );
});

test('Property 12: rejects non-string values', () => {
  fc.assert(
    fc.property(
      fc.oneof(fc.constant(null), fc.constant(undefined), fc.integer(), fc.double(), fc.boolean(),
        fc.array(fc.string()), fc.object(), fc.constant(['abc']), fc.bigInt()),
      (v) => assert.equal(isValidId(v), false),
    ),
    { numRuns: 100 },
  );
});

test('Property 12: edge examples', () => {
  assert.equal(isValidId(''), false);
  assert.equal(isValidId('abc\n'), false);
  assert.equal(isValidId('a'.repeat(64)), true);
  assert.equal(isValidId('a'.repeat(65)), false);
  assert.equal(isValidId('dash_Ab-9'), true);
});
