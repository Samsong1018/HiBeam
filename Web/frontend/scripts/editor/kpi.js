// ============================================================
// KPI LOGIC
// Pure functions, no DOM: threshold status and change since the
// previous row for a Number widget. Covered by tests/kpi.test.mjs.
//
// config.warnAt / config.alertAt   number or null (null = not set)
// config.higherIs                  'bad' (CPU, spending) | 'good' (net worth)
// config.showDelta                 show the change since the previous row
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
