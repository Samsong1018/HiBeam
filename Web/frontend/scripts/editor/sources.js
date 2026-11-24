// ============================================================
// SOURCE REGISTRY
// The user's connected sources plus a cache of their preview rows.
// Sources live on the account (GET /api/sources), not in the dashboard
// document, so adding/removing one isn't part of undo history.
// ============================================================

import { api } from './api.js';
import { fieldsOf } from './data.js';

export function createSourceRegistry() {
  let sources = [];
  const rowCache = new Map(); // id -> Promise<rows[]>
  const lastGood = new Map(); // id -> { rows, at }: what to keep showing if a refresh fails
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(sources));

  return {
    async load() {
      sources = await api.listSources();
      emit();
      return sources;
    },
    list: () => sources,
    byId: (id) => sources.find((s) => s.id === id) || null,

    async add(input) {
      const created = await api.createSource(input);
      sources = [...sources, created];
      emit();
      return created;
    },

    async remove(id) {
      await api.deleteSource(id);
      sources = sources.filter((s) => s.id !== id);
      rowCache.delete(id);
      lastGood.delete(id);
      emit();
    },

    // Upload a new workbook for an excel source. The old rows (and lastGood)
    // are dropped so nothing keeps showing last month's data, and listeners
    // are told so the inspector rebuilds its field pickers from fresh rows.
    async replaceFile(id, file) {
      await api.replaceSourceFile(id, file);
      this.invalidate(id);
      lastGood.delete(id);
      sources = sources.map((s) => (s.id === id ? { ...s, status: 'untested' } : s));
      emit();
    },

    // Shared promise so five widgets on one source make one request.
    rows(id) {
      if (!id) return Promise.resolve([]);
      if (!rowCache.has(id)) {
        const pending = api.previewSource(id).then((res) => {
          const rows = Array.isArray(res?.rows) ? res.rows : [];
          lastGood.set(id, { rows, at: Date.now() });
          return rows;
        });
        pending.catch(() => rowCache.delete(id)); // let the next render retry
        rowCache.set(id, pending);
      }
      return rowCache.get(id);
    },

    // drop cached rows so the next rows(id) refetches (viewer auto-refresh)
    invalidate(id) {
      rowCache.delete(id);
    },

    // the last rows that loaded for a source, or null if none ever did
    lastGood: (id) => lastGood.get(id) || null,

    async fields(id) {
      return fieldsOf(await this.rows(id));
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
