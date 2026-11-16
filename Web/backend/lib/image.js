'use strict';

const MAX_AVATAR_BYTES = 2097152;

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

// Magic bytes only. Returns 'png' | 'jpeg' | 'webp' | null.
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) return null;
  if (startsWith(buffer, PNG_SIG)) return 'png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  // RIFF....WEBP
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

function mimeFor(type) {
  return Object.prototype.hasOwnProperty.call(MIME, type) ? MIME[type] : null;
}

// Returns the string 'missing' | 'too_large' | 'unsupported' on rejection,
// otherwise { type, mime }.
function checkAvatar(buffer) {
  if (!buffer || buffer.length === 0) return 'missing';
  if (buffer.length > MAX_AVATAR_BYTES) return 'too_large';
  const type = detectImageType(buffer);
  if (type === null) return 'unsupported';
  return { type, mime: MIME[type] };
}

function avatarUrl(avatarUpdatedAt) {
  if (avatarUpdatedAt === null || avatarUpdatedAt === undefined) return null;
  return `/api/account/avatar?v=${Math.trunc(Number(avatarUpdatedAt))}`;
}

module.exports = { MAX_AVATAR_BYTES, detectImageType, mimeFor, checkAvatar, avatarUrl };
