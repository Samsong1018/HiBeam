// ============================================================
// SEMANTIC TONES
// Pure functions, no DOM: some values mean good or bad on their own
// ("dead", "failed", HTTP 503). Charts and tables colour those by meaning
// instead of by palette order. Covered by tests/semantic.test.mjs.
// ============================================================

const OK = /^(alive|up|ok|okay|active|running|healthy|online|success|succeeded|passed|pass|green|yes|true|enabled)$/i;
const WARN = /^(warn|warning|degraded|pending|unknown|restarting|activating|reloading|slow|amber|yellow|partial)$/i;
const DANGER = /^(dead|down|failed|failing|fail|error|errored|critical|crit|fatal|offline|inactive|unhealthy|stopped|crashed|red|no|false|disabled)$/i;

// Field names whose values are worth reading as a tone.
const TONE_FIELD = /(status|state|health|level|result|outcome|alive)$/i;
const CODE_FIELD = /(status|code)$/i;

/** @typedef {'ok'|'info'|'warn'|'danger'} Tone */

function httpTone(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 100 || n > 599 || !/^\s*\d{3}\s*$/.test(String(value))) return null;
  if (n < 300) return 'ok';
  if (n < 400) return 'info';
  return n < 500 ? 'warn' : 'danger';
}

/**
 * The tone of one value, or null when the value doesn't carry one.
 * HTTP codes only count when the field is named like a status or code.
 * @param {unknown} value
 * @param {string} [fieldName]
 * @returns {Tone|null}
 */
export function toneOf(value, fieldName = '') {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (CODE_FIELD.test(fieldName)) {
    const code = httpTone(text);
    if (code) return code;
  }
  if (OK.test(text)) return 'ok';
  if (WARN.test(text)) return 'warn';
  if (DANGER.test(text)) return 'danger';
  return null;
}

/**
 * Tones for a whole chart axis. All-or-nothing: if any label has no tone the
 * axis isn't semantic and the chart keeps its palette colours.
 * @param {string[]} labels
 * @param {string} [fieldName]
 * @returns {Tone[]|null}
 */
export function axisTones(labels, fieldName = '') {
  if (!Array.isArray(labels) || labels.length === 0) return null;
  const tones = labels.map((l) => toneOf(l, fieldName));
  return tones.every(Boolean) ? tones : null;
}

/** True when a table column's cells should be tinted by tone. */
export function isToneColumn(fieldName) {
  return TONE_FIELD.test(String(fieldName || ''));
}

/** CSS custom property that holds each tone's colour. */
export const TONE_TOKENS = {
  ok: '--color-ok',
  info: '--chart-c6',
  warn: '--color-warn',
  danger: '--color-danger',
};
