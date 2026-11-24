// ============================================================
// UPTIME STRIP LOGIC
// Pure functions, no DOM: group a status feed into one row per service
// with its last N checks, oldest to newest, each toned by meaning
// (alive/dead, active/failed, HTTP 200/503). Covered by
// tests/gauge-status.test.mjs.
//
// binding.xField        the service / name column
// binding.yField        the status column
// config.timeField      a time column to order rows by; '' = row order
// config.slots          how many checks per strip, one of SLOT_OPTIONS
// ============================================================

import { parseTime } from './data.js';
import { toneOf } from './semantic.js';

export const SLOT_OPTIONS = [15, 30, 60, 90];
export const DEFAULT_SLOTS = 30;
export const MAX_SERVICES = 200;
const BLANK_NAME = '(blank)';

/** Clean strip settings from an untrusted config. */
export function normalizeStatusConfig(config) {
  const slots = Number(config?.slots);
  return {
    slots: SLOT_OPTIONS.includes(slots) ? slots : DEFAULT_SLOTS,
    timeField: typeof config?.timeField === 'string' ? config.timeField.slice(0, 120) : '',
    reverseData: config?.reverseData === true,
  };
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

// Rows in time order when the time column parses; rows whose time doesn't
// parse can't be placed, so they're left out. No parseable time at all
// (wrong column, clock-only values) → keep the row order.
function ordered(rows, timeField) {
  const list = rows.filter((r) => r && typeof r === 'object');
  if (!timeField) return list.map((row) => ({ row, at: null }));
  const timed = list.map((row, i) => ({ row, at: parseTime(row[timeField]), i })).filter((t) => t.at !== null);
  if (!timed.length) return list.map((row) => ({ row, at: null }));
  return timed.sort((a, b) => a.at - b.at || a.i - b.i).map(({ row, at }) => ({ row, at }));
}

/**
 * One strip per distinct service, in first-seen order:
 * [{ name, slots: (null | { value, tone, at })[], ok, filled, uptime }]
 * `slots` always has `count` entries, oldest first; missing checks on the
 * left are null (no data). tone is 'ok' | 'info' | 'warn' | 'danger', or
 * 'unknown' for a value with no meaning of its own. A blank status is an
 * empty slot. uptime = ok / filled, null when nothing is filled.
 * @param {object[]} rows
 * @param {{ xField: string, yField: string, timeField?: string, slots?: number }} opts
 */
export function statusStrips(rows, { xField, yField, timeField = '', slots = DEFAULT_SLOTS } = {}) {
  if (!Array.isArray(rows) || !xField || !yField) return [];
  const count = SLOT_OPTIONS.includes(slots) ? slots : DEFAULT_SLOTS;
  const groups = new Map();
  ordered(rows, timeField).forEach(({ row, at }) => {
    const name = isBlank(row[xField]) ? BLANK_NAME : String(row[xField]).trim();
    if (!groups.has(name)) {
      if (groups.size >= MAX_SERVICES) return;
      groups.set(name, []);
    }
    groups.get(name).push({ value: row[yField], at });
  });

  return [...groups].map(([name, checks]) => {
    const recent = checks.slice(-count).map(({ value, at }) => (isBlank(value)
      ? null
      : { value: String(value).trim(), tone: toneOf(value, yField) || 'unknown', at }));
    const strip = [...Array(count - recent.length).fill(null), ...recent];
    const filled = strip.filter(Boolean).length;
    const ok = strip.filter((s) => s?.tone === 'ok' || s?.tone === 'info').length; // 3xx redirects count as up
    return { name, slots: strip, ok, filled, uptime: filled ? ok / filled : null };
  });
}

/** "100%", "99.6%", "87%", or "—" with no checks. Never rounds a miss up to 100%. */
export function uptimeText(uptime) {
  if (uptime === null || uptime === undefined || !Number.isFinite(uptime)) return '—';
  if (uptime >= 1) return '100%';
  const pct = uptime * 100;
  if (pct >= 99) return `${Math.min(Math.floor(pct * 10) / 10, 99.9)}%`;
  return `${Math.floor(pct)}%`;
}
