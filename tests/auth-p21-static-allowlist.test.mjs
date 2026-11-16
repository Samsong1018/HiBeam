// Feature: auth-account-endpoints, Property 21: Static route serves only the allowlist
// **Validates: Requirements 18.1, 18.2, 18.4, 18.5, 18.6, 18.7, 18.8**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { resolveStaticRequest, staticAllowlist } = require('../Web/backend/lib/static-allowlist.js');

const PREFIX = '/backend/';
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
const OK_METHODS = ['GET', 'HEAD'];
const BAD_METHODS = METHODS.filter((m) => !OK_METHODS.includes(m));

const queryArb = fc.oneof(
  fc.constant(''),
  fc.string({ maxLength: 20 }).map((s) => '?' + s),
  fc.string({ maxLength: 20 }).map((s) => '#' + s),
);

// Encodes each character of "api.js" either literally or as %XX (any hex case).
const encodedApiArb = fc
  .array(fc.record({ enc: fc.boolean(), upper: fc.boolean() }), { minLength: 6, maxLength: 6 })
  .map((flags) =>
    [...'api.js']
      .map((ch, i) => {
        if (!flags[i].enc) return ch;
        const hex = ch.charCodeAt(0).toString(16).padStart(2, '0');
        return '%' + (flags[i].upper ? hex.toUpperCase() : hex);
      })
      .join(''),
  );

const caseVariantArb = fc
  .array(fc.boolean(), { minLength: 6, maxLength: 6 })
  .map((flags) => [...'api.js'].map((ch, i) => (flags[i] ? ch.toUpperCase() : ch)).join(''))
  .filter((s) => s !== 'api.js');

const nameArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);

const nearMissArb = fc.oneof(
  caseVariantArb,
  fc.constantFrom('api.js.', 'api.js ', ' api.js', 'api.jsx', 'api.js.map', 'api', 'apijs', 'xapi.js', 'api.json'),
  nameArb.map((n) => '.' + n),
  fc.constantFrom('server.js', 'package.json', '.env', '.git', '.htaccess'),
);

const traversalArb = fc.oneof(
  fc.constantFrom(
    '../server.js', '..', '../api.js', '..%2fserver.js', '%2e%2e/server.js', '%2E%2E/server.js',
    '%2e%2E/api.js', '.%2e/api.js', '%2e./api.js', 'lib/..%2fapi.js', '..\\server.js', 'a\\api.js',
    'api.js%00', 'api.js%00.png', '%00api.js', 'lib%2fsecret.js', 'lib%2Fsecret.js', '..%5cserver.js',
    '..%5Cserver.js', 'x%5capi.js', 'api%2fjs', 'api.js\0', '%2e%2e%2fserver.js',
  ),
  fc.tuple(nameArb, fc.constantFrom('..', '%2e%2e', '%2E%2e', '%2e%2E', '%2E%2E')).map(([n, t]) => `${n}/${t}/api.js`),
  fc.tuple(nameArb, fc.constantFrom('%2f', '%2F', '%5c', '%5C', '%00', '\\', '\0')).map(([n, t]) => n + t + 'api.js'),
);

const directoryArb = fc.oneof(
  fc.constantFrom('', 'lib', 'lib/', 'db', 'db/', '/', 'lib/secret.js', 'lib/crypto-box.js', 'db/schema.sql'),
  fc.array(nameArb, { minLength: 1, maxLength: 3 }).map((parts) => parts.join('/') + '/'),
  fc.array(nameArb, { minLength: 2, maxLength: 3 }).map((parts) => parts.join('/') + '/api.js'),
);

const rejectedPathArb = fc.oneof(nearMissArb, traversalArb, directoryArb);

test('P21: accepts GET/HEAD for api.js and single-decode encodings, with any query', () => {
  fc.assert(
    fc.property(fc.constantFrom(...OK_METHODS), fc.oneof(fc.constant('api.js'), encodedApiArb), queryArb, (method, name, q) => {
      const r = resolveStaticRequest(PREFIX + name + q, method);
      assert.equal(r.reject, undefined, `should accept ${PREFIX + name + q}`);
      assert.equal(r.file, 'api.js');
    }),
    { numRuns: 200 },
  );
});

test('P21: rejects every method other than GET/HEAD, even for api.js', () => {
  fc.assert(
    fc.property(fc.constantFrom(...BAD_METHODS), fc.oneof(fc.constant('api.js'), encodedApiArb), queryArb, (method, name, q) => {
      assert.equal(resolveStaticRequest(PREFIX + name + q, method).reject, true);
    }),
    { numRuns: 100 },
  );
  for (const m of [undefined, null, '', 'get', 'Get']) {
    assert.equal(resolveStaticRequest('/backend/api.js', m).reject, true);
  }
});

test('P21: rejects traversal, encoded separators, null bytes, backslashes, directories, dotfiles, case variants, server.js and lib/', () => {
  fc.assert(
    fc.property(fc.constantFrom(...METHODS), rejectedPathArb, queryArb, (method, p, q) => {
      const r = resolveStaticRequest(PREFIX + p + q, method);
      assert.equal(r.reject, true, `should reject ${method} ${PREFIX + p + q}`);
      assert.equal(r.file, undefined);
    }),
    { numRuns: 500 },
  );
});

test('P21: acceptance matches the specification oracle for arbitrary strings', () => {
  const oracle = (method, raw) => {
    if (!OK_METHODS.includes(method)) return false;
    if (!raw.startsWith(PREFIX)) return false;
    const rest = raw.slice(PREFIX.length).split(/[?#]/)[0];
    if (/\.\.|%2e%2e|%2f|%5c|%00|\\|\0/i.test(rest)) return false;
    try {
      return decodeURIComponent(rest) === 'api.js';
    } catch {
      return false;
    }
  };
  const chunk = fc.oneof(
    fc.constantFrom('api', '.js', 'a', 'p', 'i', '.', '..', '/', '\\', '%2e', '%2E', '%2f', '%5c', '%00', '%61', '%', '%zz', '?', '#', 'lib', 'server'),
    fc.string({ maxLength: 4 }),
  );
  fc.assert(
    fc.property(fc.constantFrom(...METHODS), fc.array(chunk, { maxLength: 8 }), (method, chunks) => {
      const raw = PREFIX + chunks.join('');
      assert.equal(!resolveStaticRequest(raw, method).reject, oracle(method, raw), `${method} ${JSON.stringify(raw)}`);
    }),
    { numRuns: 1000 },
  );
});

test('P21: paths outside /backend/ and non-string input are rejected', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 30 }).filter((s) => !s.startsWith(PREFIX)), (s) => {
      assert.equal(resolveStaticRequest(s, 'GET').reject, true);
    }),
    { numRuns: 100 },
  );
  for (const v of [undefined, null, 5, {}]) assert.equal(resolveStaticRequest(v, 'GET').reject, true);
});

// ---- Middleware behavior against a temp directory ----

function makeRes() {
  const res = {
    statusCode: undefined, headers: {}, body: undefined, ended: false,
    status(c) { res.statusCode = c; return res; },
    set(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    json(o) { res.body = JSON.stringify(o); res.ended = true; res.done(); return res; },
    end(b) { res.body = b === undefined ? '' : b.toString(); res.ended = true; res.done(); return res; },
  };
  return res;
}

function run(mw, method, url) {
  return new Promise((resolve) => {
    const res = makeRes();
    res.done = () => resolve(res);
    mw({ method, originalUrl: url, url }, res);
  });
}

test('P21: middleware serves api.js and returns one identical 404 body for all rejected requests', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p21-'));
  try {
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'api.js'), 'MARKER_API_JS');
    fs.writeFileSync(path.join(dir, 'server.js'), 'MARKER_SERVER_JS');
    fs.writeFileSync(path.join(dir, '.env'), 'MARKER_DOTENV');
    fs.writeFileSync(path.join(dir, 'lib', 'secret.js'), 'MARKER_LIB_SECRET');
    const mw = staticAllowlist({ dir });

    const okRes = await run(mw, 'GET', '/backend/api.js');
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.body, 'MARKER_API_JS');
    assert.match(okRes.headers['content-type'], /javascript/);

    const headRes = await run(mw, 'HEAD', '/backend/api.js?x=1');
    assert.equal(headRes.statusCode, 200);
    assert.equal(headRes.body, '');

    const missing = await run(mw, 'GET', '/backend/nope.js');
    assert.equal(missing.statusCode, 404);
    const baseline = missing.body;

    const urls = [
      '/backend/server.js', '/backend/lib/secret.js', '/backend/lib/', '/backend/', '/backend/.env',
      '/backend/API.JS', '/backend/../server.js', '/backend/%2e%2e/server.js', '/backend/lib%2fsecret.js',
      '/backend/api.js%00', '/backend/lib\\secret.js', '/backend/Api.js',
    ];
    for (const u of urls) {
      const r = await run(mw, 'GET', u);
      assert.equal(r.statusCode, 404, u);
      assert.equal(r.body, baseline, u);
    }
    for (const m of BAD_METHODS) {
      const r = await run(mw, m, '/backend/api.js');
      assert.equal(r.statusCode, 404, m);
      assert.equal(r.body, baseline, m);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
