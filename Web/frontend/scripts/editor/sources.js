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
      emit();
    },

    // Shared promise so five widgets on one source make one request.
    rows(id) {
      if (!id) return Promise.resolve([]);
      if (!rowCache.has(id)) {
        const pending = api.previewSource(id).then((res) => (Array.isArray(res?.rows) ? res.rows : []));
        pending.catch(() => rowCache.delete(id)); // let the next render retry
        rowCache.set(id, pending);
      }
      return rowCache.get(id);
    },

    async fields(id) {
      return fieldsOf(await this.rows(id));
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
