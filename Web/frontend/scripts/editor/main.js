// ============================================================
// EDIT DASHBOARD · entry point
// edit.html            → new dashboard (created on first save)
// edit.html?id=<id>    → load and edit an existing one
// ============================================================

import { h, toast, setLoading, isTypingTarget, relativeTime, uid } from './dom.js';
import { api, ID_RE } from './api.js';
import { createStore } from './store.js';
import { newDashboard, normalizeDashboard, setName, removeWidget, duplicateWidget } from './model.js';
import { PALETTE_ORDER } from './widget-types.js';
import { createSourceRegistry } from './sources.js';
import { createCanvas, paletteItem } from './canvas.js';
import { createInspector } from './inspector.js';
import { createSourcePanel } from './source-panel.js';
import { createAutosave } from './autosave.js';
import { createGenerateDialog } from './generate-dialog.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  editor: $('#editor'),
  name: $('#dash-name'),
  status: $('#save-status'),
  undo: $('#undo-btn'),
  redo: $('#redo-btn'),
  save: $('#save-btn'),
  preview: $('#preview-link'),
  palette: $('#palette'),
  sourceList: $('#source-list'),
  addSource: $('#add-source-btn'),
  sourceDialog: $('#source-dialog'),
  generate: $('#generate-btn'),
  generateDialog: $('#generate-dialog'),
  canvasScroll: $('#canvas-scroll'),
  grid: $('#grid'),
  inspector: $('#inspector'),
};

function showFatal(title, detail) {
  els.editor.replaceChildren(h('div', { class: 'editor-fatal' },
    h('p', { class: 'eyebrow' }, 'Editor'),
    h('h1', {}, title),
    h('p', {}, detail),
    h('a', { class: 'btn btn-primary', href: 'home.html' }, 'Back to dashboards')));
  els.editor.classList.add('is-ready');
}

async function loadDashboard(id) {
  if (!id) return newDashboard();
  // backend returns { id, definition, ... }; unwrap like the viewer does, or the
  // editor opens an empty board and the first autosave overwrites the real one
  const raw = await api.getDashboard(id);
  return normalizeDashboard(raw?.definition ?? raw);
}

function setPreview(id) {
  if (id) {
    els.preview.href = `view.html?id=${encodeURIComponent(id)}`;
    els.preview.removeAttribute('aria-disabled');
  } else {
    els.preview.removeAttribute('href');
    els.preview.setAttribute('aria-disabled', 'true');
  }
}

// ------------------------------------------------------------
// Save status pill
// ------------------------------------------------------------
let lastStatus = { state: 'saved' };

function paintStatus(status = lastStatus) {
  lastStatus = status;
  const labels = {
    saving: 'Saving…',
    dirty: 'Unsaved changes',
    error: `Save failed · ${status.error || ''}`,
    saved: status.savedAt ? `Saved ${relativeTime(status.savedAt)}` : 'All changes saved',
  };
  els.status.textContent = labels[status.state];
  els.status.dataset.state = status.state;
}

// ------------------------------------------------------------
async function boot() {
  const params = new URLSearchParams(window.location.search);
  const rawId = params.get('id');
  if (rawId !== null && !ID_RE.test(rawId)) {
    showFatal('Dashboard not found', 'That link doesn\'t point to a dashboard you can edit.');
    return;
  }

  const registry = createSourceRegistry();
  let initial;
  try {
    [initial] = await Promise.all([loadDashboard(rawId), registry.load()]);
  } catch (err) {
    if (err?.status === 401) { window.location.assign('login.html'); return; }
    const notFound = err?.status === 404 || err?.status === 403;
    showFatal(notFound ? 'Dashboard not found' : 'Couldn\'t open the editor',
      notFound ? 'It may have been deleted, or it isn\'t yours.' : 'Something went wrong loading this dashboard. Try again in a moment.');
    return;
  }

  const store = createStore(initial);
  let selectedId = null;
  let canvas;
  let inspector;

  function select(id) {
    selectedId = id;
    canvas.setSelected(id);
    inspector.select(id);
  }

  canvas = createCanvas({ el: els.grid, scroller: els.canvasScroll, store, registry, onSelect: select });
  const sourcePanel = createSourcePanel({ listEl: els.sourceList, addButton: els.addSource, dialog: els.sourceDialog, registry, store });
  inspector = createInspector({ el: els.inspector, store, registry, onSelect: select, openSourceDialog: sourcePanel.openDialog });
  inspector.render();
  sourcePanel.renderList();
  createGenerateDialog({
    dialog: els.generateDialog,
    openButton: els.generate,
    registry,
    store,
    makeId: uid,
    notify: toast,
    openAddSource: sourcePanel.openDialog,
  });

  // palette
  els.palette.append(...PALETTE_ORDER.map(paletteItem));
  canvas.setupPalette([...els.palette.querySelectorAll('.palette-item')]);

  // autosave
  const autosave = createAutosave({
    store,
    id: rawId,
    onStatus: paintStatus,
    onCreated(id) {
      const url = new URL(window.location.href);
      url.searchParams.set('id', id);
      window.history.replaceState(null, '', url);
      setPreview(id);
    },
  });
  setPreview(rawId);
  setInterval(() => { if (lastStatus.state === 'saved') paintStatus(); }, 15000);

  async function saveNow() {
    setLoading(els.save, true);
    await autosave.save();
    setLoading(els.save, false);
    if (lastStatus.state === 'error') toast('Couldn\'t save. We\'ll keep retrying as you edit.', true);
  }

  // dashboard name
  els.name.value = initial.name;
  els.name.addEventListener('input', () => store.update((d) => setName(d, els.name.value), { origin: 'toolbar', coalesce: 'name' }));
  els.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.name.blur(); });
  els.name.addEventListener('blur', () => {
    if (!els.name.value.trim()) {
      els.name.value = 'Untitled dashboard';
      store.update((d) => setName(d, els.name.value), { origin: 'toolbar', coalesce: 'name' });
    }
  });

  // toolbar buttons reflect history
  function paintHistory() {
    els.undo.disabled = !store.canUndo();
    els.redo.disabled = !store.canRedo();
  }
  store.subscribe((next, prev, meta) => {
    paintHistory();
    if (meta.origin !== 'toolbar' && next.name !== els.name.value) els.name.value = next.name;
    if (selectedId && !next.widgets.some((w) => w.id === selectedId)) select(null);
  });
  paintHistory();

  els.undo.addEventListener('click', () => store.undo());
  els.redo.addEventListener('click', () => store.redo());
  els.save.addEventListener('click', saveNow);
  els.preview.addEventListener('click', (e) => {
    if (els.preview.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      toast('Save the dashboard once to preview it');
    }
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); saveNow(); return; }
    if (els.sourceDialog.open || els.generateDialog.open || isTypingTarget(e.target)) return;

    if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
    else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
    else if (mod && key === 'd' && selectedId) {
      e.preventDefault();
      const id = uid('w');
      store.update((d) => duplicateWidget(d, selectedId, id), { origin: 'keyboard' });
      select(id);
    } else if ((key === 'delete' || key === 'backspace') && selectedId) {
      e.preventDefault();
      store.update((d) => removeWidget(d, selectedId), { origin: 'keyboard' });
      select(null);
    } else if (key === 'escape' && selectedId) {
      select(null);
    }
  });

  // charts read colours from CSS tokens, so redraw on theme change
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => canvas.rerenderAll());
  new MutationObserver(() => canvas.rerenderAll()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  els.editor.classList.add('is-ready');
}

boot();
