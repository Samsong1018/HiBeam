'use strict';

const { avatarUrl } = require('./image');

function parsePreferences(p) {
  if (typeof p === 'string') {
    try { return JSON.parse(p); } catch { return {}; }
  }
  return p === null || p === undefined ? {} : p;
}

function toIsoOrNull(v) {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Explicit allow-list: only these fields are ever copied from the row.
function toPublicProfile(row) {
  return {
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: avatarUrl(row.avatar_updated_at),
    preferences: parsePreferences(row.preferences),
    sourceCount: Number(row.source_count || 0),
    dashboardCount: Number(row.dashboard_count || 0),
    createdAt: toIsoOrNull(row.created_at),
    lastLoginAt: toIsoOrNull(row.last_login_at),
  };
}

function toSourceView(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    keyLast4: row.key_last4,
    lastSyncAt: row.last_sync_at === undefined ? null : row.last_sync_at,
  };
}

module.exports = { toPublicProfile, toSourceView, avatarUrl };
