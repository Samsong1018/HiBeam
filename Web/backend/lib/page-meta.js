'use strict';

const fs = require('fs');
const path = require('path');
const { isValidId } = require('./validators');

/*
  Link-preview metadata (Open Graph, Twitter card, description, icons) for the HTML pages.

  Pages are served at clean URLs (ROUTES below): /, /login, /account, /view/<id>, /edit[/<id>].
  Each page in Web/frontend/pages has a `<!--#meta-->` marker in its <head> that is swapped for
  the page's tags, so a crawler that never runs JS (Slack, Discord, iMessage, X) still gets a
  title, description and image. Old /pages/<name>.html links get a 301 to the clean URL.

  /view/<public dashboard> gets the board's own name. Private or missing boards get the
  generic tags, so a preview never says whether a private id exists.

  Absolute URLs come from APP_BASE_URL. Without it the tags use root-relative paths, which most
  unfurlers resolve against the page URL.
*/

const MARKER = '<!--#meta-->';
const SITE_NAME = 'HiBeam';
const SITE_DESCRIPTION = 'Self-hosted dashboard builder. Connect a data source, lay widgets out on a grid, '
  + 'and share the board as a public link or a PNG/PDF.';
const IMAGE = { path: '/og-image.jpg', width: 1200, height: 630, alt: 'A HiBeam homelab dashboard with CPU, memory and request charts' };
const THEME_COLOR = '#1d1823';

// url: canonical path; index: whether search engines may index it
const PAGES = Object.freeze({
  'login.html': { title: 'Log in', url: '/login', index: true },
  'home.html': { title: 'My Dashboards', url: '/', index: true },
  'view.html': { title: 'Dashboard', url: '/view', index: false },
  'edit.html': { title: 'Edit dashboard', url: '/edit', index: false },
  'account.html': { title: 'Account', url: '/account', index: false },
});

// clean URL -> page file. A captured group is the dashboard id (still validated before use).
const ROUTES = Object.freeze([
  { pattern: /^\/$/, page: 'home.html' },
  { pattern: /^\/login\/?$/, page: 'login.html' },
  { pattern: /^\/account\/?$/, page: 'account.html' },
  { pattern: /^\/edit\/?$/, page: 'edit.html' },
  { pattern: /^\/edit\/([^/]+)\/?$/, page: 'edit.html' },
  { pattern: /^\/view\/([^/]+)\/?$/, page: 'view.html' },
]);

// old file URL -> clean URL; the ?id= query moves into the path
const LEGACY_PATTERN = /^\/(?:pages\/([a-z]+)\.html|index\.html)$/;
const LEGACY_TARGETS = Object.freeze({ home: '/', login: '/login', account: '/account', view: '/view', edit: '/edit' });
const MAX_NAME = 120;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "https://x.y/" -> "https://x.y"; anything that isn't an http(s) URL -> ''
function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return '';
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch (err) {
    return '';
  }
}

// one line of plain text, capped
function cleanText(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Pure: the tags that replace the marker. title is the page title without the site suffix.
function buildMeta({ baseUrl = '', title, description = SITE_DESCRIPTION, url = '/', index = false } = {}) {
  const fullTitle = pageTitle(title);
  description = cleanText(description, 300) || SITE_DESCRIPTION;
  const abs = (p) => `${baseUrl}${p}`;
  const tags = [
    ['meta', { name: 'description', content: description }],
    ['meta', { name: 'robots', content: index ? 'index, follow' : 'noindex' }],
    ['meta', { name: 'theme-color', content: THEME_COLOR }],
    ['meta', { name: 'application-name', content: SITE_NAME }],
    ['meta', { name: 'apple-mobile-web-app-title', content: SITE_NAME }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    ['link', { rel: 'manifest', href: '/site.webmanifest' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_NAME }],
    ['meta', { property: 'og:title', content: fullTitle }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:url', content: abs(url) }],
    ['meta', { property: 'og:image', content: abs(IMAGE.path) }],
    ['meta', { property: 'og:image:type', content: 'image/jpeg' }],
    ['meta', { property: 'og:image:width', content: String(IMAGE.width) }],
    ['meta', { property: 'og:image:height', content: String(IMAGE.height) }],
    ['meta', { property: 'og:image:alt', content: IMAGE.alt }],
    ['meta', { property: 'og:locale', content: 'en_US' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: fullTitle }],
    ['meta', { name: 'twitter:description', content: description }],
    ['meta', { name: 'twitter:image', content: abs(IMAGE.path) }],
    ['meta', { name: 'twitter:image:alt', content: IMAGE.alt }],
  ];
  if (baseUrl) tags.push(['link', { rel: 'canonical', href: abs(url) }]);

  return tags
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ')}>`)
    .join('\n        ');
}

// "Log in" -> "Log in · HiBeam"; blank -> "HiBeam"
function pageTitle(title) {
  const text = cleanText(title, MAX_NAME);
  return text ? `${text} · ${SITE_NAME}` : SITE_NAME;
}

// Pure: swap the marker and the <title> in a page.
function renderPage(html, meta) {
  const fullTitle = pageTitle(meta.title);
  return html
    .replace(MARKER, buildMeta(meta))
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(fullTitle)}</title>`);
}

// Tags for a public board, or null to fall back to the page defaults.
async function publicBoardMeta(getPublic, rawId) {
  if (typeof rawId !== 'string' || !isValidId(rawId)) return null;
  const row = await getPublic(rawId);
  if (!row) return null;
  const name = cleanText(row.definition?.name || row.name, MAX_NAME);
  if (!name) return null;
  const count = Array.isArray(row.definition?.widgets) ? row.definition.widgets.length : 0;
  const description = count > 0
    ? `A live dashboard with ${count} widget${count === 1 ? '' : 's'}, built with HiBeam.`
    : 'A live dashboard built with HiBeam.';
  return { title: name, description, url: `/view/${encodeURIComponent(rawId)}` };
}

// Pure: which page a clean URL serves, or null. id is the raw (decoded) path segment, if any.
function matchRoute(urlPath) {
  for (const route of ROUTES) {
    const m = route.pattern.exec(urlPath);
    if (!m) continue;
    if (m[1] === undefined) return { page: route.page, id: null };
    try {
      return { page: route.page, id: decodeURIComponent(m[1]) };
    } catch (err) {
      return { page: route.page, id: '' }; // malformed escape: the page shows "not found"
    }
  }
  return null;
}

// Pure: the clean URL an old /pages/<name>.html link moves to, or null.
// query is the parsed query object; anything besides id is kept (e.g. ?reset= on login).
function legacyRedirect(urlPath, query = {}) {
  const m = LEGACY_PATTERN.exec(urlPath);
  if (!m) return null;
  const target = LEGACY_TARGETS[m[1] || 'home'];
  if (!target) return null;

  const rest = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === 'id') continue;
    for (const v of [].concat(value)) if (typeof v === 'string') rest.append(key, v);
  }
  const id = typeof query.id === 'string' && query.id !== '' ? query.id : null;
  let location = target;
  if (id && (target === '/view' || target === '/edit')) location = `${target}/${encodeURIComponent(id)}`;
  else if (target === '/view') location = '/'; // a view link without a board goes to the list
  const qs = rest.toString();
  return qs ? `${location}?${qs}` : location;
}

/*
  options:
    dir        frontend directory holding pages/
    baseUrl    public origin (default APP_BASE_URL)
    getPublic  async (id) => public dashboard row or null (default repos.dashboards.getPublic)
*/
function pageMeta({ dir, baseUrl = process.env.APP_BASE_URL, getPublic } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const cache = new Map(); // file name -> html
  const lookup = getPublic || ((id) => require('./repos').dashboards.getPublic(id));

  function readPage(name) {
    if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(dir, 'pages', name), 'utf8'));
    return cache.get(name);
  }

  return async function pageMetaMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const moved = legacyRedirect(req.path, req.query);
    if (moved) return res.redirect(301, moved);

    const route = matchRoute(req.path);
    if (!route) return next();
    const page = PAGES[route.page];

    let html;
    try {
      html = readPage(route.page);
    } catch (err) {
      return next();
    }

    let meta = { ...page, baseUrl: base };
    if (route.page === 'edit.html' && route.id) meta = { ...meta, url: `/edit/${encodeURIComponent(route.id)}` };
    if (route.page === 'view.html' && route.id) {
      meta = { ...meta, url: `/view/${encodeURIComponent(route.id)}` };
      try {
        const board = await publicBoardMeta(lookup, route.id);
        if (board) meta = { ...meta, ...board };
      } catch (err) {
        // DB trouble: still serve the page with generic tags; the page reports its own errors
        console.error(`page-meta: public dashboard lookup failed: ${err.code || err.message}`);
      }
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.type('html');
    return res.send(renderPage(html, meta));
  };
}

module.exports = {
  pageMeta, buildMeta, renderPage, pageTitle, normalizeBaseUrl, publicBoardMeta, matchRoute, legacyRedirect,
  escapeHtml, MARKER, PAGES, ROUTES,
};
