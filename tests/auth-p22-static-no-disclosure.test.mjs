// Feature: auth-account-endpoints, Property 22: Static route does not disclose other files
// **Validates: Requirements 18.3, 18.9, 18.10**
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { staticAllowlist } = require('../Web/backend/lib/static-allowlist.js');

const API_MARKER = 'API_MARKER_7f3a91c2';
const SERVER_MARKER = 'SERVER_MARKER_5be08d14';
const LIB_MARKER = 'LIB_MARKER_c41d77a0';
const FIXED_404 = { success: false, error: 'Not found' };

let dir;
let emptyDir;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p22-'));
  emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p22-empty-'));
  await fs.writeFile(path.join(dir, 'api.js'), `// ${API_MARKER}\n`);
  await fs.writeFile(path.join(dir, 'server.js'), `// ${SERVER_MARKER}\n`);
  await fs.mkdir(path.join(dir, 'lib'));
  await fs.writeFile(path.join(dir, 'lib', 'secret.js'), `// ${LIB_MARKER}\n`);
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(emptyDir, { recursive: true, force: true });
});

// Drive the middleware with a fake req/res. No cookie header is ever sent.
function run(mw, method, url) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      body: Buffer.alloc(0),
      status(c) { this.statusCode = c; return this; },
      set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      json(obj) {
        this.headers['content-type'] = 'application/json; charset=utf-8';
        this.body = Buffer.from(JSON.stringify(obj));
        resolve(this);
        return this;
      },
      end(data) {
        if (data) this.body = Buffer.from(data);
        resolve(this);
        return this;
      },
    };
    mw({ method, url, originalUrl: url, headers: {} }, res);
  });
}

function assertFixed404(res, url) {
  const text = res.body.toString('utf8');
  assert.equal(res.statusCode, 404, `status for ${url}`);
  assert.deepEqual(JSON.parse(text), FIXED_404, `body for ${url}`);
  for (const m of [API_MARKER, SERVER_MARKER, LIB_MARKER]) {
    assert.ok(!text.includes(m), `marker ${m} leaked for ${url}`);
  }
}

const names = fc.oneof(
  fc.constantFrom(
    'server.js', 'lib/secret.js', 'lib/', 'lib', 'secret.js', 'Server.js', 'SERVER.JS',
    'api.js/', 'api.js.', 'API.js', 'Api.JS', '.env', '.api.js', 'nonexistent.js', 'db/schema.sql',
    '../server.js', '../backend/server.js', '..%2fserver.js', '%2e%2e/server.js', '%2E%2E%2Fserver.js',
    'lib%2fsecret.js', 'lib%2Fsecret.js', 'lib%5csecret.js', 'lib\\secret.js', 'api.js%00',
    'api.js%00.txt', 'server.js%00', 'serv%65r.js', 'lib/../server.js', './server.js', '%2e/server.js'
  ),
    fc.string({ maxLength: 20 }).map((s) => encodeURIComponent(s)),
  fc.stringMatching(/^[A-Za-z0-9._\-\/]{1,24}$/)
).filter((n) => n !== 'api.js');

const methods = fc.constantFrom('GET', 'HEAD');
const suffixes = fc.constantFrom('', '?x=1', '?file=server.js', '#frag');

test('Property 22: non-allowlisted paths give the identical fixed 404 and never leak other files', async () => {
  const mw = staticAllowlist({ dir });
  await fc.assert(
    fc.asyncProperty(names, methods, suffixes, async (name, method, suffix) => {
      const url = `/backend/${name}${suffix}`;
      const res = await run(mw, method, url);
      assertFixed404(res, url);
      // Same headers/body as a nonexistent-name reject.
      const ref = await run(mw, method, '/backend/definitely-not-here.js');
      assert.equal(res.body.toString(), ref.body.toString());
      assert.equal(res.headers['content-type'], ref.headers['content-type']);
    }),
    { numRuns: 200 }
  );
});

test('Property 22: non-GET/HEAD methods and other prefixes give the fixed 404', async () => {
  const mw = staticAllowlist({ dir });
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom('POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'),
      fc.constantFrom('/backend/api.js', '/backend/server.js', '/backend/lib/secret.js'),
      async (method, url) => assertFixed404(await run(mw, method, url), url)
    ),
    { numRuns: 50 }
  );
});

test('Property 22: read errors for the allowlisted file return the same fixed 404', async () => {
  // Missing file.
  const missing = await run(staticAllowlist({ dir: emptyDir }), 'GET', '/backend/api.js');
  assertFixed404(missing, 'missing api.js');
  // api.js is a directory (EISDIR).
  await fs.mkdir(path.join(emptyDir, 'api.js'));
  const isDir = await run(staticAllowlist({ dir: emptyDir }), 'GET', '/backend/api.js');
  assertFixed404(isDir, 'dir api.js');
  // Directory itself does not exist.
  const noDir = await run(staticAllowlist({ dir: path.join(emptyDir, 'nope') }), 'GET', '/backend/api.js');
  assertFixed404(noDir, 'no dir');
  assert.equal(missing.body.toString(), isDir.body.toString());
  assert.equal(missing.body.toString(), noDir.body.toString());
});

test('Property 22: /backend/api.js without a Session cookie returns 200 with only api.js contents', async () => {
  const mw = staticAllowlist({ dir });
  for (const suffix of ['', '?v=1']) {
    const res = await run(mw, 'GET', `/backend/api.js${suffix}`);
    assert.equal(res.statusCode, 200);
    const text = res.body.toString('utf8');
    assert.ok(text.includes(API_MARKER));
    assert.ok(!text.includes(SERVER_MARKER));
    assert.ok(!text.includes(LIB_MARKER));
  }
});
