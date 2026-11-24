// ============================================================
// "GONE QUIET" LOGIC
// Pure functions, no DOM: decide whether a data widget's source has
// stopped reporting. Covered by tests/quiet.test.mjs.
//
// A widget goes quiet in one of two ways:
//   stale        the newest timestamp in its rows is older than
//                config.quietAfter minutes (0 = off)
//   unreachable  a refresh failed, so it is showing the last rows
//                that did load (see the source registries)
//
// config.quietAfter   minutes, one of QUIET_OPTIONS (0 = off)
// config.quietField   the timestamp column; '' = find one in the rows
// ============================================================

export const QUIET_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: 'After 5 min' },
  { value: 15, label: 'After 15 min' },
  { value: 60, label: 'After 1 hour' },
  { value: 1440, label: 'After 1 day' },
  { value: 10080, label: 'After 1 week' },
  { value: 44640, label: 'After 1 month' },
];

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
// nginx / apache: 24/Nov/2026:10:04:31 +0000
const CLF_DATE = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/;
const EPOCH_MS_MIN = 1e12; // Sep 2001 in ms
const EPOCH_S_MIN = 1e9; // Sep 2001 in seconds
const EPOCH_MS_MAX = 1e14; // far future in ms

function fromEpoch(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= EPOCH_MS_MIN && n < EPOCH_MS_MAX) return n;
  if (n >= EPOCH_S_MIN && n < EPOCH_MS_MIN) return n * 1000;
  return null;
}

function fromClf(match) {
  const [, d, mon, y, hh, mm, ss, sign, oh, om] = match;
  const month = MONTHS[mon.toLowerCase()];
  if (month === undefined) return null;
  const utc = Date.UTC(Number(y), month, Number(d), Number(hh), Number(mm), Number(ss));
  const offset = sign ? (Number(oh) * 60 + Number(om)) * 60000 * (sign === '-' ? -1 : 1) : 0;
  return utc - offset;
}

/**
 * A full point in time as epoch ms, or null. Clock-only values ("14:05")
 * and plain numbers that aren't epoch-sized return null: without a date
 * there is no way to tell how old they are.
 */
export function parseTime(value) {
  if (typeof value === 'number') return fromEpoch(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return fromEpoch(Number(text));
  const clf = CLF_DATE.exec(text);
  if (clf) return fromClf(clf);
  if (!ISO_DATE.test(text)) return null;
  const ms = Date.parse(text.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

/** The first column where most sampled values are full timestamps, or ''. */
export function findTimeField(rows, sample = 25) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const head = rows.slice(0, sample).filter((r) => r && typeof r === 'object');
  const names = [...new Set(head.flatMap((r) => Object.keys(r)))];
  return names.find((name) => {
    const present = head.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== '');
    if (!present.length) return false;
    const parsed = present.filter((v) => parseTime(v) !== null).length;
    return parsed / present.length >= 0.8;
  }) || '';
}

/** Newest timestamp in `field` across all rows (ms), or null. */
export function lastSeen(rows, field) {
  if (!field || !Array.isArray(rows)) return null;
  let newest = null;
  rows.forEach((row) => {
    const t = parseTime(row?.[field]);
    if (t !== null && (newest === null || t > newest)) newest = t;
  });
  return newest;
}

/** Clean quiet settings from an untrusted config. */
export function normalizeQuietConfig(config) {
  const after = Number(config?.quietAfter);
  return {
    quietAfter: QUIET_OPTIONS.some((o) => o.value === after) ? after : 0,
    quietField: typeof config?.quietField === 'string' ? config.quietField.slice(0, 120) : '',
  };
}

/**
 * { quiet: boolean, lastSeen: ms | null, field: string } for one set of rows.
 * Off, or no timestamps found → never quiet (a board without dates isn't stale).
 */
export function staleState(rows, config, now = Date.now()) {
  const { quietAfter, quietField } = normalizeQuietConfig(config);
  if (!quietAfter) return { quiet: false, lastSeen: null, field: '' };
  const field = quietField || findTimeField(rows);
  const seen = lastSeen(rows, field);
  if (seen === null) return { quiet: false, lastSeen: null, field };
  return { quiet: now - seen > quietAfter * 60000, lastSeen: seen, field };
}

/** "12 min", "3 h", "2 days" */
export function ageText(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** Badge text for a quiet widget. */
export function quietText(reason, seenAt, now = Date.now()) {
  const heard = seenAt ? `last heard ${ageText(now - seenAt)} ago` : 'no word yet';
  return reason === 'unreachable'
    ? { title: 'Gone quiet', detail: `Can't reach the source · ${heard}` }
    : { title: 'Gone quiet', detail: `No new rows · ${heard}` };
}
