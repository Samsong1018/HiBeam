// ============================================================
// CANVAS
// Owns the gridstack grid. The store is the source of truth:
//   user drags/resizes  → 'change' → commit layout to the store
//   store changes       → sync()   → add/remove/move/re-render widgets
// `syncing` stops sync()'s own grid updates from echoing back as commits.
// GridStack is the global from the gridstack-all UMD bundle in edit.html.
// ============================================================

import { h, uid } from './dom.js';
import { WIDGET_TYPES, iconSvg } from './widget-types.js';
import { scaleSize } from './data.js';
import { addWidget, applyLayout } from './model.js';
import { renderWidget } from './widget-render.js';

export function createCanvas({ el, scroller, store, registry, onSelect }) {
  const instances = new Map(); // id -> { el, content, widget, cleanup, renders }
  let syncing = false;
  let selectedId = null;
  let dropKey = null;

  const grid = GridStack.init({
    column: store.get().grid.columns,
    cellHeight: 'auto', // square cells
    margin: 3,
    float: true,
    animate: true,
    acceptWidgets: (node) => node.classList?.contains('palette-item'),
    resizable: { handles: 'e, se, s, sw, w' },
    draggable: { cancel: '.widget-nodrag' },
  }, el);

  // ----------------------------------------------------------
  // Grid → store
  // ----------------------------------------------------------
  function readLayout() {
    const layout = {};
    grid.engine.nodes.forEach((n) => {
      if (n.id && instances.has(n.id)) layout[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h };
    });
    return layout;
  }

  grid.on('change', (event, items = []) => {
    if (syncing) return;
    // An id-less node is a palette item mid-drop; group its push-aside
    // moves with the add that follows so one undo reverts both.
    if (items.some((n) => !n.id)) dropKey = `drop-${Date.now()}`;
    store.update((d) => applyLayout(d, readLayout()), { origin: 'canvas', coalesce: dropKey || undefined });
  });

  grid.on('dropped', (event, previous, node) => {
    const type = node?.el?.dataset.widgetType;
    const pos = { x: node.x, y: node.y, w: node.w, h: node.h };
    syncing = true;
    grid.removeWidget(node.el, true, false); // swap gridstack's clone for a real widget
    syncing = false;
    if (WIDGET_TYPES[type]) add(type, pos, dropKey);
    dropKey = null;
  });

  // ----------------------------------------------------------
  // Adding
  // ----------------------------------------------------------
  function minFor(type) {
    return scaleSize(WIDGET_TYPES[type].min, store.get().grid.columns);
  }

  function bottomY() {
    return store.get().widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
  }

  function add(type, pos, coalesce) {
    const def = WIDGET_TYPES[type];
    const { columns } = store.get().grid;
    const size = scaleSize(def.size, columns);
    const min = minFor(type);
    const w = Math.min(columns, Math.max(min.w, pos?.w || size.w));
    const widget = {
      id: uid('w'),
      type,
      x: Math.min(Math.max(pos?.x ?? 0, 0), columns - w),
      y: pos?.y ?? bottomY(),
      w,
      h: Math.max(min.h, pos?.h || size.h),
      config: structuredClone(def.defaults),
    };
    store.update((d) => addWidget(d, widget), { origin: 'canvas', coalesce });
    onSelect(widget.id);
    instances.get(widget.id)?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ----------------------------------------------------------
  // Store → grid
  // ----------------------------------------------------------
  function render(inst, widget) {
    inst.cleanup();
    inst.cleanup = () => {};
    const ticket = ++inst.renders;
    inst.content.dataset.type = widget.type;
    inst.content.setAttribute('aria-label', `${WIDGET_TYPES[widget.type].label}${widget.config.title ? `: ${widget.config.title}` : ''}`);
    renderWidget(inst.content, widget, registry, () => ticket === inst.renders && instances.has(widget.id))
      .then((cleanup) => {
        if (ticket === inst.renders) inst.cleanup = cleanup;
        else cleanup();
      });
  }

  function mount(widget) {
    const min = minFor(widget.type);
    const content = h('div', {
      class: 'grid-stack-item-content widget',
      tabindex: '0',
      onpointerdown: () => onSelect(widget.id),
      onfocus: () => onSelect(widget.id),
    });
    const itemEl = h('div', { class: 'grid-stack-item' }, content);
    el.append(itemEl);
    grid.makeWidget(itemEl, { id: widget.id, x: widget.x, y: widget.y, w: widget.w, h: widget.h, minW: min.w, minH: min.h });
    const inst = { el: itemEl, content, widget, cleanup: () => {}, renders: 0 };
    instances.set(widget.id, inst);
    render(inst, widget);
    if (widget.id === selectedId) content.classList.add('is-selected');
  }

  function unmount(id) {
    const inst = instances.get(id);
    inst.cleanup();
    instances.delete(id);
    grid.removeWidget(inst.el, true, false);
  }

  function patch(inst, widget, columnsChanged) {
    const node = inst.el.gridstackNode;
    const moved = node.x !== widget.x || node.y !== widget.y || node.w !== widget.w || node.h !== widget.h;
    if (moved || columnsChanged) {
      const min = minFor(widget.type);
      grid.update(inst.el, { x: widget.x, y: widget.y, w: widget.w, h: widget.h, minW: min.w, minH: min.h });
    }
    if (inst.widget.config !== widget.config) render(inst, widget);
    inst.widget = widget;
  }

  function sync(next, prev) {
    syncing = true;
    const columnsChanged = Boolean(prev) && next.grid.columns !== prev.grid.columns;
    if (columnsChanged) grid.column(next.grid.columns, 'none');
    el.classList.toggle('show-grid', next.grid.showGrid);

    grid.batchUpdate();
    const ids = new Set(next.widgets.map((w) => w.id));
    [...instances.keys()].filter((id) => !ids.has(id)).forEach(unmount);
    next.widgets.forEach((w) => {
      const inst = instances.get(w.id);
      if (!inst) mount(w);
      else if (inst.widget !== w || columnsChanged) patch(inst, w, columnsChanged);
    });
    grid.batchUpdate(false);
    syncing = false;
    fitRows();
  }

  // ----------------------------------------------------------
  // Grid always fills the visible canvas so there's room to drop
  // ----------------------------------------------------------
  function fitRows() {
    const cell = grid.getCellHeight(true);
    if (!cell) return;
    const minRow = Math.ceil(scroller.clientHeight / cell);
    if (grid.opts.minRow !== minRow) grid.updateOptions({ minRow });
  }
  new ResizeObserver(fitRows).observe(scroller);

  // click on empty canvas clears the selection
  el.addEventListener('pointerdown', (event) => {
    if (event.target === el) onSelect(null);
  });

  store.subscribe((next, prev) => sync(next, prev));
  sync(store.get(), null);

  return {
    add,

    // Palette items: drag them in, or click / Enter to add at the bottom.
    setupPalette(items) {
      const refreshSizes = () => {
        const { columns } = store.get().grid;
        items.forEach((item) => {
          const size = scaleSize(WIDGET_TYPES[item.dataset.widgetType].size, columns);
          item.setAttribute('data-gs-widget', JSON.stringify(size));
        });
      };
      refreshSizes();
      store.subscribe((next, prev) => { if (next.grid.columns !== prev.grid.columns) refreshSizes(); });
      GridStack.setupDragIn(items, { appendTo: 'body', helper: 'clone' });
      items.forEach((item) => {
        item.addEventListener('click', () => add(item.dataset.widgetType));
        item.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          add(item.dataset.widgetType);
        });
      });
    },

    setSelected(id) {
      selectedId = id;
      instances.forEach((inst, key) => inst.content.classList.toggle('is-selected', key === id));
    },

    focus(id) {
      instances.get(id)?.content.focus({ preventScroll: false });
    },

    // re-render everything (theme change, source data refreshed)
    rerenderAll() {
      instances.forEach((inst) => render(inst, inst.widget));
    },

    rerenderSource(sourceId) {
      instances.forEach((inst) => {
        if (inst.widget.config.bindings?.some((b) => b.sourceId === sourceId)) render(inst, inst.widget);
      });
    },
  };
}

export function paletteItem(type) {
  const def = WIDGET_TYPES[type];
  return h('li', {},
    // a div, not a <button>: gridstack won't start drags from inside buttons
    h('div', { role: 'button', tabindex: '0', class: 'palette-item', dataset: { widgetType: type }, title: 'Drag onto the canvas, or click to add' },
      h('span', { class: 'palette-icon' }, iconSvg(type)),
      h('span', { class: 'palette-text' },
        h('span', { class: 'palette-name' }, def.label),
        h('span', { class: 'palette-hint' }, def.hint))));
}
