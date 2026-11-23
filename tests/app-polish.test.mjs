// Root redirect, favicon, and avatar cache headers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { CreateApp } = require('../Web/backend/server.js');
const { CreateAccountRouter } = require('../Web/backend/lib/routes/account.js');

async function withApp(app, fn) {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('/ and /index.html redirect to the dashboards page instead of a blank page', async () => {
  await withApp(CreateApp(), async (base) => {
    for (const path of ['/', '/index.html']) {
      const res = await fetch(base + path, { redirect: 'manual' });
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.get('location'), '/pages/home.html');
    }
  });
});

test('the favicon is served', async () => {
  await withApp(CreateApp(), async (base) => {
    const res = await fetch(`${base}/favicon.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  });
});

test('versioned avatar URLs are cacheable for a day; unversioned ones revalidate', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const repos = { users: { getAvatar: async () => ({ avatar: png, avatar_mime: 'image/png' }) } };
  const app = express();
  app.use((req, res, next) => { req.userId = 1; next(); });
  app.use('/api/account', CreateAccountRouter({ repos }));
  await withApp(app, async (base) => {
    const versioned = await fetch(`${base}/api/account/avatar?v=1732300000`);
    assert.equal(versioned.status, 200);
    assert.equal(versioned.headers.get('cache-control'), 'private, max-age=86400');

    for (const query of ['', '?v=', '?v=abc', '?v=1&v=2']) {
      const res = await fetch(`${base}/api/account/avatar${query}`);
      assert.equal(res.headers.get('cache-control'), 'private, no-cache', query || '(none)');
    }
  });
});
