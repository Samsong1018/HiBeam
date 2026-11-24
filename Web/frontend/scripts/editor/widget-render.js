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
import { kpiStatus, kpiDelta, deltaTone } from './kpi.js';
import { toneOf, isToneColumn } from './semantic.js';
import { staleState, quietText } from './quiet.js';

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
const STATUS_TEXT = { warn: 'Warning', alert: 'Alert' };

function renderKpi(body, widget, rows, source) {
  const { config } = widget;
  const [b] = config.bindings;
  const values = rows.map((r) => r[b.yField]);
  const value = aggregate(values, b.agg);
  const caption = `${AGGREGATIONS[b.agg]?.label || 'Sum'}${b.agg === 'count' ? ' of rows' : ` of ${b.yField}`} · ${source?.name || 'source'}`;

  const status = kpiStatus(value, config);
  if (status) body.dataset.status = status;
  const limit = status === 'alert' ? config.alertAt : config.warnAt;
  const flag = STATUS_TEXT[status] && h('span', {
    class: 'kpi-flag',
    title: `${STATUS_TEXT[status]}: ${config.higherIs === 'good' ? 'at or below' : 'at or above'} ${formatNumber(limit, config)}`,
  }, `${STATUS_TEXT[status]} · ${config.higherIs === 'good' ? '≤' : '≥'} ${formatNumber(limit, config)}`);

  const delta = config.showDelta ? kpiDelta(values, b.agg) : null;
  const change = delta !== null && h('span', { class: 'kpi-delta', dataset: { tone: deltaTone(delta, config) } },
    `${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${formatNumber(Math.abs(delta), config)}`,
    h('span', { class: 'visually-hidden' }, ' since the previous row'));

  body.append(
    ...(flag ? [flag] : []),
    h('p', { class: 'kpi-value' }, formatNumber(value, config), change),
    h('p', { class: 'kpi-caption' }, caption),
  );
}

// Show only rows that fit whole, with a "+N more" footer that switches the
// table to scrolling. Exports and screenshots then never cut a row in half.
function fitRows(wrap, more) {
  let expanded = false;
  const rowsOf = () => [...wrap.querySelectorAll('tbody tr')];
  // how many rows fit whole in the wrap at its current height
  const countFitting = (rows) => {
    const room = wrap.clientHeight - (wrap.querySelector('thead')?.offsetHeight || 0);
    let used = 0;
    let n = 0;
    for (const r of rows) {
      used += r.offsetHeight;
      if (used > room) break;
      n += 1;
    }
    return n;
  };
  const fit = () => {
    if (expanded) return;
    const rows = rowsOf();
    rows.forEach((r) => { r.hidden = false; });
    more.hidden = true;
    let shown = countFitting(rows);
    if (shown < rows.length) {
      more.textContent = '+0 more rows';
      more.hidden = false; // the footer takes space from the wrap, so measure again
      shown = Math.max(countFitting(rows), 1);
    }
    rows.forEach((r, i) => { r.hidden = i >= shown; });
    const hidden = rows.length - shown;
    more.hidden = hidden <= 0;
    more.textContent = `+${hidden.toLocaleString()} more row${hidden === 1 ? '' : 's'}`;
  };
  more.addEventListener('click', () => {
    expanded = true;
    rowsOf().forEach((r) => { r.hidden = false; });
    wrap.classList.add('is-expanded');
    more.hidden = true;
  });
  const observer = new ResizeObserver(() => requestAnimationFrame(fit));
  observer.observe(wrap);
  return () => observer.disconnect();
}

function cell(row, column) {
  const value = row[column] ?? '';
  const tone = isToneColumn(column) ? toneOf(value, column) : null;
  return h('td', tone ? { class: 'is-toned', dataset: { tone } } : {}, value);
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

// ------------------------------------------------------------
// Problem states: no rows, a field that's gone, a failed load
// ------------------------------------------------------------
function missingField(bindings, rowSets) {
  for (let i = 0; i < bindings.length; i += 1) {
    const rows = rowSets[i];
    if (!rows.length) continue;
    const gone = neededFields(bindings[i]).find((f) => !rows.some((r) => r && typeof r === 'object' && f in r));
    if (gone) return { field: gone, sourceId: bindings[i].sourceId };
  }
  return null;
}

// fields a binding reads that must exist in the rows
function neededFields(b) {
  return [b.xField, b.agg === 'count' ? '' : b.yField].filter(Boolean);
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
  const gone = missingField(bindings, rowSets);
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
