// ============================================================
// PUBLIC SOURCE REGISTRY
// Stands in for createSourceRegistry() when someone who doesn't own the
// dashboard opens a public link. They can't list or preview the owner's
// sources, so rows come from GET /api/public/dashboards/:id/data, which
// returns { [sourceId]: { name, rows } | { name, error } } in one call.
// Same rows / byId / invalidate surface the widget renderer uses.
// ============================================================

export function createPublicRegistry(fetchData) {
  let pending = null; // Promise<map> shared by every widget until invalidated
  let names = new Map(); // sourceId -> display name, filled once data arrives
  const lastGood = new Map(); // sourceId -> { rows, at }: kept when a later refresh fails

  function load() {
    if (!pending) {
      pending = Promise.resolve().then(fetchData).then((map) => {
        const safe = map && typeof map === 'object' ? map : {};
        names = new Map(Object.entries(safe).map(([id, entry]) => [id, entry?.name || names.get(id) || null]));
        const at = Date.now();
        Object.entries(safe).forEach(([id, entry]) => {
          if (entry && !entry.error && Array.isArray(entry.rows)) lastGood.set(id, { rows: entry.rows, at });
        });
        return safe;
      });
      pending.catch(() => { pending = null; }); // let the next render retry
    }
    return pending;
  }

  return {
    load,
    list: () => [...names].map(([id, name]) => ({ id, name })),
    byId: (id) => (names.has(id) ? { id, name: names.get(id) } : null),

    async rows(id) {
      if (!id) return [];
      const entry = (await load())[id];
      if (!entry || entry.error) throw new Error(entry?.error || 'Source unavailable');
      return Array.isArray(entry.rows) ? entry.rows : [];
    },

    lastGood: (id) => lastGood.get(id) || null,

    // every source comes from one request, so dropping any of them refetches all
    invalidate() {
      pending = null;
    },
  };
}
