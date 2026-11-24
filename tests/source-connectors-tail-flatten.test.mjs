// Source connectors: log tailing (Range / oversized bodies) and flattening nested REST/JSON rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { previewSource, REASONS, MAX_BYTES, LOG_TAIL_BYTES, defaultTransport } = require('../Web/backend/lib/source-connector.js');
const { FlattenRow, MAX_KEYS, MAX_TEXT } = require('../Web/backend/lib/connectors/flatten.js');
const { AllowedFields, ProjectRows } = require('../Web/backend/lib/public-projection.js');

const PUBLIC_IP = '93.184.216.34';
const src = (type, key) => ({ id: 'src_1', owner_id: 7, type, key_enc: JSON.stringify(key) });

function opts(reply) {
  const seen = [];
  return {
    seen,
    decrypt: (v) => v,
    resolve: async () => [PUBLIC_IP],
    transport: async (req) => { seen.push(req); return typeof reply === 'function' ? reply(req) : reply; },
    timeoutMs: 2000,
  };
}

const line = (i) => `203.0.113.${i % 250} - - [10/Nov/2026:13:55:00 +0000] "GET /p/${i} HTTP/1.1" 200 ${i} "-" "curl/8"`;
const LOG = { url: 'https://x.test/access.log', format: 'nginx' };

// ----------------------------------------------------------------------- tail

test('logs ask for the tail with a Range header, and a 206 drops its partial first line', async () => {
  const body = `${line(9).slice(3)}\n${line(1)}\n${line(2)}\n`;
  const o = opts({ status: 206, headers: { 'content-range': 'bytes 500-999/1000' }, body });
  const rows = await previewSource(src('logs', LOG), o);
  assert.equal(o.seen[0].headers.Range, `bytes=-${LOG_TAIL_BYTES}`);
  assert.equal(o.seen[0].tail, true);
  assert.equal(o.seen[0].address, PUBLIC_IP);
  assert.deepEqual(rows.map((r) => r.path), ['/p/1', '/p/2']);
});

test('a 206 that starts at byte 0 keeps its first line; one without Content-Range drops it', async () => {
  const body = `${line(1)}\n${line(2)}\n`;
  const whole = opts({ status: 206, headers: { 'content-range': 'bytes 0-99/100' }, body });
  assert.deepEqual((await previewSource(src('logs', LOG), whole)).map((r) => r.path), ['/p/1', '/p/2']);
  const bare = opts({ status: 206, body });
  assert.deepEqual((await previewSource(src('logs', LOG), bare)).map((r) => r.path), ['/p/2']);
});

test('a 200 log body over 2 MB keeps the newest lines instead of failing', async () => {
  const lines = [];
  for (let i = 0, size = 0; size <= MAX_BYTES + 4096; i++) { lines.push(line(i)); size += line(i).length + 1; }
  const body = lines.join('\n');
  const rows = await previewSource(src('logs', LOG), opts({ status: 200, body }));
  assert.equal(rows.length, 100);
  assert.equal(rows.at(-1).path, `/p/${lines.length - 1}`);
  assert.equal(rows[0].path, `/p/${lines.length - 100}`);
});

test('non-log sources over 2 MB are tooLarge, not unreachable', async () => {
  const huge = JSON.stringify([{ s: 'x'.repeat(MAX_BYTES) }]);
  await assert.rejects(previewSource(src('json', { url: 'https://x.test/d.json' }), opts({ status: 200, body: huge })), { reason: REASONS.tooLarge });
  const thrower = opts(() => { throw Object.assign(new Error('too large'), { code: 'tooLarge' }); });
  await assert.rejects(previewSource(src('scrape', { url: 'https://x.test/', selector: 'p' }), thrower), { reason: REASONS.tooLarge });
  const down = opts(() => { throw new Error('ECONNRESET'); });
  await assert.rejects(previewSource(src('rest', { url: 'https://x.test/a' }), down), { reason: REASONS.unreachable });
  const o = opts({ status: 200, body: '[1]' });
  await previewSource(src('rest', { url: 'https://x.test/a' }), o);
  assert.equal(o.seen[0].headers.Range, undefined);
  assert.equal(o.seen[0].tail, false);
});

test('the default transport caps bodies, or keeps a rolling tail when asked', async () => {
  const total = MAX_BYTES + 300 * 1024;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    const block = Buffer.alloc(64 * 1024, 97);
    let sent = 0;
    const pump = () => {
      while (sent < total) {
        const chunk = block.subarray(0, Math.min(block.length, total - sent));
        sent += chunk.length;
        if (sent >= total) { res.end(Buffer.concat([chunk.subarray(0, chunk.length - 4), Buffer.from('\nEND')])); return; }
        if (!res.write(chunk)) { res.once('drain', pump); return; }
      }
    };
    pump();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/big.log`;
  try {
    await assert.rejects(defaultTransport({ url, address: '127.0.0.1', headers: {} }), { code: 'tooLarge' });
    const res = await defaultTransport({ url, address: '127.0.0.1', headers: {}, tail: true });
    assert.equal(res.status, 200);
    assert.equal(res.truncated, true);
    assert.equal(Buffer.byteLength(res.body), MAX_BYTES);
    assert.ok(res.body.endsWith('\nEND'));
  } finally {
    server.close();
  }
});

// -------------------------------------------------------------------- flatten

test('nested REST/JSON objects flatten to dotted keys after the path is walked', async () => {
  const body = JSON.stringify({ data: [{ id: 1, user: { name: 'x', geo: { city: 'Oslo', pos: { lat: 1 } } }, tags: ['a', 'b', 3], items: [{ q: 1 }, { q: 2 }], none: [] }] });
  const rows = await previewSource(src('json', { url: 'https://x.test/d.json', path: 'data' }), opts({ status: 200, body }));
  assert.deepEqual(rows, [{
    id: 1,
    'user.name': 'x',
    'user.geo.city': 'Oslo',
    'user.geo.pos': '{"lat":1}', // keys stop at 3 segments; a deeper object is short JSON
    tags: 'a, b, 3',
    items: 2,
    none: '',
  }]);
});

test('flatten skips prototype keys, caps text and key counts, and never mutates', () => {
  const row = JSON.parse('{"__proto__":{"polluted":1},"a":{"constructor":{"x":1},"prototype":2,"ok":true},"b":null}');
  const before = JSON.stringify(row);
  assert.deepEqual(FlattenRow(row), { 'a.ok': true, b: null });
  assert.equal(JSON.stringify(row), before);
  assert.equal({}.polluted, undefined);
  assert.equal(FlattenRow({ t: Array.from({ length: 500 }, () => 'word') }).t.length, MAX_TEXT);
  assert.equal(FlattenRow({ d: { e: { f: { g: 'y'.repeat(1000) } } } })['d.e.f'].length, MAX_TEXT);
  const wide = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, { v: i }]));
  const flat = FlattenRow(wide);
  assert.equal(Object.keys(flat).length, MAX_KEYS);
  assert.equal(flat['k0.v'], 0);
  assert.deepEqual(FlattenRow({ 'a.b': 1, a: { b: 2 } }), { 'a.b': 1 }); // first write wins
});

test('property: flattened rows hold only primitives, at most MAX_KEYS keys, and no prototype keys', () => {
  const key = fc.oneof(fc.string({ maxLength: 6 }), fc.constantFrom('__proto__', 'constructor', 'prototype'));
  const value = fc.letrec((tie) => ({
    node: fc.oneof({ depthSize: 'small' },
      fc.oneof(fc.string(), fc.double(), fc.integer(), fc.boolean(), fc.constant(null)),
      fc.array(tie('node'), { maxLength: 4 }),
      fc.array(fc.tuple(key, tie('node')), { maxLength: 6 }).map((pairs) => Object.fromEntries(pairs))),
  })).node;
  fc.assert(fc.property(fc.array(fc.tuple(key, value), { maxLength: 30 }), (pairs) => {
    const json = JSON.stringify(Object.fromEntries(pairs));
    const flat = FlattenRow(JSON.parse(json));
    assert.equal(Object.getPrototypeOf(flat), Object.prototype);
    assert.ok(Object.keys(flat).length <= MAX_KEYS);
    for (const [k, v] of Object.entries(flat)) {
      assert.ok(v === null || typeof v !== 'object', `object value at ${k}`);
      assert.ok(!k.split('.').some((s) => ['__proto__', 'constructor', 'prototype'].includes(s)), `unsafe key ${k}`);
    }
  }), { numRuns: 200 });
});

test('public projection keeps dotted field names', () => {
  const def = { widgets: [{ type: 'bar', config: { bindings: [{ sourceId: 's1', xField: 'user.name', yField: 'stats.count' }] } }] };
  const rows = [FlattenRow({ user: { name: 'x', email: 'secret@example.com' }, stats: { count: 3 } })];
  assert.deepEqual(ProjectRows(rows, AllowedFields(def).get('s1')), [{ 'user.name': 'x', 'stats.count': 3 }]);
});

test('JSON log lines are flattened like REST rows', async () => {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const { ParseLogs } = req('../Web/backend/lib/connectors/logs.js');
  const { rows } = ParseLogs('{"level":"info","req":{"method":"GET","path":"/"},"__proto__":{"x":1}}', 'json', 10);
  assert.deepEqual(rows, [{ level: 'info', 'req.method': 'GET', 'req.path': '/' }]);
});
