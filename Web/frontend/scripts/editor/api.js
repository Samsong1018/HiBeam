// ============================================================
// EDITOR API
// One place that talks to the backend.
//
// Security note for the backend: the dashboard id in the URL is NOT an
// access check. Every /api/dashboards/:id and /api/sources/:id handler must
// scope its query to the logged-in user (WHERE id = ? AND owner_id = ?) and
// return 404 (not 403) for someone else's id, otherwise it's an IDOR.
// ============================================================

import { packSourceKey } from './source-types.js';

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

// Raw bytes, so the server's JSON parser never touches it.
async function uploadFile(path, file) {
  let res;
  try {
    res = await fetch(path, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type && file.type !== 'application/json' ? file.type : 'application/octet-stream' },
      body: file,
    });
  } catch (err) {
    throw new ApiError('Can\'t reach the server. Check your connection.');
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.success === false) {
    throw new ApiError(payload.error || `Upload failed (${res.status})`, res.status);
  }
  return payload.data;
}

// ------------------------------------------------------------
// Public surface
// ------------------------------------------------------------
export const api = {
  getDashboard: (id) => http('GET', `/api/dashboards/${encodeURIComponent(id)}`),
  // No session needed; the server only answers for dashboards marked public.
  getPublicDashboard: (id) => http('GET', `/api/public/dashboards/${encodeURIComponent(id)}`),
  getPublicDashboardData: (id) => http('GET', `/api/public/dashboards/${encodeURIComponent(id)}/data`),
  createDashboard: (dashboard) => http('POST', '/api/dashboards', dashboard),
  saveDashboard: (id, dashboard) => http('PATCH', `/api/dashboards/${encodeURIComponent(id)}`, dashboard),
  // Separate from saveDashboard because the strict definition schema rejects a `public` field.
  setVisibility: (id, isPublic) => http('PATCH', `/api/dashboards/${encodeURIComponent(id)}/visibility`, { public: Boolean(isPublic) }),
  listSources: () => http('GET', '/api/sources'),
  // POST only returns { id }, so build the list entry the registry expects.
  // Spreadsheets upload their bytes in a second call; if that fails the half-made
  // source is removed so it doesn't sit on the account with no data.
  createSource: async ({ name, type, config, file }) => {
    const { id } = await http('POST', '/api/sources', { name, type, key: packSourceKey(type, config) });
    if (file) {
      try {
        await uploadFile(`/api/sources/${encodeURIComponent(id)}/file`, file);
      } catch (err) {
        await http('DELETE', `/api/sources/${encodeURIComponent(id)}`).catch(() => {});
        throw err;
      }
    }
    return { id, name, type, status: 'untested' };
  },
  deleteSource: (id) => http('DELETE', `/api/sources/${encodeURIComponent(id)}`),
  previewSource: (id) => http('GET', `/api/sources/${encodeURIComponent(id)}/preview`).then((rows) => ({ rows: Array.isArray(rows) ? rows : [] })),
};

