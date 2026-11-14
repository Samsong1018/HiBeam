// Feature: auth-account-endpoints, Property 2: Invalid stored hashes never verify
// **Validates: Requirements 1.7**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { verifyPassword } = require('../Web/backend/lib/passwords.js');

const BCRYPT_SHAPE = /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/;

// Strings that are not well-formed bcrypt hashes, plus near-miss prefixes.
const invalidHashString = fc
  .oneof(
    fc.string(),
    fc.string({ unit: 'binary' }),
    fc.constant(''),
    fc.string().map((s) => '$2b$12$' + s),
    fc.string().map((s) => '$2a$04$' + s.slice(0, 20)),
  )
  .filter((s) => !BCRYPT_SHAPE.test(s));

const nonString = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.boolean(),
  fc.object(),
  fc.array(fc.string()),
);

const invalidHash = fc.oneof(invalidHashString, nonString);
const password = fc.oneof(fc.string(), fc.constant(''), nonString);

test('Property 2: invalid stored hashes never verify and never throw', async () => {
  await fc.assert(
    fc.asyncProperty(password, invalidHash, async (plain, hash) => {
      const result = await verifyPassword(plain, hash);
      assert.equal(result, false);
    }),
    { numRuns: 100 },
  );
});
