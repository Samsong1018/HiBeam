'use strict';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Pure lockout evaluation for one identifier.
 * attempts: array of { at: ms, success: boolean }, any order.
 * Returns { locked, retryAfterSeconds }.
 */
function evaluateLockout(attempts, now) {
  const sorted = (Array.isArray(attempts) ? attempts : [])
    .slice()
    .sort((a, b) => a.at - b.at);

  // Drop everything up to and including the latest success.
  let lastSuccess = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].success) lastSuccess = i;
  }
  const failures = sorted.slice(lastSuccess + 1).filter((a) => !a.success);

  // First group of 5 consecutive failures inside one 15-minute window.
  for (let i = 0; i + MAX_FAILURES - 1 < failures.length; i++) {
    const fifth = failures[i + MAX_FAILURES - 1].at;
    if (fifth - failures[i].at < WINDOW_MS) {
      const unlockAt = fifth + WINDOW_MS;
      if (unlockAt > now) {
        return { locked: true, retryAfterSeconds: Math.ceil((unlockAt - now) / 1000) };
      }
      // This group's lock has expired; a later group may still be active.
    }
  }
  return { locked: false, retryAfterSeconds: 0 };
}

module.exports = { evaluateLockout, MAX_FAILURES, WINDOW_MS };
