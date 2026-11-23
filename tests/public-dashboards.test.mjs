// Public dashboard sharing: GET /api/public/dashboards/:id and /:id/data, plus the viewer's registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const CreatePublicDashboardsRouter = require('../Web/backend/lib/routes/public-dashboards.js');
const { createPublicRegistry } = await import('../Web/frontend/scripts/view/public-registry.js');

const DEF = {
  name: 'Shared',
  widgets: [
    { id: 'w1', type: 'kpi', config: { bindings: [{ sourceId: 'src_a' }] } },
    { id: 'w2', type: 'bar', config: { bindings: [{ sourceId: 'src_b' }] } },
    { id: 'w3', type: 'bar', config: { bindings: [{ sourceId: 'src_gone' }] } },
  ],
};

function fakeRepos() {
  const dashboards = {
    dash_pub: { id: 'dash_pub', owner_id: 7, name: 'Shared', definition: DEF, is_public: 1, updated_at: new Date('2026-11-01T00:00:00Z') },
    dash_priv: { id: 'dash_priv', owner_id: 7, name: 'Hidden', definition: DEF, is_public: 0, updated_at: new Date() },
  };
  const sources = [
    { id: 'src_a', owner_id: 7, name: 'Sales', key_enc: 'x' },
    { id: 'src_b', owner_id: 7, name: 'Broken', key_enc: 'x' },
    { id: 'src_other', owner_id: 9, name: 'Not yours', key_enc: 'x' },
  ];
  const calls = { getMany: [] };
  return {
    calls,
    repos: {
      dashboards: {
        // mirrors the SQL: is_public = 1 only
        getPublic: async (id) => (dashboards[id] && dashboards[id].is_public === 1 ? dashboards[id] : null),
      },
      sources: {
        getManyWithKey: async (ownerId, ids) => {
          calls.getMany.push({ ownerId, ids });
          return sources.filter((s) => s.owner_id === ownerId && ids.includes(s.id));
        },
      },
    },
  };
}

async function withServer(deps, fn) {
  const app = express();
  app.use('/api/public/dashboards', CreatePublicDashboardsRouter(deps));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/public/dashboards`;
  try {
    await fn(async (path) => {
      const res = await fetch(base + path);
      return { status: res.status, body: await res.json() };
    });
  } finally {
    server.close();
  }
}

const preview = (calls) => async (src) => {
  calls.push(src.id);
  if (src.id === 'src_b') { const e = new Error('x'); e.reason = 'Source returned an error'; throw e; }
  return [{ v: 1 }, { v: 2 }];
};

test('public dashboard is served read-only with isOwner false and no owner id', async () => {
  const { repos } = fakeRepos();
  await withServer({ repos, previewSource: async () => [] }, async (get) => {
    const { status, body } = await get('/dash_pub');
    assert.equal(status, 200);
    assert.deepEqual(body.data, { id: 'dash_pub', definition: DEF, public: true, isOwner: false, updatedAt: '2026-11-01T00:00:00.000Z' });
    assert.ok(!JSON.stringify(body).includes('owner'));
  });
});

test('private and missing dashboards are indistinguishable 404s; bad ids are 400', async () => {
  const { repos } = fakeRepos();
  await withServer({ repos, previewSource: async () => [] }, async (get) => {
    const priv = await get('/dash_priv');
    const missing = await get('/dash_nope');
    assert.equal(priv.status, 404);
    assert.deepEqual(priv.body, missing.body);
    assert.equal((await get('/dash_priv/data')).status, 404);
    assert.equal((await get('/bad%20id')).status, 400);
  });
});

test('data is read through the owner\'s sources only and keyed by source id', async () => {
  const { repos, calls } = fakeRepos();
  const previewed = [];
  await withServer({ repos, previewSource: preview(previewed) }, async (get) => {
    const { status, body } = await get('/dash_pub/data');
    assert.equal(status, 200);
    assert.deepEqual(calls.getMany, [{ ownerId: 7, ids: ['src_a', 'src_b', 'src_gone'] }]);
    assert.deepEqual(body.data.src_a, { name: 'Sales', rows: [{ v: 1 }, { v: 2 }] });
    assert.deepEqual(body.data.src_b, { name: 'Broken', error: 'Source returned an error' });
    assert.deepEqual(body.data.src_gone, { name: null, error: 'Source unreachable' });
    assert.ok(!JSON.stringify(body).includes('key_enc'));
  });
});

test('data responses are cached briefly so anonymous traffic can\'t hammer upstreams', async () => {
  const { repos } = fakeRepos();
  const previewed = [];
  let now = 1000;
  await withServer({ repos, previewSource: preview(previewed), now: () => now, cacheMs: 5000 }, async (get) => {
    await get('/dash_pub/data');
    await get('/dash_pub/data');
    assert.equal(previewed.length, 2); // src_a + src_b once
    now += 6000;
    await get('/dash_pub/data');
    assert.equal(previewed.length, 4);
  });
});

test('public registry shares one fetch, serves names, throws on errored sources, refetches after invalidate', async () => {
  let fetches = 0;
  const registry = createPublicRegistry(async () => {
    fetches += 1;
    return { src_a: { name: 'Sales', rows: [{ v: 1 }] }, src_b: { name: 'Broken', error: 'nope' } };
  });
  const [a, again] = await Promise.all([registry.rows('src_a'), registry.rows('src_a')]);
  assert.deepEqual(a, [{ v: 1 }]);
  assert.equal(again, a);
  assert.equal(fetches, 1);
  assert.deepEqual(registry.byId('src_a'), { id: 'src_a', name: 'Sales' });
  assert.equal(registry.byId('src_x'), null);
  await assert.rejects(registry.rows('src_b'), /nope/);
  await assert.rejects(registry.rows('src_missing'));
  assert.deepEqual(await registry.rows(''), []);
  registry.invalidate('src_a');
  await registry.rows('src_a');
  assert.equal(fetches, 2);
});

test('public registry retries after a failed fetch', async () => {
  let fail = true;
  const registry = createPublicRegistry(async () => {
    if (fail) { fail = false; throw new Error('down'); }
    return { src_a: { name: 'S', rows: [] } };
  });
  await assert.rejects(registry.rows('src_a'), /down/);
  assert.deepEqual(await registry.rows('src_a'), []);
});
