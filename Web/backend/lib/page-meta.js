'use strict';

const fs = require('fs');
const path = require('path');
const { isValidId } = require('./validators');

/*
  Link-preview metadata (Open Graph, Twitter card, description, icons) for the HTML pages.

  Each page in Web/frontend/pages has a `<!--#meta-->` marker in its <head>. This middleware
  serves /pages/<name>.html with that marker swapped for the page's tags, so a crawler that
  never runs JS (Slack, Discord, iMessage, X) still gets a title, description and image.

  view.html?id=<public dashboard> gets the board's own name. Private or missing boards get the
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
  'login.html': { title: 'Log in', url: '/pages/login.html', index: true },
  'home.html': { title: 'My Dashboards', url: '/', index: true },
  'view.html': { title: 'Dashboard', url: '/pages/view.html', index: false },
  'edit.html': { title: 'Edit dashboard', url: '/pages/edit.html', index: false },
  'account.html': { title: 'Account', url: '/pages/account.html', index: false },
});

const PAGE_PATTERN = /^\/pages\/([a-z]+\.html)$/;
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
  return { title: name, description, url: `/pages/view.html?id=${encodeURIComponent(rawId)}` };
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
    const match = PAGE_PATTERN.exec(req.path);
    const page = match && PAGES[match[1]];
    if (!page) return next();

    let html;
    try {
      html = readPage(match[1]);
    } catch (err) {
      return next();
    }

    let meta = { ...page, baseUrl: base };
    if (match[1] === 'view.html' && req.query.id !== undefined) {
      try {
        const board = await publicBoardMeta(lookup, req.query.id);
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

module.exports = { pageMeta, buildMeta, renderPage, pageTitle, normalizeBaseUrl, publicBoardMeta, escapeHtml, MARKER, PAGES };
