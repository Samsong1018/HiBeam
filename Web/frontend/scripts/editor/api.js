// ============================================================
// EDITOR API
// One place that talks to the backend. USE_MOCK keeps everything in
// localStorage until the /api/dashboards + /api/sources endpoints exist —
// flip it to false and the real fetch() path below takes over.
//
// Security note for the backend: the dashboard id in the URL is NOT an
// access check. Every /api/dashboards/:id and /api/sources/:id handler must
// scope its query to the logged-in user (WHERE id = ? AND owner_id = ?) and
// return 404 (not 403) for someone else's id, otherwise it's an IDOR.
// ============================================================

import { mockRowsFor } from './source-types.js';

const USE_MOCK = true;
const MOCK_LATENCY_MS = 300;
const DASHBOARDS_KEY = 'dashgen:mock:dashboards';
const SOURCES_KEY = 'dashgen:mock:sources';

// ids are opaque strings; anything else in ?id= is rejected before a request
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

// ------------------------------------------------------------
// Real backend (expects { success, data, error } envelopes)
// ------------------------------------------------------------
async function http(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError('Can\'t reach the server. Check your connection.');
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.success === false) {
    throw new ApiError(payload.error || `Request failed (${res.status})`, res.status);
  }
  return payload.data;
}

// ------------------------------------------------------------
// Mock backend
// ------------------------------------------------------------
const memoryFallback = new Map();

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch (err) {
    return memoryFallback.get(key) || {};
  }
}

function writeStore(key, value) {
  memoryFallback.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // storage blocked or full: keep working in memory for this page view
  }
}

const delay = () => new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

function mockId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

const SEED_SOURCES = [
  { id: 'src_sales', name: 'Q3 Sales workbook', type: 'excel', status: 'ok' },
  { id: 'src_logs', name: 'API server logs', type: 'logs', status: 'ok' },
  { id: 'src_orders', name: 'Orders database', type: 'sql', status: 'ok' },
];

function mockSources() {
  const stored = readStore(SOURCES_KEY);
  if (Object.keys(stored).length) return stored;
  const seeded = Object.fromEntries(SEED_SOURCES.map((s) => [s.id, { ...s, createdAt: new Date().toISOString() }]));
  writeStore(SOURCES_KEY, seeded);
  return seeded;
}

const mock = {
  async getDashboard(id) {
    await delay();
    const dash = readStore(DASHBOARDS_KEY)[id];
    if (!dash) throw new ApiError('Dashboard not found', 404);
    return dash;
  },
  async createDashboard(dashboard) {
    await delay();
    const all = readStore(DASHBOARDS_KEY);
    const created = { ...dashboard, id: mockId('dash'), updatedAt: new Date().toISOString() };
    writeStore(DASHBOARDS_KEY, { ...all, [created.id]: created });
    return created;
  },
  async saveDashboard(id, dashboard) {
    await delay();
    const all = readStore(DASHBOARDS_KEY);
    if (!all[id]) throw new ApiError('Dashboard not found', 404);
    const saved = { ...dashboard, id, updatedAt: new Date().toISOString() };
    writeStore(DASHBOARDS_KEY, { ...all, [id]: saved });
    return saved;
  },
  async listSources() {
    await delay();
    return Object.values(mockSources());
  },
  async createSource({ name, type }) {
    await delay();
    // config/secrets would go to the server here and never come back
    const created = { id: mockId('src'), name, type, status: 'ok', createdAt: new Date().toISOString() };
    writeStore(SOURCES_KEY, { ...mockSources(), [created.id]: created });
    return created;
  },
  async deleteSource(id) {
    await delay();
    const { [id]: removed, ...rest } = mockSources();
    writeStore(SOURCES_KEY, rest);
    return { id };
  },
  async previewSource(id) {
    await delay();
    const source = mockSources()[id];
    if (!source) throw new ApiError('Source not found', 404);
    return { rows: mockRowsFor(source) };
  },
};

// ------------------------------------------------------------
// Public surface
// ------------------------------------------------------------
const real = {
  getDashboard: (id) => http('GET', `/api/dashboards/${encodeURIComponent(id)}`),
  createDashboard: (dashboard) => http('POST', '/api/dashboards', dashboard),
  saveDashboard: (id, dashboard) => http('PATCH', `/api/dashboards/${encodeURIComponent(id)}`, dashboard),
  listSources: () => http('GET', '/api/sources'),
  createSource: (input) => http('POST', '/api/sources', input),
  deleteSource: (id) => http('DELETE', `/api/sources/${encodeURIComponent(id)}`),
  previewSource: (id) => http('GET', `/api/sources/${encodeURIComponent(id)}/preview`),
};

export const api = USE_MOCK ? mock : real;
