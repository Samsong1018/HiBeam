// Feature: auth-account-endpoints, Property 14: Envelope format
// **Validates: Requirements 16.1, 16.2, 16.5**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { ok, fail, errorMiddleware, HttpError } = require('../Web/backend/lib/envelope.js');

function fakeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = JSON.parse(JSON.stringify(payload)); return this; },
  };
  return res;
}

const statusArb = fc.integer({ min: 200, max: 599 });
const jsonArb = fc.jsonValue();

test('ok() yields exactly { success: true, data }', () => {
  fc.assert(
    fc.property(statusArb, jsonArb, (status, data) => {
      const res = fakeRes();
      ok(res, status, data);
      assert.equal(res.statusCode, status);
      assert.deepEqual(Object.keys(res.body).sort(), ['data', 'success']);
      assert.equal(res.body.success, true);
      assert.deepEqual(res.body.data, JSON.parse(JSON.stringify(data)));
    }),
    { numRuns: 100 }
  );
});

test('fail() yields success:false, non-empty string error, no data key', () => {
  fc.assert(
    fc.property(statusArb, fc.anything(), (status, error) => {
      const res = fakeRes();
      fail(res, status, error);
      assert.equal(res.statusCode, status);
      assert.deepEqual(Object.keys(res.body).sort(), ['error', 'success']);
      assert.equal(res.body.success, false);
      assert.equal(typeof res.body.error, 'string');
      assert.ok(res.body.error.length > 0);
      assert.ok(!('data' in res.body));
      if (typeof error === 'string' && error.length > 0) assert.equal(res.body.error, error);
    }),
    { numRuns: 100 }
  );
});

test('errorMiddleware failures follow the failure envelope', () => {
  const origError = console.error;
  console.error = () => {};
  try {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string().map((m) => new Error(m)),
          fc.tuple(fc.integer({ min: 400, max: 499 }), fc.string({ minLength: 1 })).map(([s, m]) => new HttpError(s, m)),
          fc.constantFrom('entity.parse.failed', 'entity.too.large').map((type) => Object.assign(new Error('x'), { type })),
          fc.anything()
        ),
        (err) => {
          const res = fakeRes();
          errorMiddleware(err, { method: 'GET', path: '/x' }, res, () => {});
          assert.ok(res.statusCode >= 400);
          assert.equal(res.body.success, false);
          assert.equal(typeof res.body.error, 'string');
          assert.ok(res.body.error.length > 0);
          assert.ok(!('data' in res.body));
        }
      ),
      { numRuns: 100 }
    );
  } finally {
    console.error = origError;
  }
});
