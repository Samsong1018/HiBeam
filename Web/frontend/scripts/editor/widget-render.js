// ============================================================
// WIDGET RENDERING
// Fills a widget's content element for its type. Returns a cleanup
// function (destroys the Chart instance). `isCurrent()` lets an async
// render bail out if a newer render started while data was loading.
// ============================================================

import { h, clear } from './dom.js';
import { WIDGET_TYPES, REFRESH_OPTIONS, isDataWidget } from './widget-types.js';
import { AGGREGATIONS, aggregate, groupSeries, mergeSeries, fieldsOf, formatNumber } from './data.js';
import { createChart } from './charts.js';

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
  if (needs.includes('yField') && !b.yField && b.agg !== 'count') return false;
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
function renderKpi(body, widget, rows, source) {
  const [b] = widget.config.bindings;
  const value = aggregate(rows.map((r) => r[b.yField]), b.agg);
  const caption = `${AGGREGATIONS[b.agg]?.label || 'Sum'}${b.agg === 'count' ? ' of rows' : ` of ${b.yField}`} · ${source?.name || 'source'}`;
  body.append(
    h('p', { class: 'kpi-value' }, formatNumber(value, widget.config)),
    h('p', { class: 'kpi-caption' }, caption),
  );
}

function renderTable(body, widget, rows) {
  const all = fieldsOf(rows).map((f) => f.name);
  const columns = widget.config.columns.filter((c) => all.includes(c));
  const shown = columns.length ? columns : all;
  const limit = Math.min(Math.max(Number(widget.config.limit) || 50, 1), 500);
  body.append(h('div', { class: 'widget-table-wrap widget-nodrag' },
    h('table', { class: 'widget-table' },
      h('thead', {}, h('tr', {}, shown.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, rows.slice(0, limit).map((row) => h('tr', {}, shown.map((c) => h('td', {}, row[c] ?? ''))))),
    )));
}

function chartData(widget, rowSets, sources) {
  const distinctSources = new Set(widget.config.bindings.map((b) => b.sourceId)).size;
  const series = widget.config.bindings.map((b, i) => {
    const grouped = groupSeries(rowSets[i], b);
    const name = b.agg === 'count' ? 'count' : b.yField;
    const label = distinctSources > 1 ? `${name} · ${sources[i]?.name || 'source'}` : name;
    return { ...grouped, label };
  });
  const merged = mergeSeries(series);
  return { labels: merged.labels, series: series.map((s, i) => ({ label: s.label, values: merged.datasets[i] })) };
}

async function renderData(body, widget, registry, isCurrent, opts) {
  const bindings = widget.config.bindings.filter((b) => bindingReady(widget.type, b));
  if (!bindings.length) {
    body.append(message(opts.emptyText || 'Pick a source and fields in the panel →', 'is-empty'));
    return noop;
  }

  body.append(h('div', { class: 'widget-skeleton', 'aria-hidden': 'true' }));
  let rowSets;
  try {
    rowSets = await Promise.all(bindings.map((b) => registry.rows(b.sourceId)));
  } catch (err) {
    if (isCurrent()) clear(body).append(message('Couldn\'t load this source. Check the connection.', 'is-error'));
    return noop;
  }
  if (!isCurrent()) return noop;
  clear(body);

  const sources = bindings.map((b) => registry.byId(b.sourceId));
  const scoped = { ...widget, config: { ...widget.config, bindings } };

  if (widget.type === 'kpi') { renderKpi(body, scoped, rowSets[0], sources[0]); return noop; }
  if (widget.type === 'table') { renderTable(body, scoped, rowSets[0]); return noop; }

  const canvas = h('canvas', { role: 'img', 'aria-label': `${WIDGET_TYPES[widget.type].label}: ${widget.config.title || 'untitled'}` });
  body.append(h('div', { class: 'widget-chart' }, canvas));
  const chart = createChart(canvas, scoped, chartData(scoped, rowSets, sources));
  return () => chart.destroy();
}

// ------------------------------------------------------------
// Entry
// ------------------------------------------------------------
// opts.emptyText overrides the "pick a source" hint (the viewer has no panel)
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
