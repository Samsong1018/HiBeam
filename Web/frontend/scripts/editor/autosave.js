// ============================================================
// AUTOSAVE
// Saves AUTOSAVE_DELAY_MS after the last change, or right away on
// save(). One request in flight at a time; changes made during a save
// trigger another save after it lands.
//
// The dashboard id lives here, not in the undoable document, so undoing
// past the first save can't resurrect "no id" and create a duplicate.
// ============================================================

import { api } from './api.js';

const AUTOSAVE_DELAY_MS = 1500;

export function createAutosave({ store, id = null, onStatus, onCreated }) {
  let dashboardId = id;
  let savedState = store.get();
  let timer = null;
  let inFlight = null;
  let lastError = null;
  let savedAt = null;

  const isDirty = () => store.get() !== savedState;

  function report() {
    if (inFlight) onStatus({ state: 'saving' });
    else if (lastError) onStatus({ state: 'error', error: lastError });
    else if (isDirty()) onStatus({ state: 'dirty' });
    else onStatus({ state: 'saved', savedAt });
  }

  async function send(snapshot) {
    if (dashboardId) {
      await api.saveDashboard(dashboardId, snapshot);
      return;
    }
    const created = await api.createDashboard(snapshot);
    dashboardId = created.id;
    onCreated(created.id);
  }

  async function run() {
    clearTimeout(timer);
    if (inFlight) return inFlight;
    if (!isDirty()) { report(); return undefined; }

    const snapshot = store.get();
    inFlight = send(snapshot).then(
      () => { savedState = snapshot; savedAt = new Date(); lastError = null; },
      (err) => { lastError = err instanceof Error ? err.message : 'Save failed'; },
    );
    report();
    await inFlight;
    inFlight = null;
    if (isDirty() && !lastError) schedule(); // edits landed mid-save
    report();
    return undefined;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, AUTOSAVE_DELAY_MS);
  }

  store.subscribe(() => {
    lastError = null;
    report();
    schedule();
  });

  window.addEventListener('beforeunload', (event) => {
    if (isDirty() || inFlight) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  report();
  return {
    save: run,
    isDirty,
    getId: () => dashboardId,
  };
}
