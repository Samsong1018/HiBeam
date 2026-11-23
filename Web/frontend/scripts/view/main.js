// ============================================================
// VIEW DASHBOARD · entry point
// view.html?id=<id>  → read-only render of a saved dashboard
//
// Reuses the editor's api, model, source registry and widget renderer,
// so a dashboard looks the same here as it does on the canvas.
// ============================================================

import { h, toast, clear } from '../editor/dom.js';
import { api, ID_RE } from '../editor/api.js';
import { normalizeDashboard } from '../editor/model.js';
import { createSourceRegistry } from '../editor/sources.js';
import { renderWidget } from '../editor/widget-render.js';
import { WIDGET_TYPES, isDataWidget } from '../editor/widget-types.js';
import { readingOrder, placement, cellSize, updatedLabel } from './layout.js';
import { createPublicRegistry } from './public-registry.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  viewer: $('#viewer'),
  title: $('#view-title'),
  updated: $('#view-updated'),
  pill: $('#visibility-pill'),
  share: $('#share-btn'),
  edit: $('#edit-link'),
  board: $('#board'),
  dialog: $('#share-dialog'),
  switchRow: $('#share-switch-row'),
  switch: $('#visibility-switch'),
  hint: $('#share-hint'),
  url: $('#share-url'),
  copy: $('#copy-btn'),
};

const EMPTY_TEXT = 'No data connected to this widget yet.';

// ------------------------------------------------------------
// Fatal states (bad id, not found, load failed)
// ------------------------------------------------------------
function showFatal(title, detail) {
  document.title = `${title} · DashGen`;
  els.viewer.replaceChildren(h('div', { class: 'view-fatal' },
    h('p', { class: 'eyebrow' }, 'Dashboard'),
    h('h1', {}, title),
    h('p', {}, detail),
    h('a', { class: 'btn btn-primary', href: 'home.html' }, 'Back to dashboards')));
  els.viewer.removeAttribute('aria-busy');
}

// ------------------------------------------------------------
// Board
// ------------------------------------------------------------
function createBoard(dash, registry) {
  const instances = []; // { content, widget, cleanup, renders }

  function render(inst) {
    inst.cleanup();
    inst.cleanup = () => {};
    const ticket = ++inst.renders;
    renderWidget(inst.content, inst.widget, registry, () => ticket === inst.renders, { emptyText: EMPTY_TEXT })
      .then((cleanup) => {
        if (ticket === inst.renders) inst.cleanup = cleanup;
        else cleanup();
      });
  }

  // Refresh without the skeleton flash: fetch first, keep the old chart up,
  // then redraw. Rows are cached by then, so renderWidget paints in one go.
  function refresh(inst) {
    const ticket = inst.renders;
    Promise.all(inst.widget.config.bindings.map((b) => registry.rows(b.sourceId)))
      .catch(() => {}) // renderWidget shows the error state itself
      .then(() => { if (ticket === inst.renders) render(inst); });
  }

  els.board.style.setProperty('--cols', dash.grid.columns);
  readingOrder(dash.widgets).forEach((widget, i) => {
    const label = `${WIDGET_TYPES[widget.type].label}${widget.config.title ? `: ${widget.config.title}` : ''}`;
    const content = h('article', { class: 'widget', dataset: { type: widget.type }, 'aria-label': label });
    const item = h('div', { class: 'board-item', dataset: { type: widget.type } }, content);
    Object.assign(item.style, placement(widget));
    item.style.setProperty('--w', widget.w);
    item.style.setProperty('--h', widget.h);
    item.style.setProperty('--i', Math.min(i, 12));
    els.board.append(item);
    const inst = { content, widget, cleanup: () => {}, renders: 0 };
    instances.push(inst);
    render(inst);
  });

  // square cells track the board's width
  const fit = () => els.board.style.setProperty('--cell', `${cellSize(els.board.clientWidth, dash.grid.columns)}px`);
  new ResizeObserver(fit).observe(els.board);
  fit();

  // widgets with a refresh interval refetch their sources while the tab is visible.
  // One timer per interval, so widgets sharing a source share one request.
  const byInterval = new Map(); // seconds -> instances
  instances
    .filter((inst) => isDataWidget(inst.widget.type) && inst.widget.config.refresh > 0)
    .forEach((inst) => {
      const secs = inst.widget.config.refresh;
      byInterval.set(secs, [...(byInterval.get(secs) || []), inst]);
    });
  byInterval.forEach((group, secs) => {
    const sourceIds = new Set(group.flatMap((inst) => inst.widget.config.bindings.map((b) => b.sourceId)));
    setInterval(() => {
      if (document.hidden) return;
      sourceIds.forEach((id) => registry.invalidate(id));
      group.forEach(refresh);
    }, secs * 1000);
  });

  return {
    rerenderAll: () => instances.forEach(render),
  };
}

function showEmpty(canEdit, editHref) {
  els.board.classList.add('is-empty');
  els.board.append(h('div', { class: 'board-empty' },
    h('p', { class: 'board-empty-title' }, 'Nothing on this dashboard yet'),
    h('p', {}, canEdit ? 'Add charts, numbers and notes in the editor and they\'ll show up here.' : 'The owner hasn\'t added anything yet.'),
    canEdit && h('a', { class: 'btn btn-primary', href: editHref }, 'Open the editor')));
}

// ------------------------------------------------------------
// Sharing + visibility
// ------------------------------------------------------------
function createSharing({ id, isOwner, initialPublic }) {
  let isPublic = initialPublic;
  let busy = false;

  els.url.value = new URL(`view.html?id=${encodeURIComponent(id)}`, window.location.href).href;
  els.switchRow.hidden = !isOwner;

  function paint() {
    els.pill.dataset.public = String(isPublic);
    els.pill.textContent = isPublic ? 'Public' : 'Private';
    els.pill.title = isOwner ? 'Change who can see this' : '';
    els.switch.setAttribute('aria-checked', String(isPublic));
    els.hint.textContent = isPublic
      ? 'On. They can view it, only you can edit.'
      : 'Off. Only you can open it.';
  }

  async function toggle() {
    if (busy) return;
    busy = true;
    const next = !isPublic;
    isPublic = next; // optimistic
    paint();
    els.switch.disabled = true;
    try {
      await api.setVisibility(id, next);
      toast(next ? 'Dashboard is public' : 'Dashboard is private');
    } catch (err) {
      isPublic = !next;
      paint();
      toast(err?.message ? `Couldn't change visibility · ${err.message}` : 'Couldn\'t change visibility', true);
    } finally {
      els.switch.disabled = false;
      busy = false;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(els.url.value);
      toast(isPublic ? 'Link copied' : 'Link copied · it only works for you while private');
    } catch (err) {
      els.url.focus();
      els.url.select();
      toast('Press Ctrl+C to copy the link');
    }
  }

  const open = () => {
    els.dialog.showModal();
    els.url.select();
  };

  els.share.addEventListener('click', open);
  els.pill.addEventListener('click', () => { if (isOwner) open(); });
  els.pill.disabled = !isOwner;
  els.switch.addEventListener('click', toggle);
  els.copy.addEventListener('click', copy);
  els.dialog.querySelectorAll('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => els.dialog.close()));
  els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) els.dialog.close(); }); // backdrop

  paint();
}

// ------------------------------------------------------------
// Loading: owner first, public link second
// ------------------------------------------------------------
// The owner route answers 401 (no session) or 404 (someone else's or missing).
// Either way the id might be a public dashboard, so try the public route before
// giving up. If that's a 404 too, surface the owner route's error: a signed-out
// visitor still lands on the login page for their own private dashboards.
async function loadDashboard(id) {
  const registry = createSourceRegistry();
  try {
    const [raw] = await Promise.all([api.getDashboard(id), registry.load()]);
    return { raw, registry, signedIn: true };
  } catch (ownerErr) {
    if (ownerErr?.status !== 401 && ownerErr?.status !== 404) throw ownerErr;
    let raw;
    try {
      raw = await api.getPublicDashboard(id);
    } catch (publicErr) {
      throw publicErr?.status === 404 ? ownerErr : publicErr;
    }
    // never trust a flag to grant owner controls on the public path
    // 401 = no session; 404 = signed in, just not the owner
    return {
      raw: { ...raw, isOwner: false },
      registry: createPublicRegistry(() => api.getPublicDashboardData(id)),
      signedIn: ownerErr.status !== 401,
    };
  }
}

// ------------------------------------------------------------
// Signed-out visitors on a public link
// ------------------------------------------------------------
// Dashboards / Account / Sign Out mean nothing without a session, so the header,
// footer and back arrow point to the login page instead.
function showSignedOutNav() {
  const loginItem = () => {
    const a = document.createElement('a');
    a.href = 'login.html';
    a.textContent = 'Log in';
    const li = document.createElement('li');
    li.append(a);
    return li;
  };
  document.querySelectorAll('.nav-links, .footer-links').forEach((list) => list.replaceChildren(loginItem()));
  document.querySelectorAll('.site-logo').forEach((logo) => { logo.href = 'login.html'; });
  document.querySelector('.view-back')?.remove();
}

// ------------------------------------------------------------
async function boot() {
  const rawId = new URLSearchParams(window.location.search).get('id');
  if (!rawId || !ID_RE.test(rawId)) {
    showFatal('Dashboard not found', 'That link doesn\'t point to a dashboard.');
    return;
  }

  let loaded;
  try {
    loaded = await loadDashboard(rawId);
  } catch (err) {
    if (err?.status === 401) { window.location.assign('login.html'); return; }
    const notFound = err?.status === 404 || err?.status === 403;
    showFatal(notFound ? 'Dashboard not found' : 'Couldn\'t load this dashboard',
      notFound ? 'It may have been deleted, or it\'s private.' : 'Something went wrong. Try again in a moment.');
    return;
  }
  const { raw, registry, signedIn } = loaded;
  if (!signedIn) showSignedOutNav();

  // backend returns { id, definition, updatedAt }; a bare definition is accepted too
  const dash = normalizeDashboard(raw?.definition ?? raw);
  const isOwner = raw?.isOwner === true; // missing flag = read-only, never show owner controls by default
  const editHref = `edit.html?id=${encodeURIComponent(rawId)}`;

  document.title = `${dash.name} · DashGen`;
  els.title.textContent = dash.name;
  const updatedAt = raw?.updatedAt ? new Date(raw.updatedAt) : null;
  const paintUpdated = () => {
    const count = `${dash.widgets.length} widget${dash.widgets.length === 1 ? '' : 's'}`;
    els.updated.textContent = [updatedAt && updatedLabel(updatedAt), count].filter(Boolean).join(' · ');
  };
  paintUpdated();
  setInterval(paintUpdated, 60000);

  if (isOwner) {
    els.edit.href = editHref;
    els.edit.hidden = false;
  } else {
    els.edit.remove();
  }

  createSharing({ id: rawId, isOwner, initialPublic: raw?.public === true });

  clear(els.board);
  if (!dash.widgets.length) {
    showEmpty(isOwner, editHref);
  } else {
    const board = createBoard(dash, registry);
    // charts read colours from CSS tokens, so redraw on theme change
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', board.rerenderAll);
    new MutationObserver(board.rerenderAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  els.viewer.removeAttribute('aria-busy');
  els.viewer.classList.add('is-ready');
}

boot();
