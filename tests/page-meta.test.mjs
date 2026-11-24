// Link-preview metadata written into the HTML pages (lib/page-meta.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const express = require('express');
const { pageMeta, buildMeta, renderPage, pageTitle, normalizeBaseUrl, escapeHtml, MARKER, PAGES } = require('../Web/backend/lib/page-meta.js');

const FRONTEND = path.join(import.meta.dirname, '../Web/frontend');
const PUBLIC_ID = 'abc123DEF456';
const BOARD = { id: PUBLIC_ID, name: 'Homelab Ops', definition: { name: 'Homelab <Ops>', widgets: [{}, {}, {}] } };

function serve(getPublic, baseUrl = 'https://dash.example.com/') {
  const app = express();
  app.use(pageMeta({ dir: FRONTEND, baseUrl, getPublic }));
  app.use((req, res) => res.status(404).send('fallthrough'));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function fetchPage(getPublic, pagePath, baseUrl) {
  const { server, url } = await serve(getPublic, baseUrl);
  try {
    const res = await fetch(url + pagePath);
    return { status: res.status, body: await res.text(), type: res.headers.get('content-type') };
  } finally {
    server.close();
  }
}

test('every listed page has exactly one marker and a <title>', () => {
  for (const name of Object.keys(PAGES)) {
    const html = fs.readFileSync(path.join(FRONTEND, 'pages', name), 'utf8');
    assert.equal(html.split(MARKER).length - 1, 1, name);
    assert.match(html, /<title>[^<]*<\/title>/, name);
  }
});

test('the assets the tags point at exist', () => {
  for (const f of ['og-image.jpg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest', 'robots.txt']) {
    assert.ok(fs.existsSync(path.join(FRONTEND, f)), f);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'site.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'HiBeam');
});

test('normalizeBaseUrl keeps http(s) origins and drops anything else', () => {
  assert.equal(normalizeBaseUrl('https://dash.example.com/'), 'https://dash.example.com');
  assert.equal(normalizeBaseUrl('http://localhost:8000'), 'http://localhost:8000');
  assert.equal(normalizeBaseUrl('https://x.y/sub/'), 'https://x.y/sub');
  for (const bad of ['', '   ', undefined, null, 'javascript:alert(1)', 'not a url', 'ftp://x.y']) {
    assert.equal(normalizeBaseUrl(bad), '', String(bad));
  }
});

test('buildMeta uses absolute URLs when a base URL is set', () => {
  const html = buildMeta({ baseUrl: 'https://dash.example.com', title: 'Log in', url: '/pages/login.html', index: true });
  assert.match(html, /property="og:image" content="https:\/\/dash\.example\.com\/og-image\.jpg"/);
  assert.match(html, /property="og:title" content="Log in · HiBeam"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /rel="canonical" href="https:\/\/dash\.example\.com\/pages\/login\.html"/);
  assert.match(html, /name="robots" content="index, follow"/);
});

test('buildMeta without a base URL uses root-relative paths and no canonical', () => {
  const html = buildMeta({ title: 'Account' });
  assert.match(html, /property="og:image" content="\/og-image\.jpg"/);
  assert.doesNotMatch(html, /canonical/);
  assert.match(html, /name="robots" content="noindex"/);
});

test('buildMeta escapes any title so it cannot break out of an attribute', () => {
  fc.assert(fc.property(fc.string(), (title) => {
    const html = buildMeta({ title });
    const escaped = escapeHtml(pageTitle(title));
    assert.ok(html.includes(`content="${escaped}"`));
    // every tag is still one well-formed line with no raw quotes or angle brackets from the title
    for (const line of html.split('\n')) {
      assert.match(line.trim(), /^<(meta|link)( [a-z:-]+="[^"<>]*")+>$/);
    }
  }));
});

test('renderPage swaps the marker and the <title>', () => {
  const out = renderPage(`<head>${MARKER}<title>Old</title></head>`, { title: 'New' });
  assert.ok(!out.includes(MARKER));
  assert.match(out, /<title>New · HiBeam<\/title>/);
});

test('a public board link gets the board name and widget count', async () => {
  const { status, body, type } = await fetchPage(async (id) => (id === PUBLIC_ID ? BOARD : null), `/pages/view.html?id=${PUBLIC_ID}`);
  assert.equal(status, 200);
  assert.match(type, /text\/html/);
  assert.match(body, /<title>Homelab &lt;Ops&gt; · HiBeam<\/title>/);
  assert.match(body, /property="og:title" content="Homelab &lt;Ops&gt; · HiBeam"/);
  assert.match(body, /A live dashboard with 3 widgets/);
  assert.match(body, new RegExp(`property="og:url" content="https://dash\\.example\\.com/pages/view\\.html\\?id=${PUBLIC_ID}"`));
  assert.ok(!body.includes(MARKER));
});

test('a private or unknown board gets the same generic tags', async () => {
  const priv = await fetchPage(async () => null, `/pages/view.html?id=${PUBLIC_ID}`);
  const none = await fetchPage(async () => null, '/pages/view.html');
  assert.match(priv.body, /<title>Dashboard · HiBeam<\/title>/);
  assert.equal(priv.body, none.body);
});

test('an invalid id never reaches the database', async () => {
  let calls = 0;
  const lookup = async () => { calls += 1; return BOARD; };
  for (const id of ['../etc', '%00', 'a'.repeat(500), "x' OR 1=1"]) {
    const { body } = await fetchPage(lookup, `/pages/view.html?id=${encodeURIComponent(id)}`);
    assert.match(body, /<title>Dashboard · HiBeam<\/title>/);
  }
  assert.equal(calls, 0);
});

test('a failing lookup still serves the page', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const { status, body } = await fetchPage(async () => { throw new Error('db down'); }, `/pages/view.html?id=${PUBLIC_ID}`);
    assert.equal(status, 200);
    assert.match(body, /<title>Dashboard · HiBeam<\/title>/);
  } finally {
    console.error = original;
  }
});

test('unlisted paths fall through to the next handler', async () => {
  for (const p of ['/pages/nope.html', '/pages/../favicon.svg', '/style/style.css', '/pages/']) {
    const { body } = await fetchPage(async () => null, p);
    assert.equal(body, 'fallthrough', p);
  }
});
