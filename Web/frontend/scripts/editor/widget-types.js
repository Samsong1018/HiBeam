// ============================================================
// WIDGET REGISTRY
// What each component is, how big it drops in (48-column units),
// how many data bindings it takes, and its default settings.
//
// A binding is { sourceId, xField, yField, agg }. Line/bar can take
// several (one series each, possibly from different sources); pie,
// KPI, gauge, status and table take one; text and label take none.
// ============================================================

export const COLOR_TOKENS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
export const REFRESH_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 30, label: 'Every 30s' },
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 min' },
  { value: 900, label: 'Every 15 min' },
];

export const WIDGET_TYPES = {
  line: {
    label: 'Line chart',
    hint: 'Trends over time',
    icon: 'M3 17l5-6 4 3 6-8 3 3',
    size: { w: 16, h: 10 },
    min: { w: 6, h: 5 },
    maxBindings: 6,
    bindingFields: ['xField', 'yField', 'agg'],
    defaults: { title: 'Line chart', bindings: [], color: 'c1', smooth: true, fill: false, legend: true, reverseData: false, zeroBased: true, prefix: '', suffix: '', compact: false, bucket: 'none', thresholds: [], refresh: 0, quietAfter: 0, quietField: '' },
  },
  bar: {
    label: 'Bar chart',
    hint: 'Compare categories',
    icon: 'M5 20V11M10 20V5M15 20v-7M20 20V8',
    size: { w: 16, h: 10 },
    min: { w: 6, h: 5 },
    maxBindings: 6,
    bindingFields: ['xField', 'yField', 'agg'],
    defaults: { title: 'Bar chart', bindings: [], color: 'c1', horizontal: false, stacked: false, legend: true, zeroBased: true, prefix: '', suffix: '', compact: false, sort: 'none', topN: 0, bucket: 'none', refresh: 0, quietAfter: 0, quietField: '' },
  },
  pie: {
    label: 'Pie chart',
    hint: 'Share of a whole',
    icon: 'M12 3a9 9 0 1 0 9 9h-9z M14 2.5V10h7.5A8 8 0 0 0 14 2.5z',
    size: { w: 10, h: 10 },
    min: { w: 5, h: 5 },
    maxBindings: 1,
    bindingFields: ['xField', 'yField', 'agg'],
    defaults: { title: 'Pie chart', bindings: [], color: 'c1', donut: true, legend: true, topN: 0, refresh: 0, quietAfter: 0, quietField: '' },
  },
  kpi: {
    label: 'Number',
    hint: 'One big stat',
    icon: 'M4 7h3v10 M10 7h4l-4 10 M17 7h3v4h-3v6h3',
    size: { w: 10, h: 6 },
    min: { w: 5, h: 4 },
    maxBindings: 1,
    bindingFields: ['yField', 'agg'],
    defaults: { title: 'Total', bindings: [], color: 'c1', prefix: '', suffix: '', decimals: 0, reverseData: false, refresh: 0, warnAt: null, alertAt: null, higherIs: 'bad', showDelta: false, sparkline: false, quietAfter: 0, quietField: '' },
  },
  gauge: {
    label: 'Gauge',
    hint: 'Progress toward a limit',
    icon: 'M3.5 17a8.5 8.5 0 0 1 17 0 M12 17l4-5 M7 17h1.5 M15.5 17H17',
    size: { w: 10, h: 8 },
    min: { w: 5, h: 5 },
    maxBindings: 1,
    bindingFields: ['yField', 'agg'],
    defaults: { title: 'Gauge', bindings: [], color: 'c1', min: 0, max: 100, prefix: '', suffix: '', decimals: 0, reverseData: false, refresh: 0, warnAt: null, alertAt: null, higherIs: 'bad', quietAfter: 0, quietField: '' },
  },
  status: {
    label: 'Uptime strip',
    hint: 'Up / down over time per service',
    icon: 'M3 7h3 M3 12h3 M3 17h3 M9 6v2 M12 6v2 M15 6v2 M18 6v2 M21 6v2 M9 11v2 M12 11v2 M15 11v2 M18 11v2 M21 11v2 M9 16v2 M12 16v2 M15 16v2 M18 16v2 M21 16v2',
    size: { w: 18, h: 8 },
    min: { w: 6, h: 4 },
    maxBindings: 1,
    bindingFields: ['xField', 'yField'],
    defaults: { title: 'Uptime', bindings: [], slots: 30, timeField: '', reverseData: false, refresh: 0, quietAfter: 0, quietField: '' },
  },
  table: {
    label: 'Table',
    hint: 'Raw rows',
    icon: 'M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14',
    size: { w: 18, h: 10 },
    min: { w: 6, h: 4 },
    maxBindings: 1,
    bindingFields: [],
    defaults: { title: 'Table', bindings: [], columns: [], limit: 50, refresh: 0, quietAfter: 0, quietField: '' },
  },
  text: {
    label: 'Text box',
    hint: 'Notes and context',
    icon: 'M4 6h16 M4 10h16 M4 14h11 M4 18h8',
    size: { w: 12, h: 6 },
    min: { w: 3, h: 2 },
    maxBindings: 0,
    bindingFields: [],
    defaults: { title: '', body: 'Add some context for this dashboard.', fontSize: 'md' },
  },
  label: {
    label: 'Label',
    hint: 'Headings, section titles',
    icon: 'M6 5v14 M18 5v14 M6 12h12',
    size: { w: 14, h: 3 },
    min: { w: 2, h: 1 },
    maxBindings: 0,
    bindingFields: [],
    defaults: { text: 'Section title', size: 'lg', align: 'left', muted: false },
  },
};

export const PALETTE_ORDER = ['line', 'bar', 'pie', 'kpi', 'gauge', 'status', 'table', 'text', 'label'];

export function isDataWidget(type) {
  return (WIDGET_TYPES[type]?.maxBindings || 0) > 0;
}

export function iconSvg(type, size = 20) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', WIDGET_TYPES[type]?.icon || '');
  svg.append(path);
  return svg;
}
