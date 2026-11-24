// ============================================================
// CHART.JS ADAPTER
// Turns a widget + merged series into a Chart instance styled from the
// page's CSS tokens, so charts follow light/dark mode.
// Chart is the global from the chart.js UMD bundle in edit.html.
// ============================================================

import { COLOR_TOKENS } from './widget-types.js';
import { axisTones, TONE_TOKENS } from './semantic.js';
import { formatAxisValue, normalizeThresholds, thresholdBounds } from './data.js';
import { comboDatasetOptions, BAR_ORDER } from './combo.js';

const root = document.documentElement;
const token = (name) => getComputedStyle(root).getPropertyValue(name).trim();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function withAlpha(color, alpha) {
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
  if (/^hsla?\(/i.test(color) && !color.includes('/')) return color.replace(/\)\s*$/, ` / ${alpha})`);
  return color;
}

// The widget's colour first, then the rest of the palette in order.
export function seriesColors(color, count) {
  const palette = COLOR_TOKENS.map((t) => token(`--chart-${t}`));
  const start = COLOR_TOKENS.indexOf(color);
  const ordered = start >= 0
    ? [...palette.slice(start), ...palette.slice(0, start)]
    : [color, ...palette];
  return Array.from({ length: count }, (_, i) => ordered[i % ordered.length]);
}

function baseOptions(config, showLegend) {
  const muted = token('--color-text-muted');
  const grid = token('--color-border');
  const font = { family: token('--font-mono') || 'monospace', size: 11 };
  const axis = { grid: { color: grid }, border: { color: grid }, ticks: { color: muted, font, maxRotation: 0, autoSkip: true } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion.matches ? false : { duration: 350 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: showLegend, position: 'bottom', labels: { color: muted, font, boxWidth: 10, boxHeight: 10 } },
      tooltip: { titleFont: font, bodyFont: font },
    },
    scales: { x: { ...axis }, y: { ...axis } },
  };
}

// Line/bar value axis: zero baseline (on unless the widget turns it off) and,
// when the widget has units, formatted ticks and tooltips. Without units the
// Chart.js defaults stay, so older boards look exactly as they did.
function applyValueAxis(options, config, valueAxis) {
  const scale = options.scales[valueAxis];
  scale.beginAtZero = config.zeroBased !== false;
  const units = { prefix: config.prefix || '', suffix: config.suffix || '', compact: config.compact === true };
  if (!units.prefix && !units.suffix && !units.compact) return;
  scale.ticks = { ...scale.ticks, callback: (value) => formatAxisValue(value, units) };
  options.plugins.tooltip.callbacks = {
    label: (ctx) => {
      const value = formatAxisValue(ctx.parsed[valueAxis], units);
      return ctx.dataset.label ? `${ctx.dataset.label}: ${value}` : value;
    },
  };
}

// Line chart reference lines: a dashed rule per threshold with its label at
// the right end, coloured by tone. Colours are read from the tokens at draw
// time; a theme change re-renders the widget, so they follow it.
const LABEL_GAP = 3;

function thresholdPlugin(thresholds, units) {
  return {
    id: 'hibeamThresholds',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea: area, scales } = chart;
      const y = scales?.y;
      if (!y || !area) return;
      const family = token('--font-mono') || 'monospace';
      const surface = token('--color-surface');
      ctx.save();
      ctx.font = `600 10px ${family}`;
      ctx.textAlign = 'right';
      thresholds.forEach((t) => {
        const py = Math.round(y.getPixelForValue(t.value)) + 0.5;
        if (!Number.isFinite(py) || py < area.top - 1 || py > area.bottom + 1) return;
        const color = token(TONE_TOKENS[t.tone] || TONE_TOKENS.warn);
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(area.left, py);
        ctx.lineTo(area.right, py);
        ctx.stroke();

        const text = t.label || formatAxisValue(t.value, units);
        const width = ctx.measureText(text).width;
        // above the line, or below it when it hugs the top of the plot
        const above = py - area.top > 14;
        const textY = above ? py - LABEL_GAP : py + LABEL_GAP;
        ctx.textBaseline = above ? 'bottom' : 'top';
        ctx.setLineDash([]);
        ctx.fillStyle = withAlpha(surface, 0.82);
        ctx.fillRect(area.right - width - 6, above ? textY - 11 : textY - 1, width + 6, 12);
        ctx.fillStyle = color;
        ctx.fillText(text, area.right - 3, textY);
      });
      ctx.restore();
    },
  };
}

// Labels like dead/alive or HTTP 200/503 get ok/warn/danger colours instead of
// palette order, so "dead" is never the friendly colour. null = not semantic.
function toneColors(widget, labels, otherIndex = -1) {
  // the folded "Other" pie slice has no meaning of its own: tone the rest, grey it
  if (otherIndex >= 0) {
    const rest = toneColors(widget, labels.filter((_, i) => i !== otherIndex));
    return rest && [...rest.slice(0, otherIndex), otherColor(), ...rest.slice(otherIndex)];
  }
  const tones = axisTones(labels, widget.config.bindings[0]?.xField || '');
  return tones && tones.map((t) => token(TONE_TOKENS[t]));
}

const otherColor = () => withAlpha(token('--color-text-muted'), 0.45);

// A point with no neighbours (gaps on both sides) draws no line segment, so
// give it a dot or it vanishes.
function isolatedRadius(ctx) {
  const values = ctx.dataset.data;
  const i = ctx.dataIndex;
  const has = (j) => values[j] !== null && values[j] !== undefined;
  return has(i) && !has(i - 1) && !has(i + 1) ? 2.5 : 0;
}

// A bar series, or (combo chart) a series drawn as a line over the bars.
function barDataset(widget, s, i, data, fillColor, color) {
  const combo = comboDatasetOptions(widget, i, data.series.length);
  if (combo.type === 'line') {
    return {
      label: s.label,
      data: s.values,
      ...combo,
      borderColor: color,
      backgroundColor: color,
      pointBackgroundColor: color,
      // a bucketed axis has a slot for every minute/hour/day: a null there is a silence
      spanGaps: !data.bucketed,
    };
  }
  return {
    label: s.label,
    data: s.values,
    order: BAR_ORDER,
    backgroundColor: fillColor,
    borderRadius: 3,
    maxBarThickness: 48,
  };
}

// data: { labels, series: [{ label, values }], otherIndex?, bucketed? }
// (otherIndex: pie's folded slice; bucketed: a time-bucket axis whose nulls are real gaps)
export function createChart(canvas, widget, data) {
  const { type, config } = widget;
  const colors = seriesColors(config.color, Math.max(data.series.length, data.labels.length));
  const multi = data.series.length > 1;
  const otherIndex = type === 'pie' && Number.isInteger(data.otherIndex) ? data.otherIndex : -1;
  const tones = type !== 'line' && !multi ? toneColors(widget, data.labels, otherIndex) : null;

  if (type === 'pie') {
    const options = baseOptions(config, config.legend);
    delete options.scales;
    options.interaction = { mode: 'nearest', intersect: true };
    return new Chart(canvas, {
      type: config.donut ? 'doughnut' : 'pie',
      data: {
        labels: data.labels,
        datasets: [{
          data: data.series[0]?.values || [],
          backgroundColor: tones || data.labels.map((_, i) => (i === otherIndex ? otherColor() : colors[i % colors.length])),
          borderColor: token('--color-surface'),
          borderWidth: 2,
        }],
      },
      options,
    });
  }

  const options = baseOptions(config, config.legend && multi);
  // time axes: dense "05:03 05:06" labels need real gaps or they run together.
  // Bars keep the default so every category stays labelled when it fits.
  if (type === 'line') options.scales.x.ticks = { ...options.scales.x.ticks, autoSkipPadding: 18 }; // x and y share one ticks object
  if (type === 'bar') {
    // every bar is a category and needs its name: tilt crowded labels instead of dropping them
    if (!config.horizontal) options.scales.x.ticks = { ...options.scales.x.ticks, maxRotation: 40 };
    options.indexAxis = config.horizontal ? 'y' : 'x';
    options.scales.x.stacked = Boolean(config.stacked);
    options.scales.y.stacked = Boolean(config.stacked);
  }
  applyValueAxis(options, config, type === 'bar' && config.horizontal ? 'x' : 'y');
  const thresholds = type === 'line' ? normalizeThresholds(config.thresholds) : [];
  const bounds = thresholdBounds(thresholds);
  if (bounds) Object.assign(options.scales.y, bounds);
  const units = { prefix: config.prefix || '', suffix: config.suffix || '', compact: config.compact === true };

  return new Chart(canvas, {
    type,
    plugins: thresholds.length ? [thresholdPlugin(thresholds, units)] : [],
    data: {
      labels: data.labels,
      datasets: data.series.map((s, i) => (type === 'line'
        ? {
          label: s.label,
          data: s.values,
          borderColor: colors[i],
          backgroundColor: withAlpha(colors[i], 0.14),
          fill: Boolean(config.fill),
          tension: config.smooth ? 0.35 : 0,
          borderWidth: 2,
          pointRadius: data.bucketed ? isolatedRadius : 0,
          pointHoverRadius: 4,
          // a bucketed axis has a slot for every minute/hour/day: a null there is a silence, so show it
          spanGaps: !data.bucketed,
        }
        : barDataset(widget, s, i, data, tones || colors[i], colors[i]))),
    },
    options,
  });
}

// ------------------------------------------------------------
// Gauge: a half-donut, filled to `fraction` (0..1, or null for an empty
// track) in the tone's colour. `onLayout({ x, y, inner, outer })` reports
// where the arc sits after every draw, so the DOM value text can sit in
// its bowl. Colours come from the tokens; a theme change re-renders.
// ------------------------------------------------------------
const GAUGE_LABEL_ROOM = 18; // px under the arc for the min / max labels

export function createGaugeChart(canvas, { fraction, tone, color, onLayout }) {
  const fill = tone && TONE_TOKENS[tone]
    ? token(TONE_TOKENS[tone])
    : (/^#[0-9a-f]{6}$/i.test(color) ? color : token(`--chart-${COLOR_TOKENS.includes(color) ? color : 'c1'}`));
  const track = withAlpha(token('--color-text-muted'), 0.2);
  const f = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0;
  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [f, 1 - f],
        backgroundColor: [fill, track],
        borderWidth: 0,
        borderRadius: 0,
        hoverOffset: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      circumference: 180,
      rotation: -90,
      cutout: '75%',
      animation: reducedMotion.matches ? false : { duration: 450 },
      events: [],
      layout: { padding: { top: 4, left: 4, right: 4, bottom: GAUGE_LABEL_ROOM } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
    plugins: [{
      id: 'hibeamGaugeLayout',
      afterDraw(chart) {
        const arc = chart.getDatasetMeta(0)?.data?.[0];
        if (arc && onLayout) onLayout({ x: arc.x, y: arc.y, inner: arc.innerRadius, outer: arc.outerRadius });
      },
    }],
  });
}
