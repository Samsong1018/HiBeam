// Feature: auth-account-endpoints, Property 15: Unexpected errors are generic
// **Validates: Requirements 16.3, 16.4**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const express = require('express');
const { errorMiddleware, GENERIC_ERROR } = require('../Web/backend/lib/envelope.js');

const DB_VALUES = ['db-host.internal.example', 'dbuser_x9', 'p@ssw0rd-Zq81'];

// Sensitive text: SQL, paths, hosts, credentials. Prefix keeps it distinct from the fixed message.
const sensitive = fc.oneof(
  fc.string({ minLength: 4, maxLength: 40 }).map((s) => `SECRET_${s.replace(/["\\\s]/g, 'x')}`),
  fc.constantFrom(
    'SELECT * FROM users WHERE password_hash = ?',
    "ER_ACCESS_DENIED_ERROR: Access denied for user 'dbuser_x9'@'db-host.internal.example'",
    '/Users/aesop/Coding/app/Web/backend/server.js:42',
    'connect ECONNREFUSED db-host.internal.example:3306',
    'password=p@ssw0rd-Zq81'
  )
);

const errorArb = fc.record({
  message: sensitive,
  stack: sensitive,
  code: fc.constantFrom(undefined, 'ER_DUP_ENTRY', 'ECONNREFUSED'),
  kind: fc.constantFrom('error', 'typeerror', 'string', 'plain')
});

function build(spec) {
  if (spec.kind === 'string') return spec.message;
  if (spec.kind === 'plain') return { message: spec.message, sqlMessage: spec.stack };
  const e = spec.kind === 'typeerror' ? new TypeError(spec.message) : new Error(spec.message);
  e.stack = `${e.name}: ${spec.message}\n    at ${spec.stack}`;
  if (spec.code) e.code = spec.code;
  return e;
}

test('Property 15: unexpected errors yield a generic 500 with no leaked detail', async () => {
  let current;
  const app = express();
  app.get('/boom', () => { throw current; });
  app.get('/boom-async', async () => { throw current; });
  app.use(errorMiddleware);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address();

  const origError = console.error;
  console.error = () => {};
  try {
    await fc.assert(
      fc.asyncProperty(errorArb, fc.constantFrom('/boom', '/boom-async'), async (spec, path) => {
        current = build(spec);
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        const text = await res.text();
        assert.equal(res.status, 500);
        assert.deepEqual(JSON.parse(text), { success: false, error: GENERIC_ERROR });
        const pieces = [spec.message, spec.stack, ...DB_VALUES];
        for (const p of pieces) assert.ok(!text.includes(p), `body leaked: ${p}`);
        assert.ok(!/\n\s+at /.test(text));
      }),
      { numRuns: 100 }
    );
  } finally {
    console.error = origError;
    await new Promise((r) => server.close(r));
  }
});
