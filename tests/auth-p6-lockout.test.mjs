// Feature: auth-account-endpoints, Property 6: Login lockout state machine
// **Validates: Requirements 3.5, 3.7**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { evaluateLockout } = require('../Web/backend/lib/lockout.js');

const WINDOW = 15 * 60 * 1000;
const T0 = 1_700_000_000_000;

// Independent reference: replay attempts in time order, tracking the run of
// failures since the last success. Each time the run reaches 5+ failures whose
// last five span less than the window, that fifth failure starts a lock.
function reference(attempts, now) {
  const sorted = [...attempts].sort((a, b) => a.at - b.at);
  let run = [];
  const locks = [];
  for (const a of sorted) {
    if (a.success) { run = []; locks.length = 0; continue; }
    run.push(a.at);
    if (run.length >= 5 && run[run.length - 1] - run[run.length - 5] < WINDOW) {
      locks.push(run[run.length - 1] + WINDOW);
    }
  }
  const active = locks.find((u) => u > now);
  return active === undefined
    ? { locked: false, retryAfterSeconds: 0 }
    : { locked: true, retryAfterSeconds: Math.ceil((active - now) / 1000) };
}

// Strictly increasing timestamps; gaps biased toward the window boundaries.
const gap = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 1, max: 5 * 60 * 1000 }) },
  { weight: 2, arbitrary: fc.integer({ min: 1, max: 2 * WINDOW }) },
  { weight: 1, arbitrary: fc.constantFrom(1, 1000, WINDOW / 4 - 1, WINDOW / 4, WINDOW - 1, WINDOW, WINDOW + 1) },
);
const attemptsArb = fc
  .array(fc.tuple(gap, fc.boolean()), { maxLength: 25 })
  .map((rows) => {
    let t = T0;
    return rows.map(([g, success]) => ({ at: (t += g), success }));
  });
// Failure-heavy variant so lockouts occur often.
const failHeavy = fc
  .array(fc.tuple(gap, fc.integer({ min: 0, max: 9 })), { maxLength: 25 })
  .map((rows) => {
    let t = T0;
    return rows.map(([g, r]) => ({ at: (t += g), success: r === 0 }));
  });
const nowOffset = fc.oneof(
  fc.integer({ min: 0, max: 3 * WINDOW }),
  fc.constantFrom(0, WINDOW - 1, WINDOW, WINDOW + 1),
);

function shuffleKey(arr) {
  return arr.map((a, i) => [a, (i * 7919) % 13]).sort((x, y) => x[1] - y[1]).map((x) => x[0]);
}

test('evaluateLockout matches the reference model', () => {
  fc.assert(
    fc.property(fc.oneof(attemptsArb, failHeavy), nowOffset, (attempts, off) => {
      const last = attempts.length ? attempts[attempts.length - 1].at : T0;
      const now = last + off;
      const got = evaluateLockout(attempts, now);
      assert.deepEqual(got, reference(attempts, now));
      // Input order does not matter.
      assert.deepEqual(evaluateLockout(shuffleKey(attempts), now), got);
      if (got.locked) {
        assert.ok(got.retryAfterSeconds >= 1 && got.retryAfterSeconds <= 900);
      } else {
        assert.equal(got.retryAfterSeconds, 0);
      }
    }),
    { numRuns: 300 },
  );
});

test('appending a success leaves the identifier unlocked', () => {
  fc.assert(
    fc.property(failHeavy, fc.integer({ min: 1, max: WINDOW }), (attempts, g) => {
      const last = attempts.length ? attempts[attempts.length - 1].at : T0;
      const withSuccess = [...attempts, { at: last + g, success: true }];
      const r = evaluateLockout(withSuccess, last + g);
      assert.deepEqual(r, { locked: false, retryAfterSeconds: 0 });
    }),
    { numRuns: 100 },
  );
});

test('5 failures in a row lock; lock lifts exactly 15 minutes after the 5th', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 60 * 1000 }), { minLength: 4, maxLength: 4 }),
      (gaps) => {
        let t = T0;
        const fails = [{ at: t, success: false }];
        for (const g of gaps) fails.push({ at: (t += g), success: false });
        const fifth = t;
        assert.equal(evaluateLockout(fails.slice(0, 4), fifth).locked, false);
        assert.equal(evaluateLockout(fails, fifth).locked, true);
        assert.equal(evaluateLockout(fails, fifth).retryAfterSeconds, 900);
        assert.deepEqual(evaluateLockout(fails, fifth + WINDOW - 1), { locked: true, retryAfterSeconds: 1 });
        assert.deepEqual(evaluateLockout(fails, fifth + WINDOW), { locked: false, retryAfterSeconds: 0 });
      },
    ),
    { numRuns: 100 },
  );
});

test('a success in the middle resets the count', () => {
  const a = (i, success = false) => ({ at: T0 + i * 1000, success });
  const seq = [a(0), a(1), a(2), a(3), a(4, true), a(5), a(6), a(7), a(8)];
  assert.equal(evaluateLockout(seq, T0 + 9000).locked, false);
});

test('first and fifth failure exactly 15 minutes apart are outside the window', () => {
  const f = (at) => ({ at: T0 + at, success: false });
  const seq = [f(0), f(1000), f(2000), f(3000), f(WINDOW)];
  assert.equal(evaluateLockout(seq, T0 + WINDOW).locked, false);
  const inside = [f(0), f(1000), f(2000), f(3000), f(WINDOW - 1)];
  assert.equal(evaluateLockout(inside, T0 + WINDOW).locked, true);
});

test('a later group locks again after an earlier lock expired', () => {
  const f = (at) => ({ at: T0 + at, success: false });
  const first = [0, 1, 2, 3, 4].map((s) => f(s * 1000));
  const base = 2 * WINDOW;
  const second = [0, 1, 2, 3, 4].map((s) => f(base + s * 1000));
  const r = evaluateLockout([...first, ...second], T0 + base + 4000);
  assert.deepEqual(r, { locked: true, retryAfterSeconds: 900 });
});
