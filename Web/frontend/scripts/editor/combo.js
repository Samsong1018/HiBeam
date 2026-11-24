// ============================================================
// COMBO CHARTS
// Pure helpers, no DOM (covered by tests/combo-chart.test.mjs).
// A bar chart with two or more series can draw some of them as a line,
// e.g. actual as bars and budget as a line. Only charts.js reads this;
// the data pipeline (sort, top N, time buckets) never looks at `as`.
// ============================================================

export const SERIES_KINDS = ['bar', 'line'];

/** The binding's `as` worth keeping: 'line' on a bar widget, else nothing. */
export function normalizeSeriesKind(type, as) {
  return type === 'bar' && as === 'line' ? 'line' : undefined;
}

/**
 * Whether a widget's series can each pick bars or a line: a vertical bar
 * chart with more than one series.
 */
export function comboAllowed(widget) {
  const bindings = widget?.config?.bindings;
  return widget?.type === 'bar' && !widget.config.horizontal && Array.isArray(bindings) && bindings.length > 1;
}

/** How series `index` of `count` draws: 'bar' or 'line'. */
export function seriesKind(widget, index, count) {
  if (widget?.type !== 'bar' || widget.config?.horizontal || count < 2) return 'bar';
  return widget.config.bindings?.[index]?.as === 'line' ? 'line' : 'bar';
}

/**
 * Chart.js dataset options that set a combo line apart from the bars:
 * {} for a bar. A line draws on top (lower order), never fills, and gets a
 * stack of its own so stacked bars don't pile it onto themselves.
 */
export function comboDatasetOptions(widget, index, count) {
  if (seriesKind(widget, index, count) !== 'line') return {};
  return {
    type: 'line',
    order: 0,
    stack: `line-${index}`,
    fill: false,
    tension: 0,
    borderWidth: 2,
    pointRadius: 2.5,
    pointHoverRadius: 4,
    spanGaps: true,
  };
}

/** Bars sit under any combo line. */
export const BAR_ORDER = 1;
