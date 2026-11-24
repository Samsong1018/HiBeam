// ============================================================
// DASHBOARD GENERATOR
// Pure functions, no DOM, no network: turn the preview rows of one or more
// sources into an ordinary dashboard document (label, KPIs, charts, table
// per source). Rule-based, so the same rows always give the same board.
// Spec: .kiro/specs/dashboard-generator/. Covered by tests/generator*.test.mjs.
// ============================================================

import { WIDGET_TYPES } from './widget-types.js';
import { scaleSize, toNumber, parseTime } from './data.js';

const SAMPLE_SIZE = 100;
const MAX_FIELD_NAME = 120; // normalizeBinding cuts xField/yField at 120
const MAX_LABEL_VALUE = 80;
const MAX_TITLE = 80;
const MAX_SOURCE_ID = 64;
const MAX_WIDGETS = 200;
const MAX_Y = 10000; // normalizeWidget clamps y here
const MAX_KPIS = 3;
const MAX_SERIES = 3;
const MAX_PIE_SLICES = 6;
const ORDERED_SHARE = 0.8;
// time bucketing on log-like line charts: enough rows, and timestamps with a clock
const BUCKET_MIN_ROWS = 20;
const BUCKET_MAX_COUNT = 360;
const HAS_CLOCK = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const BUCKET_SIZES = [['minute', 6e4], ['hour', 36e5], ['day', 864e5], ['week', 6048e5], ['month', 26784e5]];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DATE = /^\d{4}\/\d{2}\/\d{2}$/;
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const ORDERED_LABEL = [
  new RegExp(`^(${MONTHS})\\.?( \\d{4})?$`, 'i'), // "June", "Jun", "Jun 2026"
  /^\d{1,2}:\d{2}(:\d{2})?$/, // "14:05", "14:05:30"
];

const IS_IDENTIFIER = (name) => /^id$/i.test(name) || /_id$/i.test(name) || /[a-z]Id$/.test(name);
const CODE_HINT = /(^|_)(status|code|level|type|kind|state)$|[a-z](Status|Code|Level|Type|Kind|State)$/i;
const IS_RATE = (name) => /(pct|percent|%\)?)\s*$/i.test(name);
const IS_TOTAL = (name) => /(total|count)\s*$/i.test(name);
const IS_MONEY = (name) => name.includes('$');
// Stock quantities: on an ordered axis the latest value is the answer, not the sum.
const IS_STOCK = (name) => /(balance|worth|price|uptime|inventory|stock|temp)/i.test(name);

/** @typedef {'time'|'number'|'category'|'label'|'text'|'empty'} Role */
/** @typedef {{ name: string, role: Role, distinct: number, presentCount: number, ordered: boolean }} FieldProfile */

// ------------------------------------------------------------
// Profiling
// ------------------------------------------------------------
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPresent = (v) => v !== null && v !== undefined && v !== '';

function sampleOf(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isPlainObject).slice(0, SAMPLE_SIZE);
}

function isTimeValue(v) {
  return typeof v === 'string' && (ISO_DATE.test(v) || SLASH_DATE.test(v)) && !Number.isNaN(Date.parse(v));
}

function isShortString(v) {
  return typeof v === 'string' && v.length <= MAX_LABEL_VALUE;
}

function orderedShare(values) {
  const hits = values.filter((v) => typeof v === 'string' && ORDERED_LABEL.some((re) => re.test(v.trim()))).length;
  return hits / values.length;
}

function lowCardinality(distinct, count) {
  return distinct >= 2 && distinct <= 12 && distinct <= count / 2;
}

function roleOf(name, present, distinct) {
  const count = present.length;
  if (!count) return { role: 'empty', ordered: false };
  if (IS_IDENTIFIER(name)) return { role: 'text', ordered: false };
  if (present.every(isTimeValue)) return { role: 'time', ordered: false };

  if (present.every((v) => toNumber(v) !== null)) {
    const nums = present.map(toNumber);
    const coded = nums.every(Number.isInteger) && lowCardinality(distinct, count)
      && (CODE_HINT.test(name) || nums.every((n) => n === 0 || n === 1));
    return { role: coded ? 'category' : 'number', ordered: false };
  }

  const allShort = present.every(isShortString);
  if (count >= 2 && allShort && orderedShare(present) >= ORDERED_SHARE) return { role: 'label', ordered: true };
  if (lowCardinality(distinct, count) && present.every((v) => typeof v === 'string' || typeof v === 'boolean')) {
    return { role: 'category', ordered: false };
  }
  if (count >= 2 && allShort && distinct === count) return { role: 'label', ordered: false };
  return { role: 'text', ordered: false };
}

/**
 * One profile per field in the sample, in first-seen order.
 * @param {unknown} rows
 * @returns {FieldProfile[]}
 */
export function profileFields(rows) {
  const sample = sampleOf(rows);
  const names = [...new Set(sample.flatMap((row) => Object.keys(row)))].filter((n) => n.length <= MAX_FIELD_NAME);
  return names.map((name) => {
    const present = sample.map((row) => row[name]).filter(isPresent);
    const distinct = new Set(present.map(String)).size;
    return { name, ...roleOf(name, present, distinct), distinct, presentCount: present.length };
  });
}

/**
 * Number fields in KPI order: rates, then totals/counts, then money, then the rest.
 * Stable, so ties keep first-seen order.
 * @param {FieldProfile[]} profiles
 * @returns {FieldProfile[]}
 */
export function rankNumbers(profiles) {
  const tier = ({ name }) => (IS_RATE(name) ? 0 : IS_TOTAL(name) ? 1 : IS_MONEY(name) ? 2 : 3);
  return profiles
    .filter((f) => f.role === 'number')
    .map((f, i) => ({ f, i, t: tier(f) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ f }) => f);
}

// ------------------------------------------------------------
// Aggregation choice
// ------------------------------------------------------------
// KPI: on an ordered axis, gauges (rates, balances) show the latest value;
// flows (revenue, bytes, spending) always sum. Without an axis, rates average.
function kpiAgg(name, orderedAxis) {
  if (orderedAxis && (IS_RATE(name) || IS_STOCK(name))) return 'last';
  return IS_RATE(name) ? 'avg' : 'sum';
}

// Charts group rows by x; when x repeats, gauges must not be added up.
function chartAgg(name) {
  if (IS_RATE(name)) return 'avg';
  return IS_STOCK(name) ? 'last' : 'sum';
}

function isDescending(rows, field) {
  const times = rows.map((r) => r[field]).filter(isPresent).map((v) => Date.parse(v));
  return times.length >= 2 && times[0] > times[times.length - 1];
}

// ------------------------------------------------------------
// Widget construction
// ------------------------------------------------------------
const cut = (text, max = MAX_TITLE) => String(text).slice(0, max);

function binding(sourceId, { xField = '', yField = '', agg = 'sum' } = {}) {
  return { sourceId, xField, yField, agg };
}

function widget(type, makeId, overrides) {
  return { id: makeId('w'), type, x: 0, y: 0, w: 1, h: 1, config: { ...structuredClone(WIDGET_TYPES[type].defaults), bindings: [], ...overrides } };
}

function kpiFormat(name) {
  if (IS_RATE(name)) return { suffix: '%', decimals: 1 };
  if (IS_MONEY(name)) return { prefix: '$' };
  return {};
}

function pickKpis(ctx) {
  const { sourceId, measures, orderedAxis, reverse, makeId, rowCount } = ctx;
  if (!measures.length) {
    return rowCount ? [widget('kpi', makeId, { title: 'Rows', bindings: [binding(sourceId, { agg: 'count' })] })] : [];
  }
  return measures.slice(0, MAX_KPIS).map((f) => widget('kpi', makeId, {
    title: cut(f.name),
    bindings: [binding(sourceId, { yField: f.name, agg: kpiAgg(f.name, orderedAxis) })],
    ...kpiFormat(f.name),
    ...(reverse ? { reverseData: true } : {}),
  }));
}

// A log-like timestamp column (many rows, values with a clock) gets a time
// bucket: the smallest one at least as wide as the typical gap between rows,
// widened until the sample's span fits in BUCKET_MAX_COUNT buckets.
// 'none' otherwise, so daily or monthly tables keep their plain axis.
function pickBucket(rows, field) {
  if (rows.length < BUCKET_MIN_ROWS) return 'none';
  const present = rows.map((r) => r[field]).filter(isPresent);
  if (!present.every((v) => typeof v === 'string' && HAS_CLOCK.test(v))) return 'none';
  const times = [...new Set(present.map(parseTime).filter((t) => t !== null))].sort((a, b) => a - b);
  if (times.length < 2) return 'none';
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const typical = gaps[Math.floor(gaps.length / 2)];
  const span = times[times.length - 1] - times[0];
  const fit = BUCKET_SIZES.find(([, size]) => size >= typical && span / size <= BUCKET_MAX_COUNT);
  return fit ? fit[0] : 'none';
}

function lineOver(ctx, xField, reverse, bucket = 'none') {
  const ys = ctx.measures.slice(0, MAX_SERIES);
  return widget('line', ctx.makeId, {
    title: cut(`${ys.map((f) => f.name).join(', ')} over ${xField}`),
    bindings: ys.map((f) => binding(ctx.sourceId, { xField, yField: f.name, agg: chartAgg(f.name) })),
    reverseData: reverse,
    ...(bucket !== 'none' ? { bucket } : {}),
    // levels like net worth or a price sit far from zero; a zero baseline flattens them
    ...(ys.length && ys.every((f) => IS_STOCK(f.name)) ? { zeroBased: false } : {}),
  });
}

// Bars and pies of averages per category say little; prefer the first non-rate measure.
function barMeasure(measures) {
  return measures.find((f) => !IS_RATE(f.name)) || measures[0];
}

function categoryCharts(ctx, cat) {
  const { sourceId, measures, makeId } = ctx;
  if (!measures.length) {
    const count = binding(sourceId, { xField: cat.name, agg: 'count' });
    const out = [widget('bar', makeId, { title: cut(`Rows by ${cat.name}`), bindings: [count] })];
    if (cat.distinct <= MAX_PIE_SLICES) out.push(widget('pie', makeId, { title: cut(`Share of rows by ${cat.name}`), bindings: [{ ...count }] }));
    return out;
  }
  const y = barMeasure(measures);
  const agg = chartAgg(y.name);
  const out = [widget('bar', makeId, { title: cut(`${y.name} by ${cat.name}`), bindings: [binding(sourceId, { xField: cat.name, yField: y.name, agg })] })];
  if (cat.distinct <= MAX_PIE_SLICES && agg === 'sum') {
    out.push(widget('pie', makeId, { title: cut(`${y.name} share by ${cat.name}`), bindings: [binding(sourceId, { xField: cat.name, yField: y.name, agg })] }));
  }
  return out;
}

function pickCharts(ctx, { time, category, label }) {
  if (ctx.rowCount < 2) return [];
  const out = [];
  if (time && ctx.measures.length) out.push(lineOver(ctx, time.name, isDescending(ctx.rows, time.name), pickBucket(ctx.rows, time.name)));
  if (category) out.push(...categoryCharts(ctx, category));
  if (!time && !category && label && ctx.measures.length) {
    if (label.ordered) out.push(lineOver(ctx, label.name, false));
    else {
      const y = barMeasure(ctx.measures);
      out.push(widget('bar', ctx.makeId, {
        title: cut(`${y.name} by ${label.name}`),
        bindings: [binding(ctx.sourceId, { xField: label.name, yField: y.name, agg: chartAgg(y.name) })],
      }));
    }
  }
  return out;
}

// ------------------------------------------------------------
// Layout
// ------------------------------------------------------------
// Each band is one row of up to three widgets, widened to the full grid.
function layoutBands(bands, columns, top) {
  let y = top;
  const placed = [];
  bands.filter((b) => b.length).forEach((band) => {
    const k = band.length;
    const base = Math.floor(columns / k);
    let x = 0;
    let bandHeight = 1;
    band.forEach((w, i) => {
      const width = i === k - 1 ? columns - x : base;
      const { h } = scaleSize(WIDGET_TYPES[w.type].size, columns);
      placed.push({ ...w, x, y, w: width, h });
      x += width;
      bandHeight = Math.max(bandHeight, h);
    });
    y += bandHeight;
  });
  return placed;
}

const bottomOf = (widgets) => widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);

/**
 * Widgets for one source, laid out from `top` (default 0).
 * @param {{ id: string, name: string }} source
 * @param {unknown} rows
 * @param {{ columns: number, makeId: (prefix?: string) => string, top?: number }} options
 */
export function generateSection(source, rows, { columns, makeId, top = 0 }) {
  const sourceId = cut(source?.id ?? '', MAX_SOURCE_ID);
  const sample = sampleOf(rows);
  const heading = widget('label', makeId, { text: cut(source?.name || 'Source') });

  if (!sample.length) {
    const note = widget('text', makeId, { body: 'This source returned no rows.' });
    return layoutBands([[heading], [note]], columns, top);
  }

  const profiles = profileFields(sample);
  const first = (role, pred = () => true) => profiles.find((f) => f.role === role && pred(f));
  const time = first('time');
  const category = first('category');
  const label = first('label', (f) => f.ordered) || first('label');
  const reverse = Boolean(time) && isDescending(sample, time.name);
  const ctx = {
    sourceId,
    makeId,
    rows: sample,
    rowCount: sample.length,
    measures: rankNumbers(profiles),
    orderedAxis: Boolean(time) || Boolean(label?.ordered),
    reverse,
  };

  const kpis = pickKpis(ctx);
  const charts = pickCharts(ctx, { time, category, label });
  const table = widget('table', makeId, { title: 'All rows', bindings: [binding(sourceId)] });
  return layoutBands([[heading], kpis, charts, [table]], columns, top);
}

/**
 * Build a dashboard from sources. Never mutates its inputs.
 * @param {{ name: string, grid: { columns: number, showGrid: boolean }, widgets: object[] }} current
 * @param {{ source: { id: string, name: string }, rows: unknown }[]} inputs
 * @param {{ mode: 'replace' | 'append', makeId: (prefix?: string) => string }} options
 * @returns {{ dashboard: object, error: null | 'no_sources' | 'too_many_widgets' | 'too_tall' }}
 */
export function generateDashboard(current, inputs, { mode, makeId }) {
  const list = Array.isArray(inputs) ? inputs : [];
  if (!list.length) return { dashboard: current, error: 'no_sources' };

  const { columns } = current.grid;
  const kept = mode === 'append' ? current.widgets : [];
  let top = bottomOf(kept);
  const generated = [];
  list.forEach(({ source, rows }) => {
    const sectionWidgets = generateSection(source, rows, { columns, makeId, top });
    generated.push(...sectionWidgets);
    top = bottomOf(sectionWidgets);
  });

  if (kept.length + generated.length > MAX_WIDGETS) return { dashboard: current, error: 'too_many_widgets' };
  if (generated.some((w) => w.y > MAX_Y)) return { dashboard: current, error: 'too_tall' };
  return { dashboard: { name: current.name, grid: { ...current.grid }, widgets: [...kept, ...generated] }, error: null };
}

// ------------------------------------------------------------
// Reasons
// ------------------------------------------------------------
// The same rules generateSection follows, written out per field so an agent
// (or a person) can see why the draft looks the way it does. Read-only: it
// never changes what generateSection builds.

function fieldReason(f, ctx) {
  const { orderedAxis, time, reverse } = ctx;
  const n = `"${f.name}"`;
  switch (f.role) {
    case 'empty': return `${n} has no values in the sample, so it's left out.`;
    case 'time':
      return reverse && f.name === time?.name
        ? `${n} is a timestamp and the rows run newest first, so lines are flipped to read left to right and "Latest" means the newest row.`
        : `${n} is a timestamp, so it becomes the x axis of a line chart.`;
    case 'label':
      return f.ordered
        ? `${n} holds ordered labels (months or clock times), so it's treated as a time axis.`
        : `${n} is a unique label per row, so it's used as the x axis of a bar chart when nothing better exists.`;
    case 'category': {
      const pie = f.distinct <= MAX_PIE_SLICES ? 'a bar and a pie' : `a bar but no pie (${f.distinct} values is more than ${MAX_PIE_SLICES} slices)`;
      const coded = CODE_HINT.test(f.name) ? ' It looks like a code (status, level, type), so it\'s never added up.' : '';
      return `${n} has ${f.distinct} repeating values, so it's a category: rows are grouped by it into ${pie}.${coded}`;
    }
    case 'number': {
      const kpi = kpiAgg(f.name, orderedAxis);
      const chart = chartAgg(f.name);
      if (IS_RATE(f.name)) {
        return `${n} is a rate, so the KPI shows ${kpi === 'last' ? 'the latest value' : 'the average'} and charts average it. Adding percentages up would be meaningless.`;
      }
      if (IS_STOCK(f.name)) {
        return `${n} is a level (a balance, price or uptime), so ${kpi === 'last' ? 'the KPI shows the latest value' : 'the KPI sums it'} and charts take the latest value per point instead of summing.`;
      }
      return `${n} is a flow (an amount that accumulates), so the KPI and charts ${chart === 'sum' ? 'sum it' : `use ${chart}`}.`;
    }
    default:
      return IS_IDENTIFIER(f.name)
        ? `${n} is an identifier, so it's only shown in the table, never charted or summed.`
        : `${n} is free text, so it's only shown in the table.`;
  }
}

/**
 * One plain-English reason per field for the board generateSection would build.
 * Pure and deterministic, like the generator itself.
 * @param {{ id: string, name: string }} source
 * @param {unknown} rows
 * @returns {{ source: string, rows: number, reasons: { field: string, role: Role, reason: string }[] }}
 */
export function explainSection(source, rows) {
  const sample = sampleOf(rows);
  const name = cut(source?.name || 'Source');
  if (!sample.length) return { source: name, rows: 0, reasons: [] };
  const profiles = profileFields(sample);
  const time = profiles.find((f) => f.role === 'time');
  const label = profiles.find((f) => f.role === 'label' && f.ordered) || profiles.find((f) => f.role === 'label');
  const ctx = {
    orderedAxis: Boolean(time) || Boolean(label?.ordered),
    time,
    reverse: Boolean(time) && isDescending(sample, time.name),
  };
  return {
    source: name,
    rows: sample.length,
    reasons: profiles.map((f) => ({ field: f.name, role: f.role, reason: fieldReason(f, ctx) })),
  };
}
