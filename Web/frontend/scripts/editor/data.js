// ============================================================
// DATA TRANSFORMS
// Pure functions, no DOM: turn source rows into chart-ready series.
// Covered by tests/editor.test.mjs.
// ============================================================

import { parseTime as parseFullTime } from './quiet.js';

export const AGGREGATIONS = {
  sum: { label: 'Sum', fn: (vals) => vals.reduce((a, b) => a + b, 0) },
  avg: { label: 'Average', fn: (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0) },
  min: { label: 'Min', fn: (vals) => (vals.length ? Math.min(...vals) : 0) },
  max: { label: 'Max', fn: (vals) => (vals.length ? Math.max(...vals) : 0) },
  count: { label: 'Count', fn: (vals) => vals.length },
  last: { label: 'Latest', fn: (vals) => (vals.length ? vals[vals.length - 1] : 0) },
};

export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.replace(/[,$%\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function aggregate(values, agg = 'sum') {
  const nums = values.map(toNumber).filter((n) => n !== null);
  const { fn } = AGGREGATIONS[agg] || AGGREGATIONS.sum;
  // count is "how many rows", not "how many numeric values"
  return agg === 'count' ? values.length : fn(nums);
}

// Infer [{ name, type: 'number' | 'string' }] from the first rows.
export function fieldsOf(rows, sample = 25) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const names = [...new Set(rows.slice(0, sample).flatMap((row) => Object.keys(row || {})))];
  return names.map((name) => {
    const present = rows.slice(0, sample).map((row) => row?.[name]).filter((v) => v !== null && v !== undefined && v !== '');
    const numeric = present.length > 0 && present.every((v) => toNumber(v) !== null);
    return { name, type: numeric ? 'number' : 'string' };
  });
}

// Group rows by xField and aggregate yField per group, keeping first-seen order.
export function groupSeries(rows, { xField, yField, agg = 'sum' }) {
  if (!xField || (!yField && agg !== 'count')) return { labels: [], values: [] };
  const groups = new Map();
  rows.forEach((row) => {
    const key = String(row?.[xField] ?? '—');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row?.[yField]);
  });
  const labels = [...groups.keys()];
  return { labels, values: labels.map((label) => aggregate(groups.get(label), agg)) };
}

// Line several series up on a shared x axis (union of labels, first-seen order).
// Missing points become null so Chart.js leaves a gap instead of inventing zeros.
export function mergeSeries(seriesList) {
  const labels = [];
  const seen = new Set();
  seriesList.forEach(({ labels: ls }) => ls.forEach((l) => {
    if (!seen.has(l)) { seen.add(l); labels.push(l); }
  }));
  const datasets = seriesList.map(({ labels: ls, values }) => {
    const byLabel = new Map(ls.map((l, i) => [l, values[i]]));
    return labels.map((l) => (byLabel.has(l) ? byLabel.get(l) : null));
  });
  return { labels, datasets };
}

export function formatNumber(value, { decimals = 0, prefix = '', suffix = '' } = {}) {
  const n = toNumber(value);
  if (n === null) return '—';
  const safeDecimals = Math.min(Math.max(Number(decimals) || 0, 0), 6);
  const abs = Math.abs(n);
  let body;
  if (abs >= 1e9) body = `${(n / 1e9).toFixed(1)}B`;
  else if (abs >= 1e6) body = `${(n / 1e6).toFixed(1)}M`;
  else body = n.toLocaleString(undefined, { minimumFractionDigits: safeDecimals, maximumFractionDigits: safeDecimals });
  return `${prefix}${body}${suffix}`;
}

// Value-axis ticks and tooltips on line/bar charts. Unlike formatNumber this
// keeps small fractions (axis steps of 0.5) and only shortens when asked:
// compact turns 60000 into 60k. The sign goes before the prefix: -$5k.
const COMPACT_STEPS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

export function formatAxisValue(value, { prefix = '', suffix = '', compact = false } = {}) {
  const n = toNumber(value);
  if (n === null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  let i = compact ? COMPACT_STEPS.findIndex(([size]) => abs >= size) : -1;
  // 999,999 rounds to 1000.0k: promote to the next step so it reads 1M.
  if (i > 0 && Number((abs / COMPACT_STEPS[i][0]).toFixed(1)) >= 1000) i -= 1;
  if (compact && i === -1 && Number(abs.toFixed(1)) >= 1000) i = COMPACT_STEPS.length - 1;
  const step = i >= 0 ? COMPACT_STEPS[i] : null;
  const body = step
    ? `${Number((abs / step[0]).toFixed(1)).toLocaleString()}${step[1]}`
    : abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${sign}${prefix}${body}${suffix}`;
}

// ------------------------------------------------------------
// Reference lines (line chart "thresholds")
// [{ value, label, tone }] drawn as dashed horizontal lines.
// ------------------------------------------------------------
export const MAX_THRESHOLDS = 3;
export const MAX_THRESHOLD_LABEL = 24;
export const THRESHOLD_TONES = ['warn', 'danger', 'ok'];

const thresholdValue = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
};

/**
 * Clean reference lines from an untrusted config: entries without a finite
 * value are dropped, at most MAX_THRESHOLDS kept, labels capped, and an
 * unknown tone falls back to 'warn'.
 * @param {unknown} list
 * @returns {{ value: number, label: string, tone: 'warn'|'danger'|'ok' }[]}
 */
export function normalizeThresholds(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && typeof t === 'object')
    .map((t) => ({
      value: thresholdValue(t.value),
      label: typeof t.label === 'string' ? t.label.slice(0, MAX_THRESHOLD_LABEL) : '',
      tone: THRESHOLD_TONES.includes(t.tone) ? t.tone : 'warn',
    }))
    .filter((t) => Number.isFinite(t.value))
    .slice(0, MAX_THRESHOLDS);
}

/**
 * suggestedMin/suggestedMax for a value axis so every reference line is
 * inside the plot, with a little headroom so a line never sits on the edge.
 * The padding never drags an all-positive (or all-negative) set across zero.
 * null when there are no lines.
 * @param {{ value: number }[]} thresholds
 * @returns {{ suggestedMin: number, suggestedMax: number }|null}
 */
export function thresholdBounds(thresholds) {
  const values = (Array.isArray(thresholds) ? thresholds : [])
    .map((t) => t?.value)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!values.length) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.05;
  return {
    suggestedMin: lo >= 0 ? Math.max(0, lo - pad) : lo - pad,
    suggestedMax: hi <= 0 ? Math.min(0, hi + pad) : hi + pad,
  };
}

// Bar order and "top N" over chart data { labels, series: [{ label, values }] }.
// Ranks by the first series; every series is reordered the same way so they
// stay aligned. Missing values (null) rank last. sort 'none' with a topN keeps
// the N largest but leaves them in their original order.
export function sortBars(data, { sort = 'none', topN = 0 } = {}) {
  const limit = Number.isInteger(topN) && topN > 0 ? topN : 0;
  const ordered = sort === 'asc' || sort === 'desc';
  if (!ordered && (!limit || limit >= data.labels.length)) return data;
  const first = data.series[0]?.values || [];
  const rank = (i) => (typeof first[i] === 'number' && Number.isFinite(first[i]) ? first[i] : null);
  const byValue = (dir) => (a, b) => {
    const va = rank(a);
    const vb = rank(b);
    if (va === null || vb === null) return (va === null) - (vb === null);
    return dir === 'asc' ? va - vb : vb - va;
  };
  let index = data.labels.map((_, i) => i);
  if (limit) {
    const keep = new Set([...index].sort(byValue('desc')).slice(0, limit));
    index = index.filter((i) => keep.has(i));
  }
  if (ordered) index = [...index].sort(byValue(sort));
  return {
    ...data,
    labels: index.map((i) => data.labels[i]),
    series: data.series.map((s) => ({ ...s, values: index.map((i) => s.values[i] ?? null) })),
  };
}

// Pie "top N": the N largest slices, largest first, plus one "Other" slice
// holding the rest so the whole still adds up. topN 0 or >= the slice count
// changes nothing. otherIndex marks the folded slice (-1 when there isn't one).
export function foldPieSlices(data, topN = 0) {
  const values = data.series[0]?.values || [];
  const limit = Number.isInteger(topN) && topN > 0 ? topN : 0;
  // Folding a single slice into "Other" would just hide its name.
  if (!limit || limit >= data.labels.length - 1) return { ...data, otherIndex: -1 };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const index = data.labels.map((_, i) => i).sort((a, b) => num(values[b]) - num(values[a]));
  const kept = index.slice(0, limit);
  const rest = index.slice(limit).reduce((sum, i) => sum + num(values[i]), 0);
  const labels = kept.map((i) => data.labels[i]);
  const otherLabel = labels.includes('Other') ? 'All other' : 'Other';
  return {
    ...data,
    labels: [...labels, otherLabel],
    series: [{ ...data.series[0], values: [...kept.map((i) => num(values[i])), rest] }],
    otherIndex: labels.length,
  };
}

// ------------------------------------------------------------
// Time bucketing (line/bar "Group by time")
// Rows are grouped into local-time buckets on a category axis (no date
// adapter): minute, hour, day, week (starts Monday) or month. Empty buckets
// between the first and last are filled with null so an outage shows as a gap.
// ------------------------------------------------------------
export const TIME_BUCKETS = ['none', 'minute', 'hour', 'day', 'week', 'month'];
export const BUCKET_OPTIONS = [
  { value: 'none', label: 'Off' },
  { value: 'minute', label: 'Minute' },
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];
export const MAX_FILLED_BUCKETS = 500;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Epoch ms for a timestamp-like value, or null. Same formats as quiet.js
 * (ISO, epoch s/ms, nginx), except a bare 'YYYY-MM-DD' is local midnight,
 * not UTC, so day buckets don't slide into the previous day west of UTC.
 */
export function parseTime(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const m = DATE_ONLY.exec(text);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    const date = new Date(y, mo, d);
    return date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d ? date.getTime() : null;
  }
  return parseFullTime(value);
}

/** Local start (ms) of the bucket holding `ms`. */
export function bucketStart(ms, bucket) {
  const d = new Date(ms);
  switch (bucket) {
    case 'minute': d.setSeconds(0, 0); return d.getTime();
    case 'hour': d.setMinutes(0, 0, 0); return d.getTime();
    case 'day': return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    case 'week': return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    case 'month': return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    default: return ms;
  }
}

/** Start of the bucket after the one starting at `start`. */
export function nextBucket(start, bucket) {
  const d = new Date(start);
  switch (bucket) {
    // Fixed steps, no re-snap: re-snapping the repeated hour on a DST
    // fall-back day lands on the same key again and the fill loop stalls.
    case 'minute': return start + 60000;
    case 'hour': return start + 3600000;
    case 'day': return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    case 'week': return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    case 'month': return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    default: return start + 1;
  }
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Compact label for a bucket start. `span` says what the whole axis covers,
 * so labels only carry the date/year when it's needed to tell them apart.
 */
export function bucketLabel(start, bucket, { multiDay = false, multiYear = false } = {}) {
  const d = new Date(start);
  const day = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  const dated = multiYear ? `${day}, ${d.getFullYear()}` : day;
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  switch (bucket) {
    case 'minute':
    case 'hour': return multiDay ? `${dated} ${clock}` : clock;
    case 'day': return dated;
    case 'week': return `Wk of ${dated}`;
    case 'month': return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    default: return String(start);
  }
}

/**
 * One binding's rows grouped into time buckets: { keys: [bucket start ms,
 * ascending], values }. Rows whose x doesn't parse are dropped. Within a
 * bucket rows go in time order, so "Latest" is the newest row.
 */
export function bucketSeries(rows, { xField, yField, agg = 'sum' }, bucket) {
  if (!xField || (!yField && agg !== 'count') || !TIME_BUCKETS.includes(bucket) || bucket === 'none') return { keys: [], values: [] };
  const timed = (Array.isArray(rows) ? rows : [])
    .map((row, i) => ({ t: parseTime(row?.[xField]), y: row?.[yField], i }))
    .filter((r) => r.t !== null)
    .sort((a, b) => a.t - b.t || a.i - b.i);
  const groups = new Map();
  timed.forEach(({ t, y }) => {
    const key = bucketStart(t, bucket);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(y);
  });
  const keys = [...groups.keys()].sort((a, b) => a - b);
  return { keys, values: keys.map((k) => aggregate(groups.get(k), agg)) };
}

// every bucket from first to last, or null when that's more than `max`
function fillKeys(first, last, bucket, max) {
  const out = [];
  for (let k = first; k <= last; k = nextBucket(k, bucket)) {
    out.push(k);
    if (out.length > max) return null;
  }
  return out;
}

/**
 * Several bucketed series on one shared, sorted axis. Missing buckets are
 * null. With fill (the default) the empty buckets between the first and last
 * are added too, unless that would exceed maxBuckets.
 * Returns { keys, labels, datasets }.
 */
export function mergeTimeSeries(seriesList, bucket, { fill = true, maxBuckets = MAX_FILLED_BUCKETS } = {}) {
  const present = [...new Set(seriesList.flatMap((s) => s.keys))].sort((a, b) => a - b);
  const filled = fill && present.length > 1 ? fillKeys(present[0], present[present.length - 1], bucket, maxBuckets) : null;
  // Union with the real keys in case a DST shift put them off the fixed step.
  const keys = filled ? [...new Set([...filled, ...present])].sort((a, b) => a - b) : present;
  const first = keys.length ? new Date(keys[0]) : null;
  const last = keys.length ? new Date(keys[keys.length - 1]) : null;
  const span = {
    multiYear: Boolean(first) && first.getFullYear() !== last.getFullYear(),
    multiDay: Boolean(first) && bucketStart(keys[0], 'day') !== bucketStart(keys[keys.length - 1], 'day'),
  };
  const datasets = seriesList.map(({ keys: ks, values }) => {
    const byKey = new Map(ks.map((k, i) => [k, values[i]]));
    return keys.map((k) => (byKey.has(k) ? byKey.get(k) : null));
  });
  return { keys, labels: keys.map((k) => bucketLabel(k, bucket, span)), datasets };
}

// ------------------------------------------------------------
// Layout math
// ------------------------------------------------------------

// Rescale widget positions when the grid density changes. Cells are square,
// so heights scale by the same factor and widgets keep their on-screen size.
export function scaleLayout(widgets, fromCols, toCols) {
  if (fromCols === toCols) return widgets;
  const f = toCols / fromCols;
  return widgets.map((w) => {
    const width = Math.max(1, Math.min(toCols, Math.round(w.w * f)));
    return {
      ...w,
      x: Math.max(0, Math.min(toCols - width, Math.round(w.x * f))),
      y: Math.max(0, Math.round(w.y * f)),
      w: width,
      h: Math.max(1, Math.round(w.h * f)),
    };
  });
}

// Sizes in the widget registry are written for a 48-column grid.
export const BASE_COLUMNS = 48;

export function scaleSize({ w, h }, columns) {
  const f = columns / BASE_COLUMNS;
  return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
}
