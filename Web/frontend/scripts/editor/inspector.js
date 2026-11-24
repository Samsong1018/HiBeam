// ============================================================
// INSPECTOR (right panel)
// Nothing selected → dashboard settings. Widget selected → its settings.
// Edits commit with origin 'inspector' so the panel doesn't rebuild itself
// mid-typing; undo/redo (origin 'history') does rebuild it.
// ============================================================

import { h, clear, uid } from './dom.js';
import { WIDGET_TYPES, COLOR_TOKENS, REFRESH_OPTIONS, iconSvg, isDataWidget } from './widget-types.js';
import { AGGREGATIONS } from './data.js';
import { QUIET_OPTIONS, findTimeField } from './quiet.js';
import { COLUMN_OPTIONS, BOARD_THEMES, setGrid, setTheme, updateConfig, removeWidget, duplicateWidget } from './model.js';

const NEW_SOURCE = '__new__';
const EMPTY_BINDING = { sourceId: '', xField: '', yField: '', agg: 'sum' };

export function createInspector({ el, store, registry, onSelect, openSourceDialog }) {
  let selectedId = null;

  const selected = () => store.get().widgets.find((w) => w.id === selectedId) || null;
  const commit = (fn, coalesce) => store.update(fn, { origin: 'inspector', coalesce });
  const patch = (values, coalesce) => commit((d) => updateConfig(d, selectedId, values), coalesce && `${selectedId}:${coalesce}`);

  // ----------------------------------------------------------
  // Small form builders
  // ----------------------------------------------------------
  const fieldId = (key) => `insp-${key}`;

  function field(label, control, hint) {
    return h('div', { class: 'field' },
      h('label', { for: control.id }, label),
      control,
      hint && h('p', { class: 'field-hint' }, hint));
  }

  function textField(label, key, { max = 80, multiline = false, placeholder } = {}) {
    const config = selected().config;
    const control = h(multiline ? 'textarea' : 'input', {
      id: fieldId(key), type: multiline ? undefined : 'text', maxlength: String(max), placeholder, value: config[key] ?? '',
      rows: multiline ? '5' : undefined,
      oninput: (e) => patch({ [key]: e.target.value.slice(0, max) }, key),
    });
    return field(label, control);
  }

  function selectField(label, key, options, { numeric = false } = {}) {
    const control = h('select', {
      id: fieldId(key), value: String(selected().config[key]),
      onchange: (e) => patch({ [key]: numeric ? Number(e.target.value) : e.target.value }),
    }, options.map((o) => h('option', { value: String(o.value) }, o.label)));
    return field(label, control);
  }

  function toggle(label, key) {
    return h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: Boolean(selected().config[key]), onchange: (e) => patch({ [key]: e.target.checked }) }),
      h('span', {}, label));
  }

  // empty input = threshold off (null); anything else must be a finite number
  function numberField(label, key, hint) {
    const current = selected().config[key];
    const control = h('input', {
      id: fieldId(key), type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'Off',
      value: current === null || current === undefined ? '' : String(current),
      oninput: (e) => {
        const raw = e.target.value.trim();
        const n = Number(raw);
        if (raw === '') patch({ [key]: null }, key);
        else if (Number.isFinite(n)) patch({ [key]: n }, key);
      },
    });
    return field(label, control, hint);
  }

  function kpiAlerts() {
    return section('Alerts',
      h('div', { class: 'field-row' }, numberField('Warn at', 'warnAt'), numberField('Alert at', 'alertAt')),
      selectField('Higher is', 'higherIs', [{ value: 'bad', label: 'Bad (CPU, spending)' }, { value: 'good', label: 'Good (savings, uptime)' }]),
      h('div', { class: 'check-list' }, toggle('Show change since previous row', 'showDelta')),
      h('p', { class: 'field-hint' }, 'The number turns amber or red once it crosses a threshold. Leave a box empty to turn that level off.'));
  }

  function swatches() {
    const current = selected().config.color;
    const custom = /^#/.test(current) ? current : '#888888';
    return h('fieldset', { class: 'field' },
      h('legend', { class: 'field-label' }, 'Color'),
      h('div', { class: 'swatches' },
        COLOR_TOKENS.map((t) => h('button', {
          type: 'button', class: 'swatch', style: `--swatch: var(--chart-${t})`,
          'aria-label': `Palette color ${t.slice(1)}`, 'aria-pressed': String(current === t),
          onclick: () => { patch({ color: t }); render(); },
        })),
        h('label', { class: 'swatch swatch-custom', 'aria-pressed': String(/^#/.test(current)), title: 'Custom color', style: `--swatch: ${custom}` },
          h('span', { class: 'visually-hidden' }, 'Custom color'),
          h('input', { type: 'color', value: custom, onchange: (e) => { patch({ color: e.target.value }); render(); } }))));
  }

  // ----------------------------------------------------------
  // Data bindings
  // ----------------------------------------------------------
  function setBinding(index, next) {
    const current = selected().config.bindings;
    const list = current.length ? current : [EMPTY_BINDING];
    patch({ bindings: list.map((b, i) => (i === index ? next : b)) });
  }

  async function pickSource(index, binding, sourceId) {
    if (sourceId === NEW_SOURCE) {
      const created = await openSourceDialog();
      if (!created) { render(); return; }
      sourceId = created.id;
    }
    const fields = sourceId ? await registry.fields(sourceId).catch(() => []) : [];
    const firstText = fields.find((f) => f.type === 'string')?.name || fields[0]?.name || '';
    const firstNum = fields.find((f) => f.type === 'number')?.name || '';
    setBinding(index, { ...binding, sourceId, xField: firstText, yField: firstNum });
    render();
  }

  function fieldSelect(label, value, fields, onchange, id) {
    return field(label, h('select', { id, value, onchange: (e) => onchange(e.target.value) },
      h('option', { value: '' }, fields ? '— choose —' : 'Loading…'),
      (fields || []).map((f) => h('option', { value: f.name }, `${f.name}${f.type === 'number' ? ' · #' : ''}`))));
  }

  function bindingRow(widget, binding, index, total) {
    const def = WIDGET_TYPES[widget.type];
    const sources = registry.list();
    const row = h('div', { class: 'binding' });
    const sourceSelect = h('select', {
      id: fieldId(`src-${index}`), value: binding.sourceId,
      onchange: (e) => pickSource(index, binding, e.target.value),
    },
    h('option', { value: '' }, sources.length ? '— choose a source —' : 'No sources yet'),
    sources.map((s) => h('option', { value: s.id }, s.name)),
    h('option', { value: NEW_SOURCE }, '+ Connect a new source…'));

    row.append(h('div', { class: 'binding-head' },
      h('span', { class: 'binding-num' }, def.maxBindings > 1 ? `Series ${index + 1}` : 'Data'),
      total > 1 && h('button', {
        type: 'button', class: 'binding-remove', 'aria-label': `Remove series ${index + 1}`,
        onclick: () => { patch({ bindings: widget.config.bindings.filter((_, i) => i !== index) }); render(); },
      }, 'Remove')),
    field('Source', sourceSelect));

    if (!binding.sourceId || !def.bindingFields.length) return row;

    const slot = h('div', { class: 'binding-fields' });
    row.append(slot);
    const fill = (fields) => {
      clear(slot);
      const numeric = fields && fields.filter((f) => f.type === 'number');
      if (def.bindingFields.includes('xField')) {
        slot.append(fieldSelect(widget.type === 'pie' ? 'Slices by' : 'X axis', binding.xField, fields,
          (v) => setBinding(index, { ...binding, xField: v }), fieldId(`x-${index}`)));
      }
      if (def.bindingFields.includes('yField') && binding.agg !== 'count') {
        slot.append(fieldSelect(widget.type === 'pie' ? 'Size' : 'Value', binding.yField, numeric,
          (v) => setBinding(index, { ...binding, yField: v }), fieldId(`y-${index}`)));
      }
      slot.append(field('Aggregate', h('select', {
        id: fieldId(`agg-${index}`), value: binding.agg,
        onchange: (e) => { setBinding(index, { ...binding, agg: e.target.value }); render(); },
      }, Object.entries(AGGREGATIONS).map(([value, a]) => h('option', { value }, a.label)))));
    };
    fill(null);
    registry.fields(binding.sourceId).then(fill, () => {
      clear(slot).append(h('p', { class: 'field-error' }, 'Couldn\'t load fields for this source.'));
    });
    return row;
  }

  function tableColumns(widget) {
    const [binding] = widget.config.bindings;
    if (!binding?.sourceId) return null;
    const box = h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Columns'), h('p', { class: 'field-hint' }, 'Loading…'));
    registry.fields(binding.sourceId).then((fields) => {
      const chosen = widget.config.columns;
      box.replaceChildren(
        h('legend', { class: 'field-label' }, 'Columns'),
        h('div', { class: 'check-list' }, fields.map((f) => h('label', { class: 'check' },
          h('input', {
            type: 'checkbox', checked: !chosen.length || chosen.includes(f.name),
            onchange: () => {
              const picked = [...box.querySelectorAll('input:checked')].map((i) => i.dataset.name);
              patch({ columns: picked.length === fields.length ? [] : picked });
            },
            dataset: { name: f.name },
          }),
          h('span', {}, f.name)))),
        h('p', { class: 'field-hint' }, 'All checked shows every column, including new ones.'));
    }, () => box.replaceChildren(h('p', { class: 'field-error' }, 'Couldn\'t load columns.')));
    return box;
  }

  function dataSection(widget) {
    const def = WIDGET_TYPES[widget.type];
    const bindings = widget.config.bindings.length ? widget.config.bindings : [EMPTY_BINDING];
    return section('Data',
      bindings.map((b, i) => bindingRow(widget, b, i, bindings.length)),
      bindings.length < def.maxBindings && widget.config.bindings.length > 0 && h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm',
        onclick: () => { patch({ bindings: [...widget.config.bindings, { ...EMPTY_BINDING }] }); render(); },
      }, '+ Add series'),
      widget.type === 'table' && tableColumns(widget),
      selectField('Refresh', 'refresh', REFRESH_OPTIONS, { numeric: true }));
  }

  // ----------------------------------------------------------
  // Gone quiet: fade the widget when its newest row gets old
  // ----------------------------------------------------------
  function quietSection(widget) {
    const [binding] = widget.config.bindings;
    const { quietAfter, quietField } = widget.config;
    const after = h('select', {
      id: fieldId('quietAfter'), value: String(quietAfter),
      onchange: async (e) => {
        const minutes = Number(e.target.value);
        const forId = selectedId;
        // pin the column now, so public links (which only get the columns in use) can run the check too
        let column = quietField;
        if (minutes && !column && binding?.sourceId) column = findTimeField(await registry.rows(binding.sourceId).catch(() => []));
        if (selectedId !== forId) return;
        patch({ quietAfter: minutes, quietField: column });
        render();
      },
    }, QUIET_OPTIONS.map((o) => h('option', { value: String(o.value) }, o.label)));

    const parts = [field('Go quiet', after)];
    if (quietAfter && binding?.sourceId) {
      const slot = h('div', {}, h('p', { class: 'field-hint' }, 'Loading columns…'));
      registry.rows(binding.sourceId).then((rows) => {
        const names = [...new Set(rows.slice(0, 25).flatMap((r) => Object.keys(r || {})))];
        const found = findTimeField(rows);
        slot.replaceChildren(field('Time column', h('select', {
          id: fieldId('quietField'), value: quietField,
          onchange: (e) => patch({ quietField: e.target.value }),
        },
        h('option', { value: '' }, found ? `Find it (${found})` : 'Find it'),
        names.map((n) => h('option', { value: n }, n))),
        found || quietField ? null : 'No column here looks like a full date and time, so this check can\'t run yet.'));
      }, () => slot.replaceChildren(h('p', { class: 'field-error' }, 'Couldn\'t load columns.')));
      parts.push(slot);
    }
    parts.push(h('p', { class: 'field-hint' }, 'When the newest row is older than this, the widget fades and says when the source last reported. A failed refresh does the same on its own.'));
    return section('Gone quiet', ...parts);
  }

  // ----------------------------------------------------------
  // Per-type settings
  // ----------------------------------------------------------
  function section(title, ...children) {
    return h('section', { class: 'insp-section' }, h('h3', { class: 'insp-heading' }, title), ...children);
  }

  const SIZES = [{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }, { value: 'xl', label: 'Huge' }];

  function appearance(widget) {
    switch (widget.type) {
      case 'line': return section('Appearance', swatches(), h('div', { class: 'check-list' }, toggle('Smooth lines', 'smooth'), toggle('Fill area', 'fill'), toggle('Legend', 'legend'), toggle('Rows are newest first', 'reverseData')));
      case 'bar': return section('Appearance', swatches(), h('div', { class: 'check-list' }, toggle('Horizontal', 'horizontal'), toggle('Stacked', 'stacked'), toggle('Legend', 'legend')));
      case 'pie': return section('Appearance', swatches(), h('div', { class: 'check-list' }, toggle('Donut', 'donut'), toggle('Legend', 'legend')));
      case 'kpi': return section('Format',
        h('div', { class: 'field-row' }, textField('Prefix', 'prefix', { max: 6, placeholder: '$' }), textField('Suffix', 'suffix', { max: 8, placeholder: '%' })),
        selectField('Decimals', 'decimals', [0, 1, 2, 3].map((n) => ({ value: n, label: String(n) })), { numeric: true }),
        h('div', { class: 'check-list' }, toggle('Rows are newest first', 'reverseData')));
      case 'table': return section('Rows', selectField('Show up to', 'limit', [10, 25, 50, 100, 250].map((n) => ({ value: n, label: `${n} rows` })), { numeric: true }));
      case 'text': return section('Content', textField('Text', 'body', { max: 4000, multiline: true }), selectField('Size', 'fontSize', SIZES.slice(0, 3)));
      case 'label': return section('Content', textField('Text', 'text'), selectField('Size', 'size', SIZES),
        selectField('Align', 'align', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]),
        h('div', { class: 'check-list' }, toggle('Muted color', 'muted')));
      default: return null;
    }
  }

  function widgetPanel(widget) {
    const def = WIDGET_TYPES[widget.type];
    return [
      h('header', { class: 'insp-head' },
        h('span', { class: 'insp-icon' }, iconSvg(widget.type, 18)),
        h('div', {}, h('p', { class: 'eyebrow' }, 'Component'), h('h2', { class: 'insp-title' }, def.label)),
        h('button', { type: 'button', class: 'insp-close', 'aria-label': 'Deselect component', onclick: () => onSelect(null) }, '×')),
      'title' in widget.config && section('General', textField('Title', 'title', { placeholder: 'Untitled' })),
      isDataWidget(widget.type) && dataSection(widget),
      appearance(widget),
      isDataWidget(widget.type) && 'quietAfter' in widget.config && quietSection(widget),
      widget.type === 'kpi' && kpiAlerts(),
      h('div', { class: 'insp-actions' },
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-sm',
          onclick: () => { const id = uid('w'); commit((d) => duplicateWidget(d, widget.id, id)); onSelect(id); },
        }, 'Duplicate'),
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-sm btn-danger-ghost',
          onclick: () => { commit((d) => removeWidget(d, widget.id)); onSelect(null); },
        }, 'Delete')),
    ];
  }

  function dashboardPanel() {
    const { grid, widgets, theme = '' } = store.get();
    return [
      h('header', { class: 'insp-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Dashboard'), h('h2', { class: 'insp-title' }, 'Canvas'))),
      section('Grid',
        field('Density', h('select', {
          id: fieldId('columns'), value: String(grid.columns),
          onchange: (e) => commit((d) => setGrid(d, { columns: Number(e.target.value) })),
        }, COLUMN_OPTIONS.map((o) => h('option', { value: String(o.value) }, o.label))), 'Columns across. Finer grids give more precise placement; components keep their size.'),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: grid.showGrid, onchange: (e) => commit((d) => setGrid(d, { showGrid: e.target.checked })) }),
          h('span', {}, 'Show grid lines'))),
      section('Theme',
        field('Board theme', h('select', {
          id: fieldId('theme'), value: theme,
          onchange: (e) => commit((d) => setTheme(d, e.target.value)),
        }, BOARD_THEMES.map((t) => h('option', { value: t.value }, t.label))),
        'Kiroween shows this board in the Halloween palette for everyone who opens it, including the public link and exports.')),
      section('Overview',
        h('p', { class: 'insp-note' }, widgets.length ? `${widgets.length} component${widgets.length === 1 ? '' : 's'} on this dashboard.` : 'Drag a component from the left onto the canvas to start.')),
      section('Shortcuts',
        h('dl', { class: 'shortcuts' },
          [['Ctrl Z', 'Undo'], ['Ctrl Shift Z', 'Redo'], ['Ctrl S', 'Save'], ['Delete', 'Remove selected'], ['Ctrl D', 'Duplicate'], ['Esc', 'Deselect']]
            .map(([k, v]) => h('div', {}, h('dt', {}, h('kbd', {}, k)), h('dd', {}, v))))),
    ];
  }

  // ----------------------------------------------------------
  function render() {
    const widget = selected();
    if (selectedId && !widget) selectedId = null;
    clear(el).append(...(widget ? widgetPanel(widget) : dashboardPanel()).filter(Boolean));
  }

  store.subscribe((next, prev, meta) => {
    if (meta.origin === 'inspector' && meta.kind === 'commit') return;
    const before = prev.widgets.find((w) => w.id === selectedId);
    const after = next.widgets.find((w) => w.id === selectedId);
    const unchanged = selectedId ? before?.config === after?.config && Boolean(after) : prev.grid === next.grid && prev.theme === next.theme && prev.widgets.length === next.widgets.length;
    if (!unchanged) render();
  });
  registry.subscribe(() => render());

  return {
    select(id) {
      if (id === selectedId) return;
      selectedId = id;
      render();
    },
    render,
  };
}
