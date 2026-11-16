'use strict';

const fs = require('fs');
const path = require('path');
const { fail } = require('./envelope');

const STATIC_ALLOWLIST = new Set(['api.js']);
const PREFIX = '/backend/';
const NOT_FOUND = 'Not found';

const REJECT = Object.freeze({ reject: true });

// Pure resolver. Works on the raw URL (query allowed) and returns
// { file } for an allowed request or { reject: true } for anything else.
function resolveStaticRequest(rawUrl, method, allowlist = STATIC_ALLOWLIST) {
  // 1. Method
  if (method !== 'GET' && method !== 'HEAD') return REJECT;
  if (typeof rawUrl !== 'string') return REJECT;

  // 2. Strip query/fragment and the prefix; reject directories.
  let p = rawUrl;
  const cut = p.search(/[?#]/);
  if (cut !== -1) p = p.slice(0, cut);
  if (!p.startsWith(PREFIX)) return REJECT;
  const rest = p.slice(PREFIX.length);
  if (rest === '' || rest.endsWith('/')) return REJECT;

  // 3. Reject traversal characters, literal or encoded.
  if (rest.includes('..') || rest.includes('\\') || rest.includes('\0')) return REJECT;
  if (/%2e%2e|%2f|%5c|%00/i.test(rest)) return REJECT;

  // 4. Decode once, then check again.
  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch (e) {
    return REJECT;
  }
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0') || decoded.includes('..')) {
    return REJECT;
  }

  // 5. Exact, case-sensitive allowlist match.
  if (!allowlist.has(decoded)) return REJECT;
  return { file: decoded };
}

function staticAllowlist({ dir, allowlist = STATIC_ALLOWLIST } = {}) {
  return function staticAllowlistMiddleware(req, res) {
    const result = resolveStaticRequest(req.originalUrl || req.url, req.method, allowlist);
    if (result.reject) return fail(res, 404, NOT_FOUND);

    fs.readFile(path.join(dir, result.file), (err, data) => {
      if (err) return fail(res, 404, NOT_FOUND);
      res.status(200);
      res.set('Content-Type', 'application/javascript; charset=utf-8');
      res.set('X-Content-Type-Options', 'nosniff');
      if (req.method === 'HEAD') return res.end();
      return res.end(data);
    });
  };
}

module.exports = { STATIC_ALLOWLIST, resolveStaticRequest, staticAllowlist };
