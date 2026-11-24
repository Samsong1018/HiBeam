// ============================================================
// IMPORT A LAYOUT (home page)
// Pick a .template.json → map each slot to one of your sources →
// POST /api/dashboards → open it in the editor.
//
// The file is untrusted: it goes through parseTemplate() and
// normalizeDashboard() before anything renders or is sent, and every
// string reaches the page through h() / textContent.
// ============================================================

import { h, clear, setLoading } from '../editor/dom.js';
import { api } from '../editor/api.js';
import { normalizeDashboard } from '../editor/model.js';
import { WIDGET_TYPES } from '../editor/widget-types.js';
import { parseTemplate, templateSlots, fillTemplate, suggestMapping, TemplateError, MAX_TEMPLATE_BYTES } from '../editor/template.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  dialog: $('#import-dialog'),
  form: $('#import-form'),
  file: $('#import-file'),
  fileError: $('#import-file-error'),
  details: $('#import-details'),
  name: $('#import-name'),
  slots: $('#import-slots'),
  slotsHint: $('#import-slots-hint'),
  error: $('#import-error'),
  submit: $('#import-submit'),
  openers: [$('#import-btn'), $('#empty-import-btn')].filter(Boolean),
};

let sources = null; // the account's sources, loaded when the dialog first opens
let pending = null; // { dash, slots } for the chosen file

function reset() {
  pending = null;
  els.form.reset();
  els.fileError.textContent = '';
  els.error.textContent = '';
  els.details.hidden = true;
  els.submit.disabled = true;
  clear(els.slots);
}

async function loadSources() {
  if (sources) return sources;
  try {
    sources = await api.listSources();
  } catch (err) {
    if (err?.status === 401) { window.location.assign('login.html'); return []; }
    sources = null;
    throw err;
  }
  return sources;
}

// ------------------------------------------------------------
// One row per slot: what it is, what it feeds, and a source picker
// ------------------------------------------------------------
function slotRow(slot, suggested, index) {
  const id = `import-slot-${index}`;
  const uses = slot.fields.length ? `uses ${slot.fields.slice(0, 6).join(', ')}${slot.fields.length > 6 ? '…' : ''}` : '';
  return h('li', { class: 'import-slot' },
    h('div', { class: 'import-slot-text' },
      h('label', { for: id, class: 'import-slot-name' }, slot.placeholder ? slot.label : 'Unknown source'),
      h('p', { class: 'import-slot-meta' },
        `${slot.widgets} widget${slot.widgets === 1 ? '' : 's'}`,
        uses && ` · ${uses}`)),
    h('select', { id, dataset: { slot: slot.key }, value: suggested || '' },
      h('option', { value: '' }, 'Leave empty for now'),
      sources.map((s) => h('option', { value: s.id }, s.name))));
}

function showDetails(dash, slots) {
  const mapping = suggestMapping(slots, sources);
  els.name.value = dash.name;
  clear(els.slots).append(...slots.map((slot, i) => slotRow(slot, mapping[slot.key], i)));
  const counts = `${dash.widgets.length} widget${dash.widgets.length === 1 ? '' : 's'}`;
  let hint;
  if (!slots.length) hint = `${counts}. It doesn't need any sources.`;
  else if (!sources.length) hint = `${counts}. You haven't connected any sources yet, so everything comes in empty. You can connect sources from the editor.`;
  else hint = `${counts}. Slots whose name matches one of your sources are already picked.`;
  els.slotsHint.textContent = hint;
  els.slots.hidden = !slots.length;
  els.details.hidden = false;
  els.submit.disabled = false;
}

async function onFile() {
  clearChoice();
  const [file] = els.file.files;
  if (!file) return;
  if (file.size > MAX_TEMPLATE_BYTES) {
    els.fileError.textContent = 'That file is over 1 MB, which is too big for a board layout.';
    return;
  }
  try {
    const raw = parseTemplate(await file.text());
    const dash = normalizeDashboard(raw);
    const dropped = raw.widgets.length - dash.widgets.length;
    const known = (await loadSources()).map((s) => s.id);
    const slots = templateSlots(dash, known);
    pending = { dash, slots, known };
    showDetails(dash, slots);
    if (dropped > 0) els.error.textContent = `${dropped} item${dropped === 1 ? '' : 's'} in the file aren't widgets HiBeam knows (${Object.keys(WIDGET_TYPES).join(', ')}) and will be left out.`;
  } catch (err) {
    els.fileError.textContent = err instanceof TemplateError ? err.message : `Couldn't read your sources · ${err?.message || 'try again'}`;
  }
}

// clear the previous file's state but keep the file input's selection
function clearChoice() {
  pending = null;
  els.fileError.textContent = '';
  els.error.textContent = '';
  els.details.hidden = true;
  els.submit.disabled = true;
}

async function onSubmit(e) {
  e.preventDefault();
  if (!pending) return;
  els.error.textContent = '';
  const mapping = Object.fromEntries([...els.slots.querySelectorAll('select')].map((sel) => [sel.dataset.slot, sel.value]));
  const name = els.name.value.trim().slice(0, 80) || pending.dash.name;
  const definition = normalizeDashboard({ ...fillTemplate(pending.dash, mapping, pending.known), name });

  setLoading(els.submit, true);
  try {
    const created = await api.createDashboard(definition);
    window.location.assign(`edit.html?id=${encodeURIComponent(created.id)}`);
  } catch (err) {
    if (err?.status === 401) { window.location.assign('login.html'); return; }
    els.error.textContent = `Couldn't create the dashboard · ${err?.message || 'try again'}`;
    setLoading(els.submit, false);
  }
}

async function open() {
  reset();
  els.dialog.showModal();
  els.file.focus();
  // warm the source list so picking a file feels instant
  loadSources().catch(() => {});
}

if (els.dialog) {
  els.openers.forEach((b) => b.addEventListener('click', open));
  els.file.addEventListener('change', onFile);
  els.form.addEventListener('submit', onSubmit);
  els.dialog.querySelectorAll('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => els.dialog.close()));
  els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) els.dialog.close(); });
}
