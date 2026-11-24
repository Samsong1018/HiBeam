// ============================================================
// CHART.JS ADAPTER
// Turns a widget + merged series into a Chart instance styled from the
// page's CSS tokens, so charts follow light/dark mode.
// Chart is the global from the chart.js UMD bundle in edit.html.
// ============================================================

import { COLOR_TOKENS } from './widget-types.js';
import { axisTones, TONE_TOKENS } from './semantic.js';

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
    scales: { x: { ...axis }, y: { ...axis, beginAtZero: true } },
  };
}

// Labels like dead/alive or HTTP 200/503 get ok/warn/danger colours instead of
// palette order, so "dead" is never the friendly colour. null = not semantic.
function toneColors(widget, labels) {
  const tones = axisTones(labels, widget.config.bindings[0]?.xField || '');
  return tones && tones.map((t) => token(TONE_TOKENS[t]));
}

// data: { labels, series: [{ label, values }] }
export function createChart(canvas, widget, data) {
  const { type, config } = widget;
  const colors = seriesColors(config.color, Math.max(data.series.length, data.labels.length));
  const multi = data.series.length > 1;
  const tones = type !== 'line' && !multi ? toneColors(widget, data.labels) : null;

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
          backgroundColor: tones || data.labels.map((_, i) => colors[i % colors.length]),
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
    if (config.horizontal) {
      options.scales.x.beginAtZero = true;
      delete options.scales.y.beginAtZero;
    }
  }

  return new Chart(canvas, {
    type,
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
          pointRadius: 0,
          pointHoverRadius: 4,
          spanGaps: true,
        }
        : {
          label: s.label,
          data: s.values,
          backgroundColor: tones || colors[i],
          borderRadius: 3,
          maxBarThickness: 48,
        })),
    },
    options,
  });
}
