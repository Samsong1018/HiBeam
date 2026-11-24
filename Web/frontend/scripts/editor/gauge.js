// ============================================================
// GAUGE LOGIC
// Pure functions, no DOM: how full a Gauge widget's half-donut is and
// which tone it takes. Thresholds reuse the KPI rules in kpi.js.
// Covered by tests/gauge-status.test.mjs.
//
// config.min / config.max      the ends of the arc (defaults 0 and 100)
// config.prefix / suffix       units around the value text
// config.decimals              0-3
// config.warnAt / alertAt      number or null, as on a KPI
// config.higherIs              'bad' (CPU, disk) | 'good'
// ============================================================

import { toNumber } from './data.js';
import { kpiStatus, normalizeKpiConfig } from './kpi.js';

export const GAUGE_DEFAULT_MIN = 0;
export const GAUGE_DEFAULT_MAX = 100;
const MAX_UNIT = 8;

const finite = (v) => (v === null || v === undefined || v === '' ? null : toNumber(v));

/**
 * How much of the arc to fill, 0..1. The value is clamped to [min, max];
 * null when the value isn't a number or the range is empty or backwards.
 * @param {unknown} value
 * @param {unknown} min
 * @param {unknown} max
 * @returns {number|null}
 */
export function gaugeFraction(value, min, max) {
  const n = finite(value);
  const lo = finite(min);
  const hi = finite(max);
  if (n === null || lo === null || hi === null || !(hi > lo)) return null;
  const f = (n - lo) / (hi - lo);
  if (!Number.isFinite(f)) return null;
  return Math.min(Math.max(f, 0), 1);
}

/** Clean gauge settings from an untrusted config. A broken range falls back to 0-100. */
export function normalizeGaugeConfig(config) {
  let min = finite(config?.min);
  let max = finite(config?.max);
  if (min === null) min = GAUGE_DEFAULT_MIN;
  if (max === null) max = GAUGE_DEFAULT_MAX;
  if (!(max > min)) { min = GAUGE_DEFAULT_MIN; max = GAUGE_DEFAULT_MAX; }
  const decimals = Number(config?.decimals);
  const { warnAt, alertAt, higherIs } = normalizeKpiConfig(config);
  return {
    min,
    max,
    prefix: typeof config?.prefix === 'string' ? config.prefix.slice(0, MAX_UNIT) : '',
    suffix: typeof config?.suffix === 'string' ? config.suffix.slice(0, MAX_UNIT) : '',
    decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 3 ? decimals : 0,
    warnAt,
    alertAt,
    higherIs,
    reverseData: config?.reverseData === true,
  };
}

/**
 * The arc's tone: 'ok' | 'warn' | 'danger', from the KPI thresholds on the
 * real (unclamped) value. null when no threshold is set or the value isn't
 * a number: the arc then uses the widget's own colour, not a reassuring green.
 */
export function gaugeTone(value, config) {
  const status = kpiStatus(value, config);
  if (status === 'alert') return 'danger';
  return status; // 'warn' | 'ok' | null
}
