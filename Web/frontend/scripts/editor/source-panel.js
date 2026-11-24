// ============================================================
// SOURCES PANEL + "CONNECT A SOURCE" DIALOG
// Lists the account's sources in the left sidebar and owns the dialog
// that adds new ones. openDialog() resolves with the created source,
// or null if the user cancels, so the inspector can await it.
// ============================================================

import { h, clear, toast, setLoading } from './dom.js';
import { SOURCE_TYPES, SOURCE_TYPE_BY_ID } from './source-types.js';
import { SPREADSHEET_ACCEPT, MAX_SOURCE_FILE_BYTES as MAX_FILE_BYTES, checkSpreadsheetFile } from './source-file.js';

const MAX_NAME = 60;
const SVG_NS = 'http://www.w3.org/2000/svg';

// small "upload" arrow for the Replace file button
function replaceIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M8 10.5V2.5M4.75 5.75 8 2.5l3.25 3.25M2.75 10.5v2.75h10.5V10.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (err) {
    return false;
  }
}

// onSourceReplaced(id): called after a new spreadsheet uploads, so the
// canvas can redraw the widgets bound to that source.
export function createSourcePanel({ listEl, addButton, dialog, registry, store, onSourceReplaced }) {
  const form = dialog.querySelector('form');
  const nameInput = form.querySelector('#source-name');
  const typeGroup = form.querySelector('#source-type-group');
  const fieldsEl = form.querySelector('#source-fields');
  const submitBtn = form.querySelector('[type="submit"]');
  let resolveOpen = null;

  // ----------------------------------------------------------
  // Sidebar list
  // ----------------------------------------------------------
  function usageCount(sourceId) {
    return store.get().widgets.filter((w) => w.config.bindings?.some((b) => b.sourceId === sourceId)).length;
  }

  async function remove(source) {
    const used = usageCount(source.id);
    const warning = used ? ` ${used} component${used === 1 ? ' uses' : 's use'} it and will show as disconnected.` : '';
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove "${source.name}" from your account?${warning}`)) return;
    try {
      await registry.remove(source.id);
      toast(`Removed ${source.name}`);
    } catch (err) {
      toast('Couldn\'t remove that source', true);
    }
  }

  function renderList() {
    const sources = registry.list();
    clear(listEl);
    if (!sources.length) {
      listEl.append(h('li', { class: 'side-empty' }, 'No sources yet. Connect one to feed your charts.'));
      return;
    }
    sources.forEach((source) => {
      const type = SOURCE_TYPE_BY_ID[source.type];
      const used = usageCount(source.id);
      const busy = uploading.has(source.id);
      const meta = busy ? 'Uploading…' : `${type?.label || source.type}${used ? ` · ${used} in use` : ''}`;
      listEl.append(h('li', { class: `side-source${busy ? ' is-busy' : ''}`, 'aria-busy': busy ? 'true' : undefined },
        h('span', { class: 'source-chip', 'aria-hidden': 'true' }, type?.short || '···'),
        h('span', { class: 'side-source-text' },
          h('span', { class: 'side-source-name' }, source.name),
          h('span', { class: 'side-source-meta' }, meta)),
        h('span', { class: 'side-source-actions' },
          source.type === 'excel' && replaceControl(source, busy),
          h('button', { type: 'button', class: 'side-source-remove', 'aria-label': `Remove ${source.name}`, onclick: () => remove(source) }, '×'))));
    });
    if (refocusId) {
      listEl.querySelector(`.side-source-replace[data-source-id="${CSS.escape(refocusId)}"]`)?.focus();
      refocusId = null;
    }
  }

  // ----------------------------------------------------------
  // Replace a spreadsheet's file in place (keeps the id, so every
  // widget bound to it stays bound)
  // ----------------------------------------------------------
  const uploading = new Set(); // source ids with an upload in flight
  let refocusId = null;

  function replaceControl(source, busy) {
    const input = h('input', { type: 'file', accept: SPREADSHEET_ACCEPT, hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = ''; // picking the same file again should still fire change
      if (file) replaceFile(source, file);
    });
    const button = h('button', {
      type: 'button',
      class: `side-source-replace${busy ? ' is-loading' : ''}`,
      'aria-label': busy ? `Uploading a new file for ${source.name}` : `Replace file for ${source.name}`,
      title: 'Replace file',
      disabled: busy,
      dataset: { sourceId: source.id },
      onclick: () => input.click(),
    }, replaceIcon());
    return [button, input];
  }

  async function replaceFile(source, file) {
    if (uploading.has(source.id)) return;
    const problem = checkSpreadsheetFile(file);
    if (problem) {
      toast(`Couldn't update ${source.name}. ${problem}`, true);
      return;
    }
    uploading.add(source.id);
    renderList();
    try {
      await registry.replaceFile(source.id, file); // emits, which re-renders the list and inspector
      toast(`Updated ${source.name}`);
      onSourceReplaced?.(source.id);
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'The upload failed.';
      toast(`Couldn't update ${source.name}. ${reason}`, true);
    } finally {
      uploading.delete(source.id);
      // put focus back on the button, unless the user has moved on elsewhere
      const active = document.activeElement;
      if (!active || active === document.body || listEl.contains(active)) refocusId = source.id;
      renderList();
    }
  }

  registry.subscribe(renderList);
  store.subscribe((next, prev) => { if (next.widgets !== prev.widgets) renderList(); });

  // ----------------------------------------------------------
  // Dialog
  // ----------------------------------------------------------
  typeGroup.append(...SOURCE_TYPES.map((type, i) => h('label', { class: 'type-option' },
    // string 'checked' sets the attribute, so form.reset() returns to it
    h('input', { type: 'radio', name: 'source-type', value: type.id, checked: i === 0 ? 'checked' : undefined }),
    h('span', { class: 'type-card' },
      h('span', { class: 'source-chip' }, type.short),
      h('span', {}, type.label)))));

  const currentType = () => SOURCE_TYPE_BY_ID[form.querySelector('input[name="source-type"]:checked').value];

  function control(f) {
    const id = `source-f-${f.name}`;
    const common = { id, name: f.name, placeholder: f.placeholder, required: !f.optional };
    if (f.type === 'select') return h('select', common, f.options.map((o) => h('option', { value: o }, o)));
    if (f.type === 'textarea') return h('textarea', { ...common, rows: '4', maxlength: '4000', spellcheck: 'false' });
    if (f.type === 'file') return h('input', { ...common, type: 'file', accept: f.accept });
    return h('input', { ...common, type: f.type, maxlength: '2000', autocomplete: f.secret ? 'off' : undefined, spellcheck: 'false' });
  }

  function renderFields() {
    const type = currentType();
    clear(fieldsEl).append(...type.fields.map((f) => h('div', { class: 'field' },
      h('label', { for: `source-f-${f.name}` }, f.label, f.optional && h('span', { class: 'optional' }, ' · optional')),
      control(f),
      f.secret && h('p', { class: 'field-hint' }, 'Stored encrypted on the server. It never comes back to the browser.'),
      h('p', { class: 'field-error', dataset: { errorFor: `source-f-${f.name}` } }))));
  }

  function setError(input, msg) {
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    const err = form.querySelector(`[data-error-for="${input.id}"]`);
    if (err) err.textContent = msg || '';
  }

  function validate() {
    const errors = [];
    const name = nameInput.value.trim();
    if (!name) errors.push([nameInput, 'Give this source a name.']);
    else if (name.length > MAX_NAME) errors.push([nameInput, `Keep it under ${MAX_NAME} characters.`]);

    currentType().fields.forEach((f) => {
      const input = fieldsEl.querySelector(`#source-f-${f.name}`);
      if (f.type === 'file') {
        const file = input.files[0];
        if (!file && !f.optional) errors.push([input, 'Choose a file.']);
        else if (file && file.size > MAX_FILE_BYTES) errors.push([input, 'Files must be under 5 MB.']);
        return;
      }
      const value = input.value.trim();
      if (!value && !f.optional) errors.push([input, 'Required.']);
      else if (value && f.type === 'url' && !isHttpUrl(value)) errors.push([input, 'Use a full http(s):// URL.']);
    });
    return errors;
  }

  function close(result) {
    if (dialog.open) dialog.close();
    form.reset();
    renderFields(); // drops any typed secrets from the DOM
    resolveOpen?.(result);
    resolveOpen = null;
  }

  typeGroup.addEventListener('change', renderFields);
  dialog.querySelectorAll('[data-close-dialog]').forEach((btn) => btn.addEventListener('click', () => close(null)));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(null); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    [nameInput, ...fieldsEl.querySelectorAll('input, select, textarea')].forEach((i) => setError(i, ''));
    const errors = validate();
    if (errors.length) {
      errors.forEach(([input, msg]) => setError(input, msg));
      errors[0][0].focus();
      return;
    }

    // Text fields go in the encrypted key; a file is uploaded on its own after the source exists.
    const config = Object.fromEntries(currentType().fields
      .filter((f) => f.type !== 'file')
      .map((f) => [f.name, fieldsEl.querySelector(`#source-f-${f.name}`).value.trim()]));
    const fileField = currentType().fields.find((f) => f.type === 'file');
    const file = fileField ? fieldsEl.querySelector(`#source-f-${fileField.name}`).files[0] : undefined;

    setLoading(submitBtn, true);
    try {
      const created = await registry.add({ name: nameInput.value.trim(), type: currentType().id, config, file });
      toast(`Connected ${created.name}`);
      close(created);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn\'t connect that source', true);
    } finally {
      setLoading(submitBtn, false);
    }
  });

  renderFields();
  addButton.addEventListener('click', () => openDialog());

  function openDialog() {
    resolveOpen?.(null);
    dialog.showModal();
    nameInput.focus();
    return new Promise((resolve) => { resolveOpen = resolve; });
  }

  return { openDialog, renderList };
}
