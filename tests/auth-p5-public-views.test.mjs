// Feature: auth-account-endpoints, Property 5: Public views never expose secrets
// **Validates: Requirements 1.8, 6.3, 14.4**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
process.env.SOURCE_KEY_SECRET = crypto.randomBytes(32).toString('base64');
const { toPublicProfile, toSourceView } = require('../Web/backend/lib/views.js');
const { encryptKey, decryptKey } = require('../Web/backend/lib/crypto-box.js');

const PROFILE_KEYS = ['username', 'displayName', 'email', 'avatarUrl', 'preferences', 'sourceCount'];
const SOURCE_KEYS = ['id', 'name', 'type', 'status', 'keyLast4', 'lastSyncAt'];

// Secret fields that must never be copied. Values carry a marker that legit data never contains.
const SECRET_FIELDS = [
  'password_hash', 'avatar', 'avatar_data', 'avatar_mime', 'encrypted_key',
  'key_encrypted', 'token', 'token_hash', 'session_token', 'reset_token', 'failed_attempts', 'locked_until',
];
const secretValueArb = fc.stringMatching(/^[0-9a-f]{8,24}$/).map((h) => `ZZSECRETZZ${h}`);
const secretsArb = fc
  .tuple(...SECRET_FIELDS.map(() => secretValueArb))
  .map((vals) => Object.fromEntries(SECRET_FIELDS.map((f, i) => [f, vals[i]])));

const plain = fc.stringMatching(/^[a-z0-9]{1,16}$/);
const userRowArb = fc.record({
  username: plain,
  display_name: plain,
  email: fc.option(plain.map((s) => `${s}@example.com`), { nil: null }),
  avatar_updated_at: fc.option(fc.integer({ min: 0, max: 2 ** 40 }), { nil: null }),
  preferences: fc.oneof(
    fc.constant(null),
    fc.record({ theme: fc.constantFrom('light', 'dark') }),
    fc.record({ theme: fc.constantFrom('light', 'dark') }).map((o) => JSON.stringify(o)),
  ),
  source_count: fc.integer({ min: 0, max: 1000 }),
});
const sourceRowArb = fc.record({
  id: fc.integer({ min: 1, max: 1e6 }),
  name: plain,
  type: fc.constantFrom('rest', 'csv', 'json'),
  status: fc.constantFrom('ok', 'error', 'pending'),
  key_last4: fc.option(plain, { nil: null }),
  last_sync_at: fc.option(fc.integer({ min: 0, max: 2 ** 40 }), { nil: null }),
});

function assertNoLeak(view, secrets) {
  const json = JSON.stringify(view);
  for (const [name, value] of Object.entries(secrets)) {
    assert.ok(!json.includes(value), `value of ${name} leaked`);
    assert.ok(!json.includes(`"${name}"`), `field name ${name} leaked`);
  }
  assert.ok(!json.includes('data:'), 'data: URL present');
  assert.ok(!json.includes('ZZSECRETZZ'));
}

test('toPublicProfile exposes only allow-listed fields and no secrets', () => {
  fc.assert(
    fc.property(userRowArb, secretsArb, (user, secrets) => {
      const view = toPublicProfile({ ...user, ...secrets });
      assert.deepEqual(Object.keys(view).sort(), [...PROFILE_KEYS].sort());
      assertNoLeak(view, secrets);
      if (view.avatarUrl !== null) {
        assert.match(view.avatarUrl, /^\/api\/account\/avatar\?v=\d+$/);
      } else {
        assert.equal(user.avatar_updated_at, null);
      }
    }),
    { numRuns: 100 },
  );
});

test('toSourceView exposes only allow-listed fields and no secrets', () => {
  fc.assert(
    fc.property(sourceRowArb, secretsArb, (src, secrets) => {
      const view = toSourceView({ ...src, ...secrets });
      assert.deepEqual(Object.keys(view).sort(), [...SOURCE_KEYS].sort());
      assertNoLeak(view, secrets);
    }),
    { numRuns: 100 },
  );
});

test('encryptKey output does not contain plaintext and round-trips', () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[A-Za-z0-9]{12,40}$/), (plainKey) => {
      const blob = encryptKey(plainKey);
      assert.ok(!blob.includes(plainKey));
      assert.ok(!Buffer.from(blob, 'base64').toString('latin1').includes(plainKey));
      assert.equal(decryptKey(blob), plainKey);
      // A source row carrying the blob still yields a view without it.
      const view = toSourceView({ id: 1, name: 'n', type: 'rest', status: 'ok', key_last4: plainKey.slice(-4), encrypted_key: blob });
      assert.ok(!JSON.stringify(view).includes(blob));
      assert.ok(!JSON.stringify(view).includes(plainKey));
    }),
    { numRuns: 50 },
  );
});
