// ============================================================
// DATA TRANSFORMS
// Pure functions, no DOM: turn source rows into chart-ready series.
// Covered by tests/editor.test.mjs.
// ============================================================

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
