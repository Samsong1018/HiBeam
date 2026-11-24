// ============================================================
// GAUGE + UPTIME STRIP RENDERING
// Thin DOM layer over gauge.js and status-strip.js. Called from
// widget-render.js once the rows have loaded. Built with h(), never
// innerHTML: service names and status values come from the source.
// ============================================================

import { h } from './dom.js';
import { AGGREGATIONS, aggregate, formatNumber } from './data.js';
import { kpiStatus } from './kpi.js';
import { gaugeFraction, gaugeTone, normalizeGaugeConfig } from './gauge.js';
import { statusStrips, normalizeStatusConfig, uptimeText } from './status-strip.js';
import { createGaugeChart } from './charts.js';
import { fitRows } from './fit-rows.js';

const noop = () => {};
const STATUS_TEXT = { warn: 'Warning', alert: 'Alert' };

/** The "Warning · ≥ 70" pill shared by Number and Gauge widgets, or null. */
export function statusFlag(status, config) {
  if (!STATUS_TEXT[status]) return null;
  const limit = status === 'alert' ? config.alertAt : config.warnAt;
  const good = config.higherIs === 'good';
  return h('span', {
    class: 'kpi-flag',
    title: `${STATUS_TEXT[status]}: ${good ? 'at or below' : 'at or above'} ${formatNumber(limit, config)}`,
  }, `${STATUS_TEXT[status]} · ${good ? '≤' : '≥'} ${formatNumber(limit, config)}`);
}

// ------------------------------------------------------------
// Gauge: half-donut on a canvas, the value as DOM text in its bowl
// ------------------------------------------------------------
export function renderGauge(body, widget, rows, source) {
  const { config } = widget;
  const g = normalizeGaugeConfig(config);
  const [b] = config.bindings;
  const value = aggregate(rows.map((r) => r?.[b.yField]), b.agg);
  const fmt = { decimals: g.decimals, prefix: g.prefix, suffix: g.suffix };
  const text = formatNumber(value, fmt);
  // whole-number ends read "0%" / "100%", not "0.0%" / "100.0%"
  const endText = (n) => formatNumber(n, Number.isInteger(n) ? { ...fmt, decimals: 0 } : fmt);

  const status = kpiStatus(value, g);
  if (status) body.dataset.status = status;
  const flag = statusFlag(status, { ...g, ...fmt });

  const canvas = h('canvas', {
    role: 'img',
    'aria-label': `Gauge${config.title ? ` ${config.title}` : ''}: ${text}, on a scale of ${endText(g.min)} to ${endText(g.max)}`,
  });
  const dial = h('div', { class: 'gauge' },
    h('div', { class: 'gauge-canvas' }, canvas),
    h('p', { class: 'gauge-value', 'aria-hidden': 'true' }, text),
    h('span', { class: 'gauge-end gauge-min', 'aria-hidden': 'true' }, endText(g.min)),
    h('span', { class: 'gauge-end gauge-max', 'aria-hidden': 'true' }, endText(g.max)));
  // long values ("65.0%") get a smaller font so they stay inside the arc
  dial.style.setProperty('--gch', String(Math.max(text.length, 3)));
  const caption = `${AGGREGATIONS[b.agg]?.label || 'Sum'}${b.agg === 'count' ? ' of rows' : ` of ${b.yField}`} · ${source?.name || 'source'}`;
  body.append(...(flag ? [flag] : []), dial, h('p', { class: 'kpi-caption' }, caption));

  let placed = '';
  const chart = createGaugeChart(canvas, {
    fraction: gaugeFraction(value, g.min, g.max),
    tone: gaugeTone(value, g),
    color: config.color,
    // Chart.js decides where the arc sits; the text follows it on every resize
    onLayout: ({ x, y, inner, outer }) => {
      const key = `${x}|${y}|${inner}|${outer}`;
      if (key === placed) return;
      placed = key;
      dial.style.setProperty('--gx', `${x}px`);
      dial.style.setProperty('--gy', `${y}px`);
      dial.style.setProperty('--gr', `${inner}px`);
      dial.style.setProperty('--gm', `${(inner + outer) / 2}px`);
      dial.classList.add('is-placed');
    },
  });
  return () => chart.destroy();
}

// ------------------------------------------------------------
// Uptime strip: a row per service, a block per check
// ------------------------------------------------------------
function slotTitle(slot) {
  if (!slot) return 'No data';
  return slot.at ? `${slot.value} · ${new Date(slot.at).toLocaleString()}` : slot.value;
}

function stripRow(strip) {
  const latest = [...strip.slots].reverse().find(Boolean);
  const pct = uptimeText(strip.uptime);
  const summary = strip.filled
    ? `${strip.name}: ${pct} OK over the last ${strip.filled} check${strip.filled === 1 ? '' : 's'}, latest ${latest.value}`
    : `${strip.name}: no checks`;
  return h('li', { class: 'status-row' },
    h('span', { class: 'status-name', title: strip.name }, strip.name),
    h('span', { class: 'status-strip', role: 'img', 'aria-label': summary },
      strip.slots.map((slot, i) => h('span', {
        class: `status-slot${i === strip.slots.length - 1 ? ' is-latest' : ''}`,
        dataset: { tone: slot ? slot.tone : 'none' },
        title: slotTitle(slot),
      }))),
    h('span', {
      class: 'status-pct',
      dataset: { level: strip.uptime === null ? 'none' : strip.uptime >= 1 ? 'full' : 'part' },
      title: `${strip.ok} of ${strip.filled} checks OK`,
      'aria-hidden': 'true',
    }, pct));
}

export function renderStatus(body, widget, rows) {
  const { config } = widget;
  const s = normalizeStatusConfig(config);
  const [b] = config.bindings;
  const strips = statusStrips(rows, { xField: b.xField, yField: b.yField, timeField: s.timeField, slots: s.slots });
  if (!strips.length) {
    body.append(h('div', { class: 'widget-message is-empty' }, 'No services in these rows.'));
    return noop;
  }
  const list = h('ul', { class: 'status-list widget-nodrag', dataset: { slots: String(s.slots) } }, strips.map(stripRow));
  list.style.setProperty('--slots', String(s.slots));
  const more = h('button', { type: 'button', class: 'table-more widget-nodrag', hidden: true, title: 'Show every row' });
  body.append(list, more);
  return fitRows(list, more, { rows: '.status-row', head: '', noun: 'row' });
}
