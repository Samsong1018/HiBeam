// Hardening from the public-deploy security review: rate-limit path matching, own-address SSRF
// block, real zip-bomb inflation cap, same-origin writes, fan-out limits, quotas, JSON 404.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const express = require('express');
const { CreateApp, SOURCE_FETCH_PATHS } = require('../Web/backend/server.js');
const { isBlockedAddress } = require('../Web/backend/lib/source-connector.js');
const { SpreadsheetRows } = require('../Web/backend/lib/connectors/spreadsheet.js');
const { sameOriginWrites } = require('../Web/backend/lib/security.js');
const { MapLimited, MAX_SOURCES_PER_USER, MAX_DASHBOARDS_PER_USER } = require('../Web/backend/lib/limits.js');
const CreateSourcesRouter = require('../Web/backend/lib/routes/sources.js');

async function withApp(app, fn) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

// ---- rate-limited paths ----

test('source-fetch limiter paths match regardless of case (Express routes are case-insensitive)', () => {
  for (const p of ['/src_a/test', '/src_a/TEST', '/src_a/Preview/', '/src_a/PREVIEW']) {
    assert.ok(SOURCE_FETCH_PATHS.sources.test(p), p);
  }
  for (const p of ['/dash_a/data', '/dash_a/DATA', '/dash_a/Data/']) {
    assert.ok(SOURCE_FETCH_PATHS.dashboards.test(p), p);
  }
  assert.ok(!SOURCE_FETCH_PATHS.sources.test('/src_a/file'));
  assert.ok(!SOURCE_FETCH_PATHS.dashboards.test('/dash_a'));
});

// ---- SSRF ----

test('every address on this host is blocked, including IPv4-mapped forms', () => {
  const addrs = Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => i.address);
  assert.ok(addrs.length > 0);
  for (const a of addrs) {
    assert.equal(isBlockedAddress(a), true, a);
    if (!a.includes(':')) assert.equal(isBlockedAddress(`::ffff:${a}`), true, `::ffff:${a}`);
  }
});

test('an address that is not ours is blocked only when given in the own-address set', () => {
  assert.equal(isBlockedAddress('8.8.8.8', new Set()), false);
  assert.equal(isBlockedAddress('8.8.8.8', new Set(['4:8.8.8.8'])), true);
  assert.equal(isBlockedAddress('::ffff:8.8.8.8', new Set(['4:8.8.8.8'])), true);
});

test('documentation, Teredo and local NAT64 ranges are blocked', () => {
  for (const a of ['192.0.2.1', '198.51.100.7', '203.0.113.9', '192.88.99.1', '2001::1', '2001:db8::1', '64:ff9b:1::1']) {
    assert.equal(isBlockedAddress(a, new Set()), true, a);
  }
  for (const a of ['1.1.1.1', '2606:4700::1111']) assert.equal(isBlockedAddress(a, new Set()), false, a);
});

// ---- zip bombs ----

// Minimal one-entry zip with a deflated body whose declared sizes are pDeclared (a lie when smaller).
function ZipWith(pName, pBody, pDeclared) {
  const name = Buffer.from(pName);
  const data = zlib.deflateRawSync(pBody);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(pDeclared, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(pDeclared, 24); central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

test('a zip that lies about its uncompressed size is refused before parsing', async () => {
  const bomb = ZipWith('xl/sharedStrings.xml', Buffer.alloc(60 * 1024 * 1024), 100);
  assert.ok(bomb.length < 1024 * 1024);
  await assert.rejects(SpreadsheetRows(bomb, undefined, 5), (e) => e.code === 'badFile');
});

// ---- same-origin writes ----

test('state-changing requests from another origin or site are refused; same-origin and non-browser pass', async () => {
  const app = express();
  app.use(sameOriginWrites());
  app.all('/x', (req, res) => res.json({ ok: true }));
  await withApp(app, async (base) => {
    const host = new URL(base).host;
    const post = (headers) => fetch(`${base}/x`, { method: 'POST', headers }).then((r) => r.status);
    assert.equal(await post({}), 200);
    assert.equal(await post({ origin: base, 'sec-fetch-site': 'same-origin' }), 200);
    assert.equal(await post({ origin: 'https://evil.somab.dev' }), 403);
    assert.equal(await post({ 'sec-fetch-site': 'same-site' }), 403);
    assert.equal(await post({ 'sec-fetch-site': 'cross-site', origin: `http://${host}` }), 403);
    assert.equal(await post({ origin: 'null' }), 403);
    assert.equal(await fetch(`${base}/x`, { headers: { origin: 'https://evil.example' } }).then((r) => r.status), 200);
  });
});

// ---- fan-out and quotas ----

test('MapLimited never runs more than the limit at once and visits every item', async () => {
  let live = 0;
  let peak = 0;
  const seen = [];
  await MapLimited([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    seen.push(n); live -= 1;
  });
  assert.equal(peak, 4);
  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await MapLimited([], 4, async () => assert.fail('no items'));
});

test('creating a source past the per-user cap is refused without touching the store', async () => {
  let created = 0;
  const sources = {
    list: async () => Array.from({ length: MAX_SOURCES_PER_USER }, (_, i) => ({ id: `s${i}` })),
    create: async () => { created += 1; },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.userId = 1; next(); });
  app.use('/api/sources', CreateSourcesRouter({ sources }));
  await withApp(app, async (base) => {
    const res = await fetch(`${base}/api/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', type: 'rest', key: JSON.stringify({ url: 'https://example.com/a.json' }) }),
    });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /limit/i);
  });
  assert.equal(created, 0);
  assert.ok(MAX_DASHBOARDS_PER_USER > 0);
});

// ---- unknown API routes ----

test('unknown /api routes answer with the JSON envelope', async () => {
  await withApp(CreateApp(), async (base) => {
    const res = await fetch(`${base}/api/nope/xyz`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /json/);
    assert.deepEqual(await res.json(), { success: false, error: 'Not found' });
  });
});
