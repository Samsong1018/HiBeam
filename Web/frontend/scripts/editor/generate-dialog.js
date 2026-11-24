// ============================================================
// "GENERATE FROM SOURCES" DIALOG
// Picks sources + placement, loads their rows through the registry,
// runs the pure Generator and applies the result as ONE store commit,
// so a single Undo restores the previous board. Autosave already
// listens to the store, so nothing else is needed to persist it.
// ============================================================

import { h, clear, setLoading } from './dom.js';
import { SOURCE_TYPE_BY_ID } from './source-types.js';
import { generateDashboard } from './generator.js';

const PRESELECT_MAX = 3;

const ERRORS = {
  no_sources: 'Pick at least one source.',
  too_many_widgets: 'That would put more than 200 components on the board. Try Replace board, or fewer sources.',
  too_tall: 'The board is too long to add more below. Try Replace board.',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function createGenerateDialog({ dialog, openButton, registry, store, makeId, notify, openAddSource }) {
  const form = dialog.querySelector('form');
  const listEl = form.querySelector('#generate-sources');
  const sourcesGroup = form.querySelector('#generate-sources-group');
  const modeGroup = form.querySelector('#generate-mode-group');
  const emptyEl = form.querySelector('#generate-empty');
  const addSourceBtn = form.querySelector('#generate-add-source');
  const errorEl = form.querySelector('#generate-error');
  const submitBtn = form.querySelector('#generate-submit');
  let busy = false;
  let ticket = 0; // bumps on close, so a late row load can't apply after Cancel

  const checkboxes = () => [...listEl.querySelectorAll('input[type="checkbox"]')];
  const selectedSources = () => checkboxes().filter((c) => c.checked).map((c) => registry.byId(c.value)).filter(Boolean);
  const currentMode = () => form.querySelector('input[name="generate-mode"]:checked')?.value || 'append';

  function syncSubmit() {
    submitBtn.disabled = busy || selectedSources().length === 0;
  }

  function setBusy(isBusy) {
    busy = isBusy;
    form.setAttribute('aria-busy', String(isBusy));
    [...checkboxes(), ...form.querySelectorAll('input[name="generate-mode"]')].forEach((i) => { i.disabled = isBusy; });
    setLoading(submitBtn, isBusy);
    submitBtn.textContent = isBusy ? 'Reading rows…' : 'Generate';
    syncSubmit();
  }

  function renderSources(keepChecked = new Set()) {
    const sources = registry.list();
    clear(listEl);
    emptyEl.hidden = sources.length > 0;
    sourcesGroup.hidden = sources.length === 0;
    modeGroup.hidden = sources.length === 0;
    const preselect = sources.length <= PRESELECT_MAX;
    sources.forEach((source) => {
      const type = SOURCE_TYPE_BY_ID[source.type];
      listEl.append(h('li', {},
        h('label', { class: 'gen-source' },
          h('input', { type: 'checkbox', value: source.id, checked: preselect || keepChecked.has(source.id), onchange: syncSubmit }),
          h('span', { class: 'source-chip', 'aria-hidden': 'true' }, type?.short || '···'),
          h('span', { class: 'gen-source-name' }, source.name),
          h('span', { class: 'gen-source-type' }, type?.label || source.type))));
    });
    syncSubmit();
  }

  function open() {
    ticket += 1;
    errorEl.textContent = '';
    renderSources();
    const mode = store.get().widgets.length ? 'append' : 'replace';
    form.querySelector(`input[name="generate-mode"][value="${mode}"]`).checked = true;
    if (busy) setBusy(false);
    dialog.showModal();
    (checkboxes()[0] || addSourceBtn).focus();
  }

  function close() {
    ticket += 1;
    if (busy) setBusy(false);
    if (dialog.open) dialog.close();
  }

  // Rows for each picked source; failures are named, not fatal.
  async function loadRows(sources) {
    const results = await Promise.allSettled(sources.map((s) => registry.rows(s.id)));
    const loaded = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') loaded.push({ source: sources[i], rows: r.value });
      else failed.push(sources[i].name);
    });
    return { loaded, failed };
  }

  function confirmReplace(mode) {
    const count = store.get().widgets.length;
    if (mode !== 'replace' || count === 0) return true;
    // eslint-disable-next-line no-alert
    return window.confirm(`Replace the ${plural(count, 'component')} on this board? Undo brings them back.`);
  }

  async function generate() {
    const sources = selectedSources();
    if (!sources.length) return;
    const mine = ticket;
    errorEl.textContent = '';
    setBusy(true);
    const { loaded, failed } = await loadRows(sources);
    if (mine !== ticket) return; // closed while loading
    setBusy(false);

    if (!loaded.length) {
      errorEl.textContent = `Couldn't read ${failed.join(', ')}. Check the connection and try again.`;
      return;
    }
    const mode = currentMode();
    if (!confirmReplace(mode)) return;

    const before = store.get();
    const { dashboard, error } = generateDashboard(before, loaded, { mode, makeId });
    if (error) {
      errorEl.textContent = ERRORS[error] || 'Couldn\'t generate a board from those sources.';
      return;
    }
    store.commit(dashboard, { origin: 'generate' });
    close();
    const added = dashboard.widgets.length - (mode === 'append' ? before.widgets.length : 0);
    const summary = `Generated ${plural(added, 'component')} from ${plural(loaded.length, 'source')}`;
    notify(failed.length ? `${summary}. Skipped ${failed.join(', ')}: it didn't load.` : summary, failed.length > 0);
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); generate(); });
  dialog.querySelectorAll('[data-close-dialog]').forEach((btn) => btn.addEventListener('click', close));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => openButton.focus());
  openButton.addEventListener('click', open);

  addSourceBtn.addEventListener('click', async () => {
    const created = await openAddSource();
    if (created && dialog.open) {
      renderSources(new Set([...selectedSources().map((s) => s.id), created.id]));
      listEl.querySelector(`input[value="${CSS.escape(created.id)}"]`)?.focus();
    }
  });

  // a source added or removed elsewhere while the dialog is open
  registry.subscribe(() => {
    if (!dialog.open || busy) return;
    renderSources(new Set(selectedSources().map((s) => s.id)));
  });

  return { open, close, isOpen: () => dialog.open };
}
