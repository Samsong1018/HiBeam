// ============================================================
// KPI LOGIC
// Pure functions, no DOM: threshold status and change since the
// previous row for a Number widget. Covered by tests/kpi.test.mjs.
//
// config.warnAt / config.alertAt   number or null (null = not set)
// config.higherIs                  'bad' (CPU, spending) | 'good' (net worth)
// config.showDelta                 show the change since the previous row
// config.sparkline                 draw a small trend line of the rows under the number
// ============================================================

import { aggregate, toNumber } from './data.js';

const finite = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = toNumber(v);
  return n === null ? null : n;
};

/** Clean threshold settings from an untrusted config. */
export function normalizeKpiConfig(config) {
  return {
    warnAt: finite(config?.warnAt),
    alertAt: finite(config?.alertAt),
    higherIs: config?.higherIs === 'good' ? 'good' : 'bad',
    showDelta: config?.showDelta === true,
    sparkline: config?.sparkline === true,
  };
}

/**
 * 'alert' | 'warn' | 'ok', or null when no threshold is set or the value isn't a number.
 * With higherIs 'bad' a value at or past a threshold trips it going up;
 * with 'good' it trips going down.
 */
export function kpiStatus(value, config) {
  const n = finite(value);
  const { warnAt, alertAt, higherIs } = normalizeKpiConfig(config);
  if (n === null || (warnAt === null && alertAt === null)) return null;
  const past = (limit) => limit !== null && (higherIs === 'bad' ? n >= limit : n <= limit);
  if (past(alertAt)) return 'alert';
  if (past(warnAt)) return 'warn';
  return 'ok';
}

/**
 * How much the KPI moved when its newest row arrived: aggregate(all rows)
 * minus aggregate(all but the newest). For 'last' that's the latest minus the
 * one before; for 'sum' it's the newest row's own value. null when there's
 * nothing to compare (fewer than two numeric rows, or a row count).
 */
export function kpiDelta(values, agg = 'sum') {
  if (!Array.isArray(values) || agg === 'count') return null;
  if (values.map(toNumber).filter((n) => n !== null).length < 2) return null;
  const now = aggregate(values, agg);
  const before = aggregate(values.slice(0, -1), agg);
  const delta = now - before;
  return Number.isFinite(delta) ? delta : null;
}

/** 'good' | 'bad' | 'flat' for a delta, from which way is better. */
export function deltaTone(delta, config) {
  if (delta === null || delta === 0) return 'flat';
  const { higherIs } = normalizeKpiConfig(config);
  const up = delta > 0;
  return (up === (higherIs === 'good')) ? 'good' : 'bad';
}

// ------------------------------------------------------------
// Sparkline: the KPI's rows as a tiny trend line
// ------------------------------------------------------------
export const SPARK_MAX_POINTS = 60;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * SVG polyline `points` ("x,y x,y …") for a sparkline of `values` in a
 * width × height box, oldest on the left. Non-numeric values are dropped,
 * long series are thinned to at most maxPoints (always keeping the first and
 * the newest), a flat series draws a flat line at mid-height. `pad` keeps the
 * stroke inside the box at the top and bottom. null when fewer than 2 numbers.
 * @param {unknown[]} values
 * @param {number} width
 * @param {number} height
 * @param {{ maxPoints?: number, pad?: number }} [opts]
 * @returns {string|null}
 */
export function sparklinePoints(values, width, height, { maxPoints = SPARK_MAX_POINTS, pad = 1.5 } = {}) {
  if (!Array.isArray(values) || !(width > 0) || !(height > 0)) return null;
  const nums = values.map(toNumber).filter((n) => n !== null);
  if (nums.length < 2) return null;
  const limit = Math.max(2, Math.floor(maxPoints) || SPARK_MAX_POINTS);
  const picked = nums.length <= limit
    ? nums
    : Array.from({ length: limit }, (_, i) => nums[Math.round((i * (nums.length - 1)) / (limit - 1))]);
  const lo = Math.min(...picked);
  const hi = Math.max(...picked);
  const inset = Math.min(Math.max(pad, 0), height / 2);
  const span = height - inset * 2;
  const last = picked.length - 1;
  return picked.map((n, i) => {
    const x = (i / last) * width;
    const y = hi === lo ? height / 2 : inset + (1 - (n - lo) / (hi - lo)) * span;
    return `${round2(x)},${round2(y)}`;
  }).join(' ');
}
