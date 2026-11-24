// Prometheus sources: PromQL URL building, step choice, and vector / matrix / scalar parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fc from 'fast-check';

import { profileFields } from '../Web/frontend/scripts/editor/generator.js';

const require = createRequire(import.meta.url);
const { previewSource, REASONS, MAX_ROWS } = require('../Web/backend/lib/source-connector.js');
const { BuildPromUrl, PromRows, StepFor, SeriesNames, RANGES, MAX_SERIES, MAX_QUERY_CHARS } = require('../Web/backend/lib/connectors/prometheus.js');

const PUBLIC_IP = '93.184.216.34';
const NOW = Date.parse('2026-11-24T18:00:00Z');
const src = (key) => ({ id: 'src_p', owner_id: 7, type: 'prometheus', key_enc: JSON.stringify(key) });
const ok = (data) => JSON.stringify({ status: 'success', data });

function opts({ body = '', status = 200, resolve } = {}) {
  const seen = [];
  return {
    seen,
    decrypt: (v) => v,
    resolve: resolve || (async () => [PUBLIC_IP]),
    transport: async (req) => { seen.push(req); return { status, headers: {}, body }; },
    loadFile: async () => null,
    timeoutMs: 2000,
  };
}

// ------------------------------------------------------------------ URLs

test('instant queries hit /api/v1/query and keep the path prefix', () => {
  const url = new URL(BuildPromUrl({ url: 'https://host.test/prometheus/', query: ' up{job="node"} ' }, NOW, MAX_ROWS));
  assert.equal(url.pathname, '/prometheus/api/v1/query');
  assert.equal(url.searchParams.get('query'), 'up{job="node"}');
  assert.equal(url.searchParams.has('start'), false);
  // a pasted API path is not doubled
  assert.equal(new URL(BuildPromUrl({ url: 'https://h.test/api/v1/query', query: 'up' }, NOW, MAX_ROWS)).pathname, '/api/v1/query');
});

test('range queries hit /api/v1/query_range with start = now - range and a bounded step', () => {
  const url = new URL(BuildPromUrl({ url: 'https://h.test', query: 'up', range: '6h' }, NOW, MAX_ROWS));
  assert.equal(url.pathname, '/api/v1/query_range');
  const end = Number(url.searchParams.get('end'));
  assert.equal(end, NOW / 1000);
  assert.equal(end - Number(url.searchParams.get('start')), 21600);
  assert.equal(Number(url.searchParams.get('step')), Math.ceil(21600 / (MAX_ROWS - 1)));
  assert.equal(StepFor(60, MAX_ROWS), 15);
});

test('step never yields more than MAX_ROWS points and is at least 15 s', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 30 * 86400 }), fc.integer({ min: 2, max: 1000 }), (range, max) => {
    const step = StepFor(range, max);
    return step >= 15 && Math.floor(range / step) + 1 <= max;
  }));
  for (const range of Object.values(RANGES).filter(Boolean)) {
    assert.ok(Math.floor(range / StepFor(range, MAX_ROWS)) + 1 <= MAX_ROWS);
  }
});

test('missing / oversized queries, unknown ranges and bad URLs are refused before any fetch', async () => {
  const o = opts({ body: ok({ resultType: 'scalar', result: [1, '1'] }) });
  await assert.rejects(previewSource(src({ url: 'https://h.test', query: '  ' }), o), { reason: REASONS.badQuery });
  await assert.rejects(previewSource(src({ url: 'https://h.test', query: 'x'.repeat(MAX_QUERY_CHARS + 1) }), o), { reason: REASONS.badQuery });
  await assert.rejects(previewSource(src({ url: 'https://h.test', query: 'up', range: '7d' }), o), { reason: REASONS.badRange });
  await assert.rejects(previewSource(src({ url: 'https://h.test', query: 'up', range: 'toString' }), o), { reason: REASONS.badRange });
  await assert.rejects(previewSource(src({ url: 'not a url', query: 'up' }), o), { reason: REASONS.badUrl });
  await assert.rejects(previewSource(src({ url: 'http://127.0.0.1:9090', query: 'up' }), o), { reason: REASONS.blockedUrl });
  assert.equal(o.seen.length, 0);
});

test('requests go through the pinned transport with the bearer token', async () => {
  const o = opts({ body: ok({ resultType: 'scalar', result: [NOW / 1000, '3'] }) });
  assert.deepEqual(await previewSource(src({ url: 'https://h.test', query: 'scalar(1)', token: 'tok' }), o), [{ value: 3 }]);
  assert.equal(o.seen[0].headers.Authorization, 'Bearer tok');
  assert.equal(o.seen[0].address, PUBLIC_IP);
  assert.ok(o.seen[0].url.startsWith('https://h.test/api/v1/query?query=scalar%281%29'));
});

// --------------------------------------------------------------- parsing

test('vector: one row per series, labels as columns, __name__ only when it is the only label', () => {
  const rows = PromRows(ok({ resultType: 'vector', result: [
    { metric: { __name__: 'up', job: 'node', instance: 'a:9100' }, value: [1, '1'] },
    { metric: { __name__: 'up', job: 'node', instance: 'b:9100' }, value: [1, 'NaN'] },
    { metric: { __name__: 'node_load1' }, value: [1, '0.25'] },
    { metric: {}, value: [1, '+Inf'] },
    { metric: JSON.parse('{"__proto__":"x","constructor":"y","job":"z"}'), value: [1, '2'] },
  ] }), MAX_ROWS);
  assert.deepEqual(rows, [
    { job: 'node', instance: 'a:9100', value: 1 },
    { job: 'node', instance: 'b:9100', value: null },
    { metric: 'node_load1', value: 0.25 },
    { value: null },
    { job: 'z', value: 2 },
  ]);
  assert.equal(Object.getPrototypeOf(rows[4]), Object.prototype);
});

test('matrix: one row per timestamp with ISO time and a column per series', () => {
  const t0 = NOW / 1000;
  const rows = PromRows(ok({ resultType: 'matrix', result: [
    { metric: { job: 'node', instance: 'a' }, values: [[t0, '1'], [t0 + 60, '2']] },
    { metric: { job: 'node', instance: 'b' }, values: [[t0 + 60, '5'], [t0 + 120, '-Inf']] },
  ] }), MAX_ROWS);
  assert.deepEqual(rows, [
    { time: '2026-11-24T18:00:00.000Z', a: 1, b: null },
    { time: '2026-11-24T18:01:00.000Z', a: 2, b: 5 },
    { time: '2026-11-24T18:02:00.000Z', a: null, b: null },
  ]);
  // the editor's generator sees a time axis and two measures
  const roles = Object.fromEntries(profileFields(rows).map((f) => [f.name, f.role]));
  assert.equal(roles.time, 'time');
  assert.equal(roles.a, 'number');
});

test('series naming: distinguishing label first, then {k=v} strings, then dedupe', () => {
  assert.deepEqual(SeriesNames([{ __name__: 'up', job: 'x' }]), ['up']);
  assert.deepEqual(SeriesNames([{}]), ['value']);
  assert.deepEqual(SeriesNames([{ job: 'a', code: '200' }, { job: 'b', code: '200' }]), ['a', 'b']);
  assert.deepEqual(SeriesNames([{ job: 'a', instance: 'i1' }, { job: 'b', instance: 'i2' }]), ['i1', 'i2']);
  assert.deepEqual(SeriesNames([{ job: 'a', code: '200' }, { job: 'a', code: '500' }, { job: 'b', code: '200' }]),
    ['{job=a,code=200}', '{job=a,code=500}', '{job=b,code=200}']);
  // identical label sets, and a series literally named "time", still give unique columns
  const rows = PromRows(ok({ resultType: 'matrix', result: [
    { metric: { job: 'time' }, values: [[1, '1']] },
    { metric: { job: 'x' }, values: [[1, '2']] },
  ] }), MAX_ROWS);
  assert.deepEqual(Object.keys(rows[0]), ['time', 'time_2', 'x']);
  const same = PromRows(ok({ resultType: 'matrix', result: [{ metric: {}, values: [[1, '1']] }, { metric: {}, values: [[1, '2']] }] }), MAX_ROWS);
  assert.deepEqual(same, [{ time: '1970-01-01T00:00:01.000Z', value: 1, value_2: 2 }]);
});

test('scalar and string results become one row', () => {
  assert.deepEqual(PromRows(ok({ resultType: 'scalar', result: [1, '42.5'] }), MAX_ROWS), [{ value: 42.5 }]);
  assert.deepEqual(PromRows(ok({ resultType: 'string', result: [1, 'hello'] }), MAX_ROWS), [{ value: 'hello' }]);
});

test('errors map to fixed reasons and never echo upstream text', async () => {
  const errBody = JSON.stringify({ status: 'error', errorType: 'bad_data', error: 'parse error at char 3: secret detail' });
  const cases = [
    [{ body: errBody }, REASONS.promRejected],
    [{ body: errBody, status: 400 }, REASONS.promRejected],
    [{ body: errBody, status: 422 }, REASONS.promRejected],
    [{ body: 'oops', status: 503 }, REASONS.upstreamError],
    [{ status: 401 }, REASONS.rejected],
    [{ body: '<html>login</html>' }, REASONS.badResponse],
    [{ body: ok({ resultType: 'weird', result: [] }) }, REASONS.badResponse],
    [{ body: JSON.stringify({ status: 'success' }) }, REASONS.badResponse],
  ];
  for (const [o, reason] of cases) {
    await assert.rejects(previewSource(src({ url: 'https://h.test', query: 'up' }), opts(o)), (err) => {
      assert.equal(err.reason, reason);
      assert.ok(!err.message.includes('secret'));
      return true;
    });
  }
});

// Property: matrix parsing never returns more than MAX_ROWS rows or more than MAX_SERIES series
// columns, every row has an ISO time, and every value is a finite number or null.
test('matrix parsing stays within the row and column caps', () => {
  const sample = fc.tuple(fc.integer({ min: 0, max: 4e9 }), fc.oneof(fc.double().map(String), fc.constantFrom('NaN', '+Inf', '-Inf', 'x')));
  const series = fc.record({
    metric: fc.dictionary(fc.constantFrom('job', 'instance', 'code', '__name__', 'le'), fc.string({ maxLength: 6 }), { maxKeys: 4 }),
    values: fc.array(sample, { maxLength: 60 }),
  });
  fc.assert(fc.property(fc.array(series, { maxLength: 20 }), fc.integer({ min: 1, max: 150 }), (result, max) => {
    const rows = PromRows(ok({ resultType: 'matrix', result }), max);
    if (rows.length > max) return false;
    return rows.every((row) => {
      const keys = Object.keys(row).filter((k) => k !== 'time');
      return keys.length <= MAX_SERIES && keys.length <= result.length
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.time)
        && keys.every((k) => row[k] === null || Number.isFinite(row[k]));
    });
  }));
});
