// CSV-by-URL sources: fetched through the pinned transport, parsed like uploaded CSVs,
// redirects followed safely (Google Sheets "Publish to web" links 302 to googleusercontent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { previewSource, testSource, REASONS, MAX_ROWS } = require('../Web/backend/lib/source-connector.js');
const { SpreadsheetRows } = require('../Web/backend/lib/connectors/spreadsheet.js');

const PUBLIC_IP = '93.184.216.34';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=0&single=true&output=csv';
const src = (key) => ({ id: 'src_1', owner_id: 7, type: 'csv', key_enc: JSON.stringify(key) });

// pRoutes: url -> { status, body?, headers? }; pHosts: hostname -> [addresses]
function opts(pRoutes, pHosts = {}) {
  const seen = [];
  return {
    seen,
    decrypt: (v) => v,
    resolve: async (host) => pHosts[host] || [PUBLIC_IP],
    transport: async (req) => {
      seen.push(req);
      const route = pRoutes[req.url];
      if (!route) return { status: 404, body: '' };
      return { status: route.status || 200, headers: route.headers || {}, body: route.body || '' };
    },
    loadFile: async () => null,
    timeoutMs: 2000,
  };
}
const one = (url, body) => opts({ [url]: { body } });

test('comma CSV becomes typed rows, the bearer token is sent', async () => {
  const o = one('https://x.test/a.csv', 'day,orders,revenue\n2026-11-01,12,"$1,299.50"\n2026-11-02,9,800\n');
  const rows = await previewSource(src({ url: 'https://x.test/a.csv', token: 'tok' }), o);
  assert.deepEqual(rows, [
    { day: '2026-11-01', orders: 12, revenue: 1299.5 },
    { day: '2026-11-02', orders: 9, revenue: 800 },
  ]);
  assert.equal(o.seen[0].headers.Authorization, 'Bearer tok');
  assert.equal(o.seen[0].address, PUBLIC_IP);
});

test('semicolon, quoted fields with newlines, BOM and CRLF all match the upload parser', async () => {
  const text = '﻿name;note;n\r\n"Smith; J";"line one\nline two";3\r\n"say ""hi""";;4\r\n';
  const rows = await previewSource(src({ url: 'https://x.test/b.csv' }), one('https://x.test/b.csv', text));
  assert.deepEqual(rows, [
    { name: 'Smith; J', note: 'line one\nline two', n: 3 },
    { name: 'say "hi"', note: '', n: 4 },
  ]);
  assert.deepEqual(rows, await SpreadsheetRows(Buffer.from(text, 'utf8'), undefined, MAX_ROWS));
});

test('header-only and empty CSVs give no rows; duplicate and blank headers are named', async () => {
  assert.deepEqual(await previewSource(src({ url: 'https://x.test/h.csv' }), one('https://x.test/h.csv', 'a,b,c\n')), []);
  assert.deepEqual(await previewSource(src({ url: 'https://x.test/e.csv' }), one('https://x.test/e.csv', '')), []);
  assert.deepEqual(await previewSource(src({ url: 'https://x.test/d.csv' }), one('https://x.test/d.csv', 'a,a,\n1,2,3\n')),
    [{ a: 1, a_2: 2, column_3: 3 }]);
});

test('at most MAX_ROWS rows come back', async () => {
  const body = `n\n${Array.from({ length: 500 }, (_, i) => i).join('\n')}\n`;
  const rows = await previewSource(src({ url: 'https://x.test/big.csv' }), one('https://x.test/big.csv', body));
  assert.equal(rows.length, MAX_ROWS);
  assert.deepEqual(rows[0], { n: 0 });
});

test('an HTML page (unpublished sheet, sign-in wall) is a clear error, not junk rows', async () => {
  const o = one(SHEET_URL, '<!DOCTYPE html><html><body>Sign in</body></html>');
  await assert.rejects(previewSource(src({ url: SHEET_URL }), o), { reason: REASONS.notCsv });
});

test('upstream status codes map to fixed reasons', async () => {
  const o = opts({ 'https://x.test/401': { status: 401 }, 'https://x.test/500': { status: 500, body: 'secret stack trace' } });
  await assert.rejects(previewSource(src({ url: 'https://x.test/401' }), o), { reason: REASONS.rejected });
  const res = await testSource(src({ url: 'https://x.test/500' }), o);
  assert.deepEqual(res, { status: 'failed', reason: REASONS.upstreamError });
  await assert.rejects(previewSource(src({}), o), { reason: REASONS.badKey });
});

// ----------------------------------------------------------------- redirects

test('a Google Sheets publish link is followed to googleusercontent, re-resolved and re-pinned', async () => {
  const final = 'https://doc-0s-1c-sheets.googleusercontent.com/pub/xyz?gid=0&single=true&output=csv';
  const o = opts({
    [SHEET_URL]: { status: 307, headers: { location: final } },
    [final]: { body: 'month,signups\n2026-10,40\n2026-11,52\n' },
  }, { 'doc-0s-1c-sheets.googleusercontent.com': ['142.250.1.1'] });
  const rows = await previewSource(src({ url: SHEET_URL }), o);
  assert.deepEqual(rows, [{ month: '2026-10', signups: 40 }, { month: '2026-11', signups: 52 }]);
  assert.equal(o.seen.length, 2);
  assert.equal(o.seen[1].address, '142.250.1.1');
});

test('relative Location headers resolve against the current URL', async () => {
  const o = opts({
    'https://x.test/a/start.csv': { status: 302, headers: { location: '../b/final.csv#frag' } },
    'https://x.test/b/final.csv': { body: 'k\n1\n' },
  });
  assert.deepEqual(await previewSource(src({ url: 'https://x.test/a/start.csv' }), o), [{ k: 1 }]);
});

test('a redirect to a private address is blocked, by IP literal or by DNS', async () => {
  const literal = opts({ 'https://x.test/a': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } } });
  await assert.rejects(previewSource(src({ url: 'https://x.test/a' }), literal), { reason: REASONS.blockedUrl });
  assert.equal(literal.seen.length, 1);

  const dns = opts({ 'https://x.test/a': { status: 301, headers: { location: 'https://intranet.evil.test/x.csv' } } },
    { 'intranet.evil.test': ['10.1.2.3'] });
  await assert.rejects(previewSource(src({ url: 'https://x.test/a' }), dns), { reason: REASONS.blockedUrl });
  assert.equal(dns.seen.length, 1);
});

test('non-http schemes, userinfo and https->http downgrades are refused', async () => {
  for (const location of ['file:///etc/passwd', 'ftp://x.test/a.csv', 'https://user:pw@x.test/a.csv', 'http://x.test/plain.csv']) {
    const o = opts({ 'https://x.test/a': { status: 302, headers: { location } } });
    await assert.rejects(previewSource(src({ url: 'https://x.test/a' }), o), { reason: REASONS.blockedUrl }, location);
    assert.equal(o.seen.length, 1, location);
  }
});

test('at most 3 redirects are followed', async () => {
  const hop = (n) => `https://x.test/${n}`;
  const chain = (len) => Object.fromEntries(Array.from({ length: len }, (_, i) => [hop(i), { status: 302, headers: { location: hop(i + 1) } }]));
  const ok = opts({ ...chain(3), [hop(3)]: { body: 'a\n1\n' } });
  assert.deepEqual(await previewSource(src({ url: hop(0) }), ok), [{ a: 1 }]);
  const tooMany = opts({ ...chain(4), [hop(4)]: { body: 'a\n1\n' } });
  await assert.rejects(previewSource(src({ url: hop(0) }), tooMany), { reason: REASONS.tooManyRedirects });
  assert.equal(tooMany.seen.length, 4);
});

test('a redirect without Location is a bad response; the token never leaves the original origin', async () => {
  const bare = opts({ 'https://x.test/a': { status: 302 } });
  await assert.rejects(previewSource(src({ url: 'https://x.test/a' }), bare), { reason: REASONS.badResponse });

  const o = opts({
    'https://x.test/a': { status: 302, headers: { location: '/b' } },
    'https://x.test/b': { status: 302, headers: { location: 'https://cdn.other.test/c' } },
    'https://cdn.other.test/c': { body: 'a\n1\n' },
  });
  await previewSource(src({ url: 'https://x.test/a', token: 'tok' }), o);
  assert.equal(o.seen[0].headers.Authorization, 'Bearer tok');
  assert.equal(o.seen[1].headers.Authorization, 'Bearer tok');
  assert.equal(o.seen[2].headers.Authorization, undefined);
});
