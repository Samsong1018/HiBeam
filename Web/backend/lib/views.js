'use strict';

// Local implementation; lib/image.js (task 6.1) may later own this.
function avatarUrl(avatarUpdatedAt) {
  if (avatarUpdatedAt === null || avatarUpdatedAt === undefined) return null;
  return `/api/account/avatar?v=${Math.trunc(Number(avatarUpdatedAt))}`;
}

function parsePreferences(p) {
  if (typeof p === 'string') {
    try { return JSON.parse(p); } catch { return {}; }
  }
  return p === null || p === undefined ? {} : p;
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
