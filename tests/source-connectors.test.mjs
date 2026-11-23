// Source connectors: rest/json path, scrape, logs, sql, excel/csv, plus the spreadsheet upload route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { previewSource, testSource, REASONS } = require('../Web/backend/lib/source-connector.js');
const { ParseCsvRecords } = require('../Web/backend/lib/connectors/spreadsheet.js');
const ExcelJS = require('exceljs');
const express = require('express');
const CreateSourcesRouter = require('../Web/backend/lib/routes/sources.js');

const PUBLIC_IP = '93.184.216.34';
const src = (type, key, extra = {}) => ({ id: 'src_1', owner_id: 7, type, key_enc: typeof key === 'string' ? key : JSON.stringify(key), ...extra });

function opts({ body = '', status = 200, file = null, mysql, resolve } = {}) {
  const seen = [];
  return {
    seen,
    decrypt: (v) => v,
    resolve: resolve || (async () => [PUBLIC_IP]),
    transport: async (req) => { seen.push(req); return { status, body }; },
    loadFile: async () => file,
    mysql,
    timeoutMs: 2000,
  };
}

// ---------------------------------------------------------------- rest / json

test('json path walks into nested arrays; a missing path is a clear error', async () => {
  const o = opts({ body: JSON.stringify({ data: { items: [{ a: 1 }, { a: 2 }] } }) });
  assert.deepEqual(await previewSource(src('json', { url: 'https://x.test/d.json', path: 'data.items' }), o), [{ a: 1 }, { a: 2 }]);
  await assert.rejects(previewSource(src('json', { url: 'https://x.test/d.json', path: 'data.nope' }), o), { reason: REASONS.badPath });
  await assert.rejects(previewSource(src('json', { url: 'https://x.test/d.json', path: '__proto__' }), o), { reason: REASONS.badPath });
});

test('rest keeps plain-URL keys and bearer tokens working', async () => {
  const o = opts({ body: '[1,2]' });
  assert.deepEqual(await previewSource(src('rest', { url: 'https://x.test/a', token: 'tok' }), o), [{ value: 1 }, { value: 2 }]);
  assert.equal(o.seen[0].headers.Authorization, 'Bearer tok');
  assert.equal(o.seen[0].address, PUBLIC_IP);
  assert.deepEqual(await previewSource(src('rest', 'https://x.test/a'), o), [{ value: 1 }, { value: 2 }]);
});

test('unknown types are still unsupported, and private hosts are still blocked', async () => {
  await assert.rejects(previewSource(src('ftp', 'x'), opts()), { reason: REASONS.unsupported });
  await assert.rejects(previewSource(src('toString', 'x'), opts()), { reason: REASONS.unsupported });
  await assert.rejects(previewSource(src('scrape', { url: 'http://127.0.0.1/', selector: 'p' }), opts()), { reason: REASONS.blockedUrl });
  const internal = opts({ resolve: async () => ['10.0.0.5'] });
  await assert.rejects(previewSource(src('logs', { url: 'https://logs.internal/a.log' }), internal), { reason: REASONS.blockedUrl });
});

// --------------------------------------------------------------------- scrape

const PAGE = `<html><body>
  <table class="prices"><thead><tr><th>Plan</th><th>Price</th><th>Seats</th></tr></thead>
    <tbody><tr><td>Starter</td><td>$9.99</td><td>1</td></tr><tr><td>Team</td><td>$1,299</td><td>25</td></tr></tbody></table>
  <ul><li><a href="/a">Alpha</a></li><li><a href="/b"> Beta  42 </a></li></ul>
  <script>document.write('nope')</script></body></html>`;

test('scrape turns table rows into objects keyed by the header, with numbers parsed', async () => {
  const o = opts({ body: PAGE });
  const expected = [{ Plan: 'Starter', Price: 9.99, Seats: 1 }, { Plan: 'Team', Price: 1299, Seats: 25 }];
  assert.deepEqual(await previewSource(src('scrape', { url: 'https://x.test/', selector: 'table.prices tr' }), o), expected);
  assert.deepEqual(await previewSource(src('scrape', { url: 'https://x.test/', selector: 'table.prices' }), o), expected);
  assert.match(o.seen[0].headers.Accept, /text\/html/);
});

test('scrape on other elements gives text/value/href rows; bad selectors are reported', async () => {
  const o = opts({ body: PAGE });
  assert.deepEqual(await previewSource(src('scrape', { url: 'https://x.test/', selector: 'li a' }), o), [
    { text: 'Alpha', value: 'Alpha', href: '/a' },
    { text: 'Beta 42', value: 'Beta 42', href: '/b' },
  ]);
  assert.deepEqual(await previewSource(src('scrape', { url: 'https://x.test/', selector: '.missing' }), o), []);
  await assert.rejects(previewSource(src('scrape', { url: 'https://x.test/', selector: 'a[[[' }), o), { reason: REASONS.badSelector });
  await assert.rejects(previewSource(src('scrape', { url: 'https://x.test/', selector: '' }), o), { reason: REASONS.badSelector });
});

// ----------------------------------------------------------------------- logs

test('logs parse nginx/apache combined lines and keep the newest rows', async () => {
  const line = (i) => `203.0.113.${i} - - [10/Nov/2026:13:55:${String(i % 60).padStart(2, '0')} +0000] "GET /p/${i} HTTP/1.1" 200 ${i} "-" "curl/8"`;
  const body = ['garbage line', ...Array.from({ length: 150 }, (_, i) => line(i))].join('\n');
  const rows = await previewSource(src('logs', { url: 'https://x.test/a.log', format: 'nginx' }), opts({ body }));
  assert.equal(rows.length, 100);
  assert.equal(rows[99].path, '/p/149');
  assert.deepEqual(rows[0], { time: '2026-11-10T13:55:50.000Z', ip: '203.0.113.50', user: null, method: 'GET', path: '/p/50', status: 200, bytes: 50, referrer: null, userAgent: 'curl/8' });
});

test('logs parse json lines and syslog; nothing matching is an error, empty is fine', async () => {
  const json = '{"level":"info","ms":12}\nnot json\n{"level":"error","ms":40}\n';
  assert.deepEqual(await previewSource(src('logs', { url: 'https://x.test/a', format: 'json' }), opts({ body: json })),
    [{ level: 'info', ms: 12 }, { level: 'error', ms: 40 }]);
  const sys = '<34>Nov  3 22:14:15 web01 sshd[4721]: Failed password for root';
  assert.deepEqual(await previewSource(src('logs', { url: 'https://x.test/a', format: 'syslog' }), opts({ body: sys })),
    [{ time: 'Nov 3 22:14:15', host: 'web01', program: 'sshd', pid: 4721, message: 'Failed password for root' }]);
  await assert.rejects(previewSource(src('logs', { url: 'https://x.test/a', format: 'syslog' }), opts({ body: json })), { reason: REASONS.noLogLines });
  assert.deepEqual(await previewSource(src('logs', { url: 'https://x.test/a', format: 'json' }), opts({ body: '' })), []);
});

// ---------------------------------------------------------------------- excel

test('csv uploads parse quotes, embedded newlines, and alternate delimiters', async () => {
  const csv = Buffer.from('﻿month,revenue,note\nJan,"1,200","said ""hi""\nthere"\nFeb,900,\n');
  assert.deepEqual(await previewSource(src('excel', {}), opts({ file: csv })), [
    { month: 'Jan', revenue: 1200, note: 'said "hi"\nthere' },
    { month: 'Feb', revenue: 900, note: '' },
  ]);
  assert.deepEqual(ParseCsvRecords('a;b\n1;2', 10), [['a', 'b'], ['1', '2']]);
  const evil = Buffer.from('__proto__,ok\n1,2\n');
  const [row] = await previewSource(src('excel', {}), opts({ file: evil }));
  assert.deepEqual(row, { ok: 2 });
  assert.equal({}.polluted, undefined);
});

test('xlsx uploads read the chosen (or first) sheet with formulas and dates flattened', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Notes').addRow(['ignore me']);
  const sheet = book.addWorksheet('Sales');
  sheet.addRow(['region', 'units', 'total', 'day']);
  sheet.addRow(['North', 3, { formula: 'B2*2', result: 6 }, new Date('2026-11-01T00:00:00Z')]);
  const file = Buffer.from(await book.xlsx.writeBuffer());
  assert.deepEqual(await previewSource(src('excel', { sheet: 'sales' }), opts({ file })),
    [{ region: 'North', units: 3, total: 6, day: '2026-11-01T00:00:00.000Z' }]);
  assert.deepEqual(await previewSource(src('excel', {}), opts({ file })), []); // first sheet has only a header
  await assert.rejects(previewSource(src('excel', { sheet: 'Nope' }), opts({ file })), { reason: REASONS.noSheet });
});

test('excel without a file, binary junk, and zip bombs are refused', async () => {
  await assert.rejects(previewSource(src('excel', {}), opts({ file: null })), { reason: REASONS.noFile });
  await assert.rejects(previewSource(src('excel', {}), opts({ file: Buffer.from([1, 0, 2, 0]) })), { reason: REASONS.badFile });
  // a one-entry zip whose central directory claims 4 GB - 2 uncompressed
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(0xfffffffe, 24);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(4, 16);
  const bomb = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), cd, eocd]);
  await assert.rejects(previewSource(src('excel', {}), opts({ file: bomb })), { reason: REASONS.badFile });
});

// ------------------------------------------------------------------------ sql

function fakeMysql(rows, { failCode } = {}) {
  const log = { config: null, sql: [], destroyed: false };
  return {
    log,
    createConnection(config) {
      log.config = config;
      return {
        query(sql, cb) {
          log.sql.push(sql);
          if (cb) { setImmediate(() => cb(null)); return undefined; }
          const ev = new EventEmitter();
          setImmediate(() => {
            if (failCode) { ev.emit('error', Object.assign(new Error('secret driver text'), { code: failCode })); return; }
            for (const r of rows) { if (log.destroyed) return; ev.emit('result', r); }
            ev.emit('end');
          });
          return ev;
        },
        destroy() { log.destroyed = true; },
      };
    },
  };
}

test('sql runs one SELECT inside a read-only transaction against the pinned address', async () => {
  const mysql = fakeMysql([{ day: 'Mon', orders: 3, blob: Buffer.from('hi') }]);
  const rows = await previewSource(src('sql', { connection: 'mysql://ro:p%40ss@db.example.com:3307/shop', query: 'SELECT day, orders FROM o; ' }), opts({ mysql }));
  assert.deepEqual(rows, [{ day: 'Mon', orders: 3, blob: 'hi' }]);
  assert.equal(mysql.log.config.host, PUBLIC_IP);
  assert.equal(mysql.log.config.port, 3307);
  assert.equal(mysql.log.config.password, 'p@ss');
  assert.equal(mysql.log.config.database, 'shop');
  assert.equal(mysql.log.config.multipleStatements, false);
  assert.equal(mysql.log.sql[0], 'START TRANSACTION READ ONLY');
  assert.equal(mysql.log.sql.at(-1), 'SELECT day, orders FROM o');
  assert.ok(mysql.log.destroyed);
});

test('sql stops reading after 100 rows', async () => {
  const mysql = fakeMysql(Array.from({ length: 500 }, (_, i) => ({ i })));
  const rows = await previewSource(src('sql', { connection: 'mysql://u:p@db.example.com/d', query: 'select i from t' }), opts({ mysql }));
  assert.equal(rows.length, 100);
});

test('sql refuses non-SELECT, other databases, private hosts, and hides driver errors', async () => {
  const conn = 'mysql://u:p@db.example.com/d';
  const run = (key, o = opts({ mysql: fakeMysql([]) })) => previewSource(src('sql', key), o);
  await assert.rejects(run({ connection: conn, query: 'DELETE FROM t' }), { reason: REASONS.notSelect });
  await assert.rejects(run({ connection: conn, query: '/* select */ DROP TABLE t' }), { reason: REASONS.notSelect });
  await assert.rejects(run({ connection: 'postgres://u:p@h/d', query: 'select 1' }), { reason: REASONS.unsupportedDb });
  await assert.rejects(run({ connection: 'not a url', query: 'select 1' }), { reason: REASONS.badConnection });
  await assert.rejects(run({ connection: 'mysql://u:p@10.1.2.3/d', query: 'select 1' }), { reason: REASONS.blockedUrl });
  await assert.rejects(run({ connection: conn, query: 'select 1' }, opts({ mysql: fakeMysql([], { failCode: 'ER_ACCESS_DENIED_ERROR' }) })), { reason: REASONS.rejected });
  await assert.rejects(run({ connection: conn, query: 'select nope' }, opts({ mysql: fakeMysql([], { failCode: 'ER_BAD_FIELD_ERROR' }) })), { reason: REASONS.queryFailed });
  const outcome = await testSource(src('sql', { connection: conn, query: 'select 1' }), opts({ mysql: fakeMysql([], { failCode: 'ECONNREFUSED' }) }));
  assert.deepEqual(outcome, { status: 'failed', reason: REASONS.unreachable });
});

test('sql keeps comments inside string literals intact', async () => {
  const mysql = fakeMysql([]);
  await previewSource(src('sql', { connection: 'mysql://u:p@db.example.com/d', query: "select * from t where tag = '#x' -- note" }), opts({ mysql }));
  assert.equal(mysql.log.sql.at(-1), "select * from t where tag = '#x' -- note");
});

// ------------------------------------------------------------------ upload route

async function withSourcesServer(fn) {
  const store = { src_x: { id: 'src_x', type: 'excel' }, src_r: { id: 'src_r', type: 'rest' } };
  const saved = [];
  const sources = {
    get: async (userId, id) => (userId === 7 ? store[id] || null : null),
    setFile: async (userId, id, buf) => { saved.push({ userId, id, size: buf.length }); return true; },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/sources', (req, _res, next) => { req.userId = 7; next(); }, CreateSourcesRouter({ sources }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/sources`;
  try {
    await fn(async (id, body, type = 'text/csv') => {
      const res = await fetch(`${base}/${id}/file`, { method: 'PUT', headers: { 'Content-Type': type }, body });
      return { status: res.status, body: await res.json() };
    }, saved);
  } finally {
    server.close();
  }
}

test('PUT /api/sources/:id/file stores spreadsheets for excel sources only', async () => {
  await withSourcesServer(async (put, saved) => {
    assert.equal((await put('src_x', 'a,b\n1,2')).status, 200);
    assert.deepEqual(saved, [{ userId: 7, id: 'src_x', size: 7 }]);
    assert.equal((await put('src_r', 'a,b')).status, 400);
    assert.equal((await put('src_missing', 'a,b')).status, 404);
    assert.equal((await put('src_x', Buffer.from([0, 1, 2]), 'application/octet-stream')).status, 400);
    const big = await put('src_x', Buffer.alloc(5 * 1024 * 1024 + 1, 97));
    assert.equal(big.status, 400);
    assert.match(big.body.error, /5 MB/);
    assert.equal(saved.length, 1);
  });
});
