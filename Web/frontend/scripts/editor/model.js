// ============================================================
// DASHBOARD MODEL
// Pure functions over the dashboard document. Each returns a new object
// (or the same one when nothing changed, so the store can skip a commit).
//
// {
//   name: string,                 // (the id lives in autosave.js, not here)
//   grid: { columns, showGrid },
//   widgets: [{ id, type, x, y, w, h, config }]
// }
// ============================================================

import { WIDGET_TYPES, COLOR_TOKENS, REFRESH_OPTIONS } from './widget-types.js';
import { scaleLayout, TIME_BUCKETS, normalizeThresholds } from './data.js';
import { normalizeKpiConfig } from './kpi.js';
import { normalizeQuietConfig } from './quiet.js';
import { normalizeGaugeConfig } from './gauge.js';
import { normalizeStatusConfig } from './status-strip.js';
import { normalizeSeriesKind } from './combo.js';

export const COLUMN_OPTIONS = [
  { value: 24, label: 'Coarse · 24' },
  { value: 48, label: 'Medium · 48' },
  { value: 72, label: 'Fine · 72' },
  { value: 96, label: 'Very fine · 96' },
];
const MAX_NAME = 80;
const MAX_TEXT = 4000;
const MAX_WIDGETS = 200;
export const BOARD_THEMES = [
  { value: '', label: 'Viewer\'s choice' },
  { value: 'kiroween', label: 'Kiroween' },
];

export function newDashboard() {
  return { name: 'Untitled dashboard', grid: { columns: 48, showGrid: true }, widgets: [] };
}

export function setName(dash, name) {
  const clean = String(name).slice(0, MAX_NAME);
  return clean === dash.name ? dash : { ...dash, name: clean };
}

export function setGrid(dash, patch) {
  const next = { ...dash.grid, ...patch };
  const widgets = patch.columns && patch.columns !== dash.grid.columns
    ? scaleLayout(dash.widgets, dash.grid.columns, patch.columns)
    : dash.widgets;
  return { ...dash, grid: next, widgets };
}

// '' clears it: the board follows each viewer's light/dark setting
export function setTheme(dash, theme) {
  const valid = BOARD_THEMES.some((t) => t.value === theme && t.value);
  if (!valid) {
    if (!('theme' in dash)) return dash;
    const { theme: _drop, ...rest } = dash;
    return rest;
  }
  return dash.theme === theme ? dash : { ...dash, theme };
}

export function addWidget(dash, widget) {
  if (dash.widgets.length >= MAX_WIDGETS) return dash;
  return { ...dash, widgets: [...dash.widgets, widget] };
}

export function removeWidget(dash, id) {
  return { ...dash, widgets: dash.widgets.filter((w) => w.id !== id) };
}

export function updateConfig(dash, id, patch) {
  return {
    ...dash,
    widgets: dash.widgets.map((w) => (w.id === id ? { ...w, config: { ...w.config, ...patch } } : w)),
  };
}

// layout: { [id]: { x, y, w, h } } from gridstack. Unchanged → same object.
export function applyLayout(dash, layout) {
  let changed = false;
  const widgets = dash.widgets.map((w) => {
    const pos = layout[w.id];
    if (!pos || (pos.x === w.x && pos.y === w.y && pos.w === w.w && pos.h === w.h)) return w;
    changed = true;
    return { ...w, x: pos.x, y: pos.y, w: pos.w, h: pos.h };
  });
  return changed ? { ...dash, widgets } : dash;
}

export function duplicateWidget(dash, id, newId) {
  const original = dash.widgets.find((w) => w.id === id);
  if (!original) return dash;
  const copy = { ...original, id: newId, y: original.y + original.h, config: structuredClone(original.config) };
  return addWidget(dash, copy);
}

// ------------------------------------------------------------
// Loading: whatever comes back from the server is untrusted.
// Drop unknown widget types, clamp numbers, cap strings.
// ------------------------------------------------------------
const int = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

// `as` (bar charts only) is kept only when it's 'line': bars are the default,
// so boards saved before combo charts normalize exactly as they did.
function normalizeBinding(b, type) {
  const out = {
    sourceId: str(b?.sourceId, 64),
    xField: str(b?.xField, 120),
    yField: str(b?.yField, 120),
    agg: str(b?.agg, 10) || 'sum',
  };
  const as = normalizeSeriesKind(type, b?.as);
  return as ? { ...out, as } : out;
}

// Axis, unit and ordering settings on line/bar/pie. Only keys the type has
// in its defaults are touched; anything off-menu falls back to the default.
export const BAR_SORTS = ['none', 'desc', 'asc'];
export const MAX_TOP_N = 50;
const MAX_UNIT = 8;

export function normalizeChartConfig(config, defaults) {
  const out = {};
  if ('zeroBased' in defaults) out.zeroBased = typeof config.zeroBased === 'boolean' ? config.zeroBased : defaults.zeroBased;
  if ('prefix' in defaults) out.prefix = str(config.prefix, MAX_UNIT);
  if ('suffix' in defaults) out.suffix = str(config.suffix, MAX_UNIT);
  if ('compact' in defaults) out.compact = config.compact === true;
  if ('sort' in defaults) out.sort = BAR_SORTS.includes(config.sort) ? config.sort : 'none';
  if ('topN' in defaults) {
    const n = config.topN;
    out.topN = Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_TOP_N) : 0;
  }
  if ('bucket' in defaults) out.bucket = TIME_BUCKETS.includes(config.bucket) ? config.bucket : 'none';
  if ('thresholds' in defaults) out.thresholds = normalizeThresholds(config.thresholds);
  return out;
}

function normalizeWidget(raw, columns) {
  const def = WIDGET_TYPES[raw?.type];
  if (!def) return null;
  const config = { ...structuredClone(def.defaults), ...(raw.config || {}) };
  config.bindings = (Array.isArray(config.bindings) ? config.bindings : []).slice(0, def.maxBindings).map((b) => normalizeBinding(b, raw.type));
  if ('title' in config) config.title = str(config.title, MAX_NAME);
  if ('body' in config) config.body = str(config.body, MAX_TEXT);
  if ('text' in config) config.text = str(config.text, MAX_NAME);
  // only the intervals the editor offers; anything else (0.01, '5', NaN) means off
  if ('refresh' in config && !REFRESH_OPTIONS.some((o) => o.value === config.refresh)) config.refresh = 0;
  if (raw.type === 'kpi') Object.assign(config, normalizeKpiConfig(config));
  if (raw.type === 'gauge') Object.assign(config, normalizeGaugeConfig(config));
  if (raw.type === 'status') Object.assign(config, normalizeStatusConfig(config));
  if (['line', 'bar', 'pie'].includes(raw.type)) Object.assign(config, normalizeChartConfig(config, def.defaults));
  if ('quietAfter' in def.defaults) Object.assign(config, normalizeQuietConfig(config));
  else { delete config.quietAfter; delete config.quietField; }
  if ('color' in config && !COLOR_TOKENS.includes(config.color) && !/^#[0-9a-f]{6}$/i.test(config.color)) config.color = 'c1';
  const w = int(raw.w, 1, columns, def.size.w);
  return {
    id: str(raw.id, 64) || `w_${Math.random().toString(36).slice(2, 10)}`,
    type: raw.type,
    x: int(raw.x, 0, columns - w, 0),
    y: int(raw.y, 0, 10000, 0),
    w,
    h: int(raw.h, 1, 1000, def.size.h),
    config,
  };
}

export function normalizeDashboard(raw) {
  const base = newDashboard();
  const columns = [24, 48, 72, 96].includes(raw?.grid?.columns) ? raw.grid.columns : base.grid.columns;
  const dash = {
    name: str(raw?.name, MAX_NAME) || base.name,
    grid: { columns, showGrid: raw?.grid?.showGrid !== false },
    widgets: (Array.isArray(raw?.widgets) ? raw.widgets : [])
      .slice(0, MAX_WIDGETS)
      .map((w) => normalizeWidget(w, columns))
      .filter(Boolean),
  };
  return setTheme(dash, raw?.theme);
}
