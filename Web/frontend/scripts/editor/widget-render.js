// ============================================================
// WIDGET RENDERING
// Fills a widget's content element for its type. Returns a cleanup
// function (destroys the Chart instance). `isCurrent()` lets an async
// render bail out if a newer render started while data was loading.
// ============================================================

import { h, clear } from './dom.js';
import { WIDGET_TYPES, REFRESH_OPTIONS, isDataWidget } from './widget-types.js';
import { AGGREGATIONS, aggregate, groupSeries, mergeSeries, bucketSeries, mergeTimeSeries, fieldsOf, formatNumber, formatCellValue, sortBars, foldPieSlices } from './data.js';
import { createChart } from './charts.js';
import { kpiStatus, kpiDelta, deltaTone, sparklinePoints } from './kpi.js';
import { toneOf, isToneColumn } from './semantic.js';
import { staleState, quietText } from './quiet.js';
import { fitRows } from './fit-rows.js';
import { renderGauge, renderStatus, statusFlag } from './render-gauge-status.js';

const noop = () => {};

function head(widget) {
  const { config } = widget;
  const refresh = REFRESH_OPTIONS.find((r) => r.value === config.refresh && r.value > 0);
  if (!config.title && !refresh) return null;
  return h('header', { class: 'widget-head' },
    h('h3', { class: 'widget-title' }, config.title || ''),
    refresh && h('span', { class: 'widget-badge', title: `Refreshes ${refresh.label.toLowerCase()}` }, `↻ ${refresh.label.replace('Every ', '')}`),
  );
}

function message(text, tone = '') {
  return h('div', { class: `widget-message ${tone}` }, text);
}

function bindingReady(type, b) {
  if (!b?.sourceId) return false;
  const needs = WIDGET_TYPES[type].bindingFields;
  if (needs.includes('xField') && !b.xField) return false;
  if (needs.includes('yField') && !b.yField && (b.agg !== 'count' || !needs.includes('agg'))) return false;
  return true;
}

// ------------------------------------------------------------
// Static widgets
// ------------------------------------------------------------
function renderText(body, { config }) {
  body.append(h('p', { class: 'widget-text', dataset: { size: config.fontSize } }, config.body));
}

function renderLabel(body, { config }) {
  body.append(h('p', {
    class: `widget-label${config.muted ? ' is-muted' : ''}`,
    dataset: { size: config.size, align: config.align },
  }, config.text));
}

// ------------------------------------------------------------
// Data widgets
// ------------------------------------------------------------
const SPARK_W = 100;
const SPARK_H = 24;

// The KPI's rows as a tiny trend line. Plain SVG, not a Chart: cheap, and
// html2canvas exports it as-is. The viewBox stretches to the card's width;
// non-scaling-stroke keeps the line a steady 1.5px.
function sparkline(values, color) {
  const points = sparklinePoints(values, SPARK_W, SPARK_H);
  if (!points) return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'kpi-spark');
  svg.setAttribute('viewBox', `0 0 ${SPARK_W} ${SPARK_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // the widget's colour as a variable; CSS swaps in the warn/alert tone when a threshold trips
  svg.style.setProperty('--spark', /^#[0-9a-f]{6}$/i.test(color) ? color : `var(--chart-${color || 'c1'})`);
  const area = document.createElementNS(ns, 'polygon');
  area.setAttribute('class', 'kpi-spark-area');
  area.setAttribute('points', `0,${SPARK_H} ${points} ${SPARK_W},${SPARK_H}`);
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('class', 'kpi-spark-line');
  line.setAttribute('points', points);
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(area, line);
  return svg;
}

// html2canvas serialises an SVG on its own, where page CSS and var() don't
// reach. Bake the resolved colour into attributes (re-run on every render,
// and a theme change re-renders, so it stays in step with the theme).
function bakeSparkColor(svg) {
  if (!svg?.isConnected) return;
  const color = getComputedStyle(svg).color;
  if (!color) return;
  svg.querySelector('.kpi-spark-line')?.setAttribute('stroke', color);
  svg.querySelector('.kpi-spark-area')?.setAttribute('fill', color);
}

function renderKpi(body, widget, rows, source) {
  const { config } = widget;
  const [b] = config.bindings;
  const values = rows.map((r) => r[b.yField]);
  const value = aggregate(values, b.agg);
  const caption = `${AGGREGATIONS[b.agg]?.label || 'Sum'}${b.agg === 'count' ? ' of rows' : ` of ${b.yField}`} · ${source?.name || 'source'}`;

  const status = kpiStatus(value, config);
  if (status) body.dataset.status = status;
  const flag = statusFlag(status, config);

  const delta = config.showDelta ? kpiDelta(values, b.agg) : null;
  const change = delta !== null && h('span', { class: 'kpi-delta', dataset: { tone: deltaTone(delta, config) } },
    `${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${formatNumber(Math.abs(delta), config)}`,
    h('span', { class: 'visually-hidden' }, ' since the previous row'));

  const spark = config.sparkline ? sparkline(values, config.color) : null;
  if (spark) body.classList.add('has-spark');

  body.append(
    ...(flag ? [flag] : []),
    h('p', { class: 'kpi-value' }, formatNumber(value, config), change),
    ...(spark ? [spark] : []),
    h('p', { class: 'kpi-caption', title: caption }, caption),
  );
  bakeSparkColor(spark);
}

function cell(row, column) {
  const value = row[column] ?? '';
  const tone = isToneColumn(column) ? toneOf(value, column) : null;
  const { text, raw } = formatCellValue(value);
  const attrs = tone ? { class: 'is-toned', dataset: { tone } } : {};
  return h('td', raw ? { ...attrs, title: raw } : attrs, text);
}

function renderTable(body, widget, rows) {
  const all = fieldsOf(rows).map((f) => f.name);
  const columns = widget.config.columns.filter((c) => all.includes(c));
  const shown = columns.length ? columns : all;
  const limit = Math.min(Math.max(Number(widget.config.limit) || 50, 1), 500);
  const wrap = h('div', { class: 'widget-table-wrap widget-nodrag' },
    h('table', { class: 'widget-table' },
      h('thead', {}, h('tr', {}, shown.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, rows.slice(0, limit).map((row) => h('tr', {}, shown.map((c) => cell(row, c)))))));
  const more = h('button', { type: 'button', class: 'table-more widget-nodrag', hidden: true, title: 'Show every row' });
  body.append(wrap, more);
  return fitRows(wrap, more);
}

// "Group by time" on line/bar: one shared bucket axis for every series.
// null when it's off or no row's x parses as a date (then x stays categories).
function bucketedData(widget, rowSets, labels) {
  const { bucket } = widget.config;
  if (!['line', 'bar'].includes(widget.type) || !bucket || bucket === 'none') return null;
  const series = widget.config.bindings.map((b, i) => bucketSeries(rowSets[i], b, bucket));
  if (series.every((s) => !s.keys.length)) return null;
  const merged = mergeTimeSeries(series, bucket);
  return { labels: merged.labels, series: labels.map((label, i) => ({ label, values: merged.datasets[i] })), bucketed: true };
}

function chartData(widget, rowSets, sources) {
  const distinctSources = new Set(widget.config.bindings.map((b) => b.sourceId)).size;
  const labels = widget.config.bindings.map((b, i) => {
    const name = b.agg === 'count' ? 'count' : b.yField;
    return distinctSources > 1 ? `${name} · ${sources[i]?.name || 'source'}` : name;
  });
  const timed = bucketedData(widget, rowSets, labels);
  if (timed) return timed; // a time axis stays in time order: sort/top N don't apply
  const series = widget.config.bindings.map((b, i) => ({ ...groupSeries(rowSets[i], b), label: labels[i] }));
  const merged = mergeSeries(series);
  const data = { labels: merged.labels, series: series.map((s, i) => ({ label: s.label, values: merged.datasets[i] })) };
  if (widget.type === 'bar') return sortBars(data, widget.config);
  if (widget.type === 'pie') return foldPieSlices(data, widget.config.topN);
  return data;
}

// ------------------------------------------------------------
// Problem states: no rows, a field that's gone, a failed load
// ------------------------------------------------------------
function missingField(type, bindings, rowSets) {
  for (let i = 0; i < bindings.length; i += 1) {
    const rows = rowSets[i];
    if (!rows.length) continue;
    const gone = neededFields(type, bindings[i]).find((f) => !rows.some((r) => r && typeof r === 'object' && f in r));
    if (gone) return { field: gone, sourceId: bindings[i].sourceId };
  }
  return null;
}

// fields a binding reads that must exist in the rows (count ignores y, except
// on types without an aggregate, like the uptime strip's status column)
function neededFields(type, b) {
  const countsRows = b.agg === 'count' && WIDGET_TYPES[type].bindingFields.includes('agg');
  return [b.xField, countsRows ? '' : b.yField].filter(Boolean);
}

function problem(title, detail, tone, retry) {
  return h('div', { class: `widget-message widget-problem ${tone}`, role: tone === 'is-error' ? 'alert' : undefined },
    h('p', { class: 'widget-problem-title' }, title),
    detail && h('p', { class: 'widget-problem-detail' }, detail),
    retry && h('button', { type: 'button', class: 'btn btn-ghost btn-sm widget-nodrag', onclick: retry }, 'Try again'));
}

// ------------------------------------------------------------
// Gone quiet: the widget fades and a little ghost says when the
// source last spoke. The data stays readable underneath.
// ------------------------------------------------------------
function ghostIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'quiet-ghost');
  const body = document.createElementNS(ns, 'path');
  body.setAttribute('d', 'M5 20V10a7 7 0 0 1 14 0v10l-2.3-1.6L14.3 20 12 18.4 9.7 20l-2.4-1.6z');
  body.setAttribute('class', 'quiet-ghost-body');
  const eyes = document.createElementNS(ns, 'path');
  eyes.setAttribute('d', 'M9.5 10.5v1.2M14.5 10.5v1.2');
  eyes.setAttribute('class', 'quiet-ghost-eyes');
  svg.append(body, eyes);
  return svg;
}

function markQuiet(body, reason, seenAt) {
  const { title, detail } = quietText(reason, seenAt);
  body.dataset.quiet = reason;
  body.prepend(h('p', { class: 'quiet-badge', title: seenAt ? new Date(seenAt).toLocaleString() : '' },
    ghostIcon(),
    h('span', { class: 'quiet-title' }, title),
    h('span', { class: 'quiet-detail' }, detail)));
}

// Load every binding's rows. If a load fails but each source has rows from
// an earlier load, keep showing those and call the widget unreachable.
async function loadRows(bindings, registry) {
  try {
    return { rowSets: await Promise.all(bindings.map((b) => registry.rows(b.sourceId))) };
  } catch (err) {
    const kept = bindings.map((b) => registry.lastGood?.(b.sourceId) || null);
    if (kept.every(Boolean)) {
      return { rowSets: kept.map((k) => k.rows), unreachable: Math.min(...kept.map((k) => k.at)) };
    }
    return { error: err };
  }
}

function quietCheck(widget, rowSets) {
  const states = rowSets.map((rows) => staleState(rows, widget.config));
  const stale = states.filter((st) => st.quiet);
  if (!stale.length) return null;
  return Math.max(...stale.map((st) => st.lastSeen));
}

async function renderData(body, widget, registry, isCurrent, opts) {
  const bindings = widget.config.bindings.filter((b) => bindingReady(widget.type, b));
  if (!bindings.length) {
    body.append(message(opts.emptyText || 'Pick a source and fields in the panel →', 'is-empty'));
    return noop;
  }

  body.append(h('div', { class: 'widget-skeleton', 'aria-hidden': 'true' }));
  const loaded = await loadRows(bindings, registry);
  if (!isCurrent()) return noop;
  clear(body);
  if (loaded.error) {
    const reason = loaded.error?.message && loaded.error.message !== 'Source unavailable' ? loaded.error.message : '';
    body.append(problem('Couldn\'t load this source', reason || (opts.readOnly ? 'It may be down. This will try again on the next refresh.' : 'Check the connection in the Sources panel.'), 'is-error', opts.retry));
    return noop;
  }

  let { rowSets } = loaded;
  const sources = bindings.map((b) => registry.byId(b.sourceId));
  if (rowSets.every((rows) => !rows.length)) {
    body.append(problem('No rows yet', `${sources[0]?.name || 'This source'} came back empty.`, 'is-empty', opts.retry));
    return noop;
  }
  const gone = missingField(widget.type, bindings, rowSets);
  if (gone) {
    const name = registry.byId(gone.sourceId)?.name || 'this source';
    body.append(problem(`No "${gone.field}" column`, opts.readOnly
      ? `${name} doesn't send that column any more.`
      : `${name} doesn't send that column any more. Pick another field in the panel.`, 'is-empty'));
    return noop;
  }

  // newest-first feeds: flip so lines read oldest → newest and "Latest" is the newest row
  if (widget.config.reverseData) rowSets = rowSets.map((rows) => [...rows].reverse());
  const scoped = { ...widget, config: { ...widget.config, bindings } };

  let cleanup = noop;
  if (widget.type === 'kpi') renderKpi(body, scoped, rowSets[0], sources[0]);
  else if (widget.type === 'gauge') cleanup = renderGauge(body, scoped, rowSets[0], sources[0]);
  else if (widget.type === 'status') cleanup = renderStatus(body, scoped, rowSets[0]);
  else if (widget.type === 'table') cleanup = renderTable(body, scoped, rowSets[0]);
  else {
    const canvas = h('canvas', { role: 'img', 'aria-label': `${WIDGET_TYPES[widget.type].label}: ${widget.config.title || 'untitled'}` });
    body.append(h('div', { class: 'widget-chart' }, canvas));
    const chart = createChart(canvas, scoped, chartData(scoped, rowSets, sources));
    cleanup = () => chart.destroy();
  }

  if (loaded.unreachable) markQuiet(body, 'unreachable', loaded.unreachable);
  else {
    const seenAt = quietCheck(widget, rowSets);
    if (seenAt) markQuiet(body, 'stale', seenAt);
  }
  return cleanup;
}

// ------------------------------------------------------------
// Entry
// ------------------------------------------------------------
// opts.emptyText  overrides the "pick a source" hint (the viewer has no panel)
// opts.readOnly   wording for viewers who can't change the bindings
// opts.retry      shown as "Try again" on a failed or empty load
export async function renderWidget(content, widget, registry, isCurrent, opts = {}) {
  clear(content);
  const top = head(widget);
  const body = h('div', { class: 'widget-body' });
  if (top) content.append(top);
  content.append(body);

  if (widget.type === 'text') { renderText(body, widget); return noop; }
  if (widget.type === 'label') { renderLabel(body, widget); return noop; }
  if (isDataWidget(widget.type)) return renderData(body, widget, registry, isCurrent, opts);
  return noop;
}
