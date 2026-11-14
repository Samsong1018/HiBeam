// Feature: auth-account-endpoints, Property 1: bcrypt round trip
// Validates: Requirements 1.1, 1.2, 1.3, 1.4
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { hashPassword, verifyPassword, byteLength, DEFAULT_COST } = require('../Web/backend/lib/passwords.js');

const COST = 10;

// 10..72 UTF-8 bytes; NUL excluded because native bcrypt treats it as a string terminator.
const password = fc
  .string({ unit: 'grapheme', minLength: 1, maxLength: 72 })
  .filter((s) => !s.includes('\0') && byteLength(s) >= 10 && byteLength(s) <= 72);

test('Property 1: hash is bcrypt with cost >= 10, hides plaintext, and verifies only the original password', async () => {
  await fc.assert(
    fc.asyncProperty(password, password, async (p, q) => {
      const hash = await hashPassword(p, { cost: COST });
      const m = /^\$2[aby]\$(\d{2})\$/.exec(hash);
      assert.ok(m, 'hash is a bcrypt string');
      assert.ok(Number(m[1]) >= 10, 'cost >= 10');
      assert.ok(!hash.includes(p), 'hash does not contain plaintext');
      assert.equal(await verifyPassword(p, hash), true);
      if (p !== q) assert.equal(await verifyPassword(q, hash), false);
    }),
    { numRuns: 20 }
  );
});

test('production default cost is at least 10', () => {
  assert.ok(DEFAULT_COST >= 10);
});
