// ============================================================
// STORE + HISTORY
// Holds the dashboard document as an immutable value. Every commit pushes
// the previous value onto the undo stack. Commits with the same `coalesce`
// key in quick succession (typing in a title) collapse into one undo step.
// ============================================================

const HISTORY_LIMIT = 100;
const COALESCE_WINDOW_MS = 1200;

export function createStore(initial) {
  let state = initial;
  let past = [];
  let future = [];
  let lastKey = null;
  let lastTime = 0;
  const listeners = new Set();

  function emit(prev, meta) {
    listeners.forEach((fn) => fn(state, prev, meta));
  }

  function commit(next, meta = {}) {
    if (next === state) return;
    const now = Date.now();
    const coalesce = Boolean(meta.coalesce) && meta.coalesce === lastKey && now - lastTime < COALESCE_WINDOW_MS;
    if (!coalesce) past = [...past, state].slice(-HISTORY_LIMIT);
    future = [];
    lastKey = meta.coalesce || null;
    lastTime = now;
    const prev = state;
    state = next;
    emit(prev, { ...meta, kind: 'commit' });
  }

  function travel(from, to) {
    if (!from.length) return false;
    const prev = state;
    const target = from[from.length - 1];
    if (from === past) {
      past = past.slice(0, -1);
      future = [...future, state];
    } else {
      future = future.slice(0, -1);
      past = [...past, state];
    }
    state = target;
    lastKey = null;
    emit(prev, { kind: 'history' });
    return true;
  }

  return {
    get: () => state,
    commit,
    update: (fn, meta) => commit(fn(state), meta),
    // swap the value without touching history (server-assigned id, etc.)
    replace(next) {
      const prev = state;
      state = next;
      emit(prev, { kind: 'replace' });
    },
    undo: () => travel(past, future),
    redo: () => travel(future, past),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
