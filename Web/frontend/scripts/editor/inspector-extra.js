// ============================================================
// INSPECTOR · Gauge and Uptime strip settings
// Kept out of inspector.js so that file stays readable. Builds the
// per-type sections from the form helpers inspector.js hands in.
// ============================================================

import { h } from './dom.js';
import { SLOT_OPTIONS } from './status-strip.js';
import { GAUGE_DEFAULT_MIN, GAUGE_DEFAULT_MAX } from './gauge.js';
import { isToneColumn } from './semantic.js';
import { findTimeField } from './quiet.js';

const LABELS = {
  pie: { x: 'Slices by', y: 'Size' },
  status: { x: 'Service', y: 'Status' },
};

/** Field labels in the binding row: { x, y } */
export function bindingLabels(type) {
  return LABELS[type] || { x: 'X axis', y: 'Value' };
}

/** The uptime strip's "value" is a status word or code, not a number. */
export function yTakesAnyField(type) {
  return type === 'status';
}

/**
 * Binding fields to start from when a source is picked, on top of the
 * generic first-text / first-number guess. A gauge shows a level, so it
 * starts on Latest (never a sum of percentages).
 */
export function pickDefaults(type, fields) {
  if (type === 'gauge') return { agg: 'last' };
  if (type !== 'status') return {};
  const status = fields.find((f) => isToneColumn(f.name))?.name || '';
  const name = fields.find((f) => f.type === 'string' && f.name !== status)?.name
    || fields.find((f) => f.name !== status)?.name || '';
  return { xField: name, yField: status || fields.find((f) => f.name !== name)?.name || '' };
}

/** Uptime strip: fill in the time column from the new source's rows. */
export async function afterPickSource(type, sourceId, { registry, patch }) {
  if (type !== 'status' || !sourceId) return;
  const rows = await registry.rows(sourceId).catch(() => []);
  patch({ timeField: findTimeField(rows) });
}

// ------------------------------------------------------------
// Per-type sections
// ------------------------------------------------------------
function gaugeSections(ui) {
  const { section, field, textField, selectField, numberField, toggle, swatches, fieldId, patch, selected } = ui;

  // empty = back to the default end; the render normalizes, so a half-typed range never breaks the arc
  const rangeField = (label, key, fallback) => {
    const current = selected().config[key];
    return field(label, h('input', {
      id: fieldId(key), type: 'number', step: 'any', inputmode: 'decimal', placeholder: String(fallback),
      value: Number.isFinite(current) ? String(current) : '',
      oninput: (e) => {
        const raw = e.target.value.trim();
        const n = Number(raw);
        if (raw === '') patch({ [key]: null }, key);
        else if (Number.isFinite(n)) patch({ [key]: n }, key);
      },
    }));
  };

  return [
    section('Appearance', swatches(),
      h('p', { class: 'field-hint' }, 'The arc uses this colour until a threshold below is set; then it goes green, amber or red.')),
    section('Range',
      h('div', { class: 'field-row' }, rangeField('Min', 'min', GAUGE_DEFAULT_MIN), rangeField('Max', 'max', GAUGE_DEFAULT_MAX)),
      h('p', { class: 'field-hint' }, 'The arc fills from min to max. A value past either end fills it to that end, and the number still shows the real value. If max isn\'t above min, 0 to 100 is used.')),
    section('Format',
      h('div', { class: 'field-row' }, textField('Prefix', 'prefix', { max: 8, placeholder: '$' }), textField('Suffix', 'suffix', { max: 8, placeholder: '%' })),
      selectField('Decimals', 'decimals', [0, 1, 2, 3].map((n) => ({ value: n, label: String(n) })), { numeric: true }),
      h('div', { class: 'check-list' }, toggle('Rows are newest first', 'reverseData'))),
    section('Alerts',
      h('div', { class: 'field-row' }, numberField('Warn at', 'warnAt'), numberField('Alert at', 'alertAt')),
      selectField('Higher is', 'higherIs', [{ value: 'bad', label: 'Bad (CPU, disk, spend)' }, { value: 'good', label: 'Good (savings, uptime)' }]),
      h('p', { class: 'field-hint' }, 'Same rules as a Number: reaching a threshold trips it. Leave a box empty to turn that level off.')),
  ];
}

function timeColumnField(widget, ui) {
  const { field, fieldId, patch, registry } = ui;
  const [binding] = widget.config.bindings;
  if (!binding?.sourceId) return null;
  const slot = h('div', {}, h('p', { class: 'field-hint' }, 'Loading columns…'));
  registry.fields(binding.sourceId).then((fields) => {
    slot.replaceChildren(field('Time column', h('select', {
      id: fieldId('timeField'), value: widget.config.timeField || '',
      onchange: (e) => patch({ timeField: e.target.value }),
    },
    h('option', { value: '' }, 'None (row order)'),
    fields.map((f) => h('option', { value: f.name }, f.name))),
    'Rows are put in time order and each service shows its newest checks. Rows whose time doesn\'t parse are left out.'));
  }, () => slot.replaceChildren(h('p', { class: 'field-error' }, 'Couldn\'t load columns.')));
  return slot;
}

function statusSections(widget, ui) {
  const { section, selectField, toggle } = ui;
  return [
    section('Strip',
      selectField('Checks shown', 'slots', SLOT_OPTIONS.map((n) => ({ value: n, label: `Last ${n}` })), { numeric: true }),
      timeColumnField(widget, ui),
      h('div', { class: 'check-list' }, toggle('Rows are newest first', 'reverseData')),
      h('p', { class: 'field-hint' }, 'A row per service. Each block is one check, coloured by what the status means (up, degraded, down, HTTP codes). Grey means no data. The % counts OK checks out of the ones with data.')),
  ];
}

/**
 * Settings sections for the types this module owns, or null for any other.
 * `ui` is the inspector's form kit: section, field, textField, selectField,
 * numberField, toggle, swatches, fieldId, patch, selected, registry.
 */
export function extraSections(widget, ui) {
  if (widget.type === 'gauge') return gaugeSections(ui);
  if (widget.type === 'status') return statusSections(widget, ui);
  return null;
}
