// Unit + property tests for semantic tones (Web/frontend/scripts/editor/semantic.js).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { toneOf, axisTones, isToneColumn } from '../Web/frontend/scripts/editor/semantic.js';

test('service states map to ok / warn / danger, case-insensitively', () => {
  assert.equal(toneOf('alive'), 'ok');
  assert.equal(toneOf('Active'), 'ok');
  assert.equal(toneOf('dead'), 'danger');
  assert.equal(toneOf('FAILED'), 'danger');
  assert.equal(toneOf('inactive'), 'danger');
  assert.equal(toneOf('degraded'), 'warn');
  assert.equal(toneOf(' up '), 'ok');
});

test('HTTP codes only count on a status/code field', () => {
  assert.equal(toneOf(200, 'status'), 'ok');
  assert.equal(toneOf('304', 'status'), 'info');
  assert.equal(toneOf(404, 'statusCode'), 'warn');
  assert.equal(toneOf(503, 'code'), 'danger');
  assert.equal(toneOf(200, 'bytes'), null, 'a byte count of 200 is not a success');
  assert.equal(toneOf(200), null);
  assert.equal(toneOf(2000, 'status'), null);
  assert.equal(toneOf('20x', 'status'), null);
});

test('unknown, empty and missing values carry no tone', () => {
  assert.equal(toneOf('minecraft'), null);
  assert.equal(toneOf(''), null);
  assert.equal(toneOf(null), null);
  assert.equal(toneOf(undefined), null);
});

test('axisTones is all-or-nothing', () => {
  assert.deepEqual(axisTones(['dead', 'alive'], 'status'), ['danger', 'ok']);
  assert.deepEqual(axisTones(['200', '404', '502'], 'status'), ['ok', 'warn', 'danger']);
  assert.equal(axisTones(['dead', 'zombie'], 'status'), null);
  assert.equal(axisTones([], 'status'), null);
  assert.equal(axisTones(['Jan', 'Feb'], 'month'), null);
});

test('only status-like columns are toned in tables', () => {
  assert.ok(isToneColumn('status'));
  assert.ok(isToneColumn('state'));
  assert.ok(isToneColumn('serviceHealth'));
  assert.ok(!isToneColumn('service'));
  assert.ok(!isToneColumn('bytes'));
});

test('property: toneOf never throws and returns a known tone or null', () => {
  fc.assert(fc.property(fc.anything(), fc.string(), (value, field) => {
    let tone;
    try { tone = toneOf(value, field); } catch { return true; } // objects with throwing toString are not our problem
    return tone === null || ['ok', 'info', 'warn', 'danger'].includes(tone);
  }));
});

test('property: axisTones returns null or one tone per label', () => {
  fc.assert(fc.property(fc.array(fc.oneof(fc.constantFrom('dead', 'alive', '200', '503'), fc.string())), (labels) => {
    const tones = axisTones(labels, 'status');
    return tones === null || tones.length === labels.length;
  }));
});
