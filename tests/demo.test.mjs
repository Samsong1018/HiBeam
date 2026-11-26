// One-click demo accounts: lib/demo.js (pure), routes/demo.js (with fakes), and the guards around them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const express = require('express');
const libDemo = require('../Web/backend/lib/demo.js');
const { CreateDemoRouter, NO_PASSWORD } = require('../Web/backend/lib/routes/demo.js');
const { verifyPassword } = require('../Web/backend/lib/passwords.js');
const { CreateMailer } = require('../Web/backend/lib/mailer.js');
const { validateSignup } = require('../Web/backend/lib/validators.js');

const SHOWCASE_DEF = {
  name: 'Homelab Ops',
  widgets: [
    { id: 'w1', type: 'kpi', config: { bindings: [{ sourceId: 'src_metrics', yField: 'cpuPct', agg: 'last' }] } },
    { id: 'w2', type: 'line', config: { bindings: [{ sourceId: 'src_history' }, { sourceId: 'src_metrics' }] } },
    { id: 'w3', type: 'text', config: { text: 'hello' } },
    { id: 'w4', type: 'bar', config: { bindings: [{ sourceId: 'src_private_elsewhere' }] } },
  ],
};

function fakeWorld({ seed = 'showcase', boards = [{ id: 'dash_a', name: 'Homelab Ops', definition: SHOWCASE_DEF }], liveDemos = 0, oldDemos = 0 } = {}) {
  const state = { users: [], sources: [], dashboards: [], sessions: [], committed: false, recycled: [] };
  let oldLeft = oldDemos;
  const seedSources = [
    { id: 'src_metrics', name: 'metrics', type: 'rest', status: 'ok', key_enc: 'ENC1', key_last4: 'abcd', file_data: null, last_sync_at: null },
    { id: 'src_history', name: 'history', type: 'rest', status: 'ok', key_enc: 'ENC2', key_last4: 'efgh', file_data: null, last_sync_at: null },
    { id: 'src_unused', name: 'unused', type: 'rest', status: 'ok', key_enc: 'ENC3', key_last4: 'ijkl', file_data: null, last_sync_at: null },
  ];
  let ids = 0;
  const repos = {
    users: { create: async (u) => { state.users.push(u); return 100 + state.users.length; } },
    sessions: { create: async (userId, hash) => { state.sessions.push({ userId, hash }); } },
    dashboards: { create: async (userId, d) => { state.dashboards.push({ userId, ...d }); return d.id; } },
    demo: {
      findUserIdByUsername: async (name) => (name === 'showcase' ? 7 : null),
      listPublicDashboards: async (ownerId) => (ownerId === 7 ? boards : []),
      listSourcesForCopy: async (ownerId, wanted) => (ownerId === 7 ? seedSources.filter((s) => wanted.includes(s.id)) : []),
      insertSourceCopy: async (userId, s) => { state.sources.push({ userId, ...s }); return s.id; },
      countDemoUsers: async () => liveDemos,
      recycleOldestDemoUser: async (domain, minAge) => {
        if (oldLeft === 0) return false;
        oldLeft -= 1;
        state.recycled.push({ domain, minAge });
        return true;
      },
    },
  };
  const deps = {
    seedUser: () => seed,
    repos,
    withTransaction: async (fn) => { const r = await fn({ tx: true }); state.committed = true; return r; },
    session: { newSessionToken: () => ({ token: 'tok', tokenHash: 'hash' }), buildBrowserSessionCookie: (t) => `sid=${t}; HttpOnly` },
    newSourceId: () => `src_new${++ids}`,
    newDashboardId: () => `dash_new${++ids}`,
    randomBytes: () => Buffer.from('0123456789', 'hex'),
  };
  return { state, deps };
}

async function withServer(deps, fn) {
  const app = express();
  app.use('/api/demo', CreateDemoRouter(deps));
  app.use(require('../Web/backend/lib/envelope.js').errorMiddleware);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/demo`;
  try {
    await fn(async (method) => {
      const res = await fetch(base, { method });
      return { status: res.status, cookie: res.headers.get('set-cookie'), body: await res.json() };
    });
  } finally {
    server.close();
  }
}

test('GET lists the showcase boards when DEMO_SEED_USER is set', async () => {
  const { deps } = fakeWorld();
  await withServer(deps, async (call) => {
    const res = await call('GET');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { enabled: true, boards: [{ id: 'dash_a', name: 'Homelab Ops' }] });
  });
});

test('the demo is off without a seed user, an unknown seed user, or no public boards', async () => {
  for (const opts of [{ seed: '' }, { seed: 'nobody' }, { boards: [] }]) {
    const { deps, state } = fakeWorld(opts);
    await withServer(deps, async (call) => {
      assert.deepEqual((await call('GET')).body.data, { enabled: false, boards: [] });
      const post = await call('POST');
      assert.equal(post.status, 404);
      assert.equal(post.cookie, null);
    });
    assert.equal(state.users.length, 0);
  }
});

test('POST makes a demo account with copies of the boards and only the sources they read', async () => {
  const { deps, state } = fakeWorld();
  await withServer(deps, async (call) => {
    const res = await call('POST');
    assert.equal(res.status, 201);
    assert.match(res.cookie, /^sid=tok;/);
    assert.equal(res.body.data.dashboards, 1);
    assert.equal(res.body.data.firstDashboardId, state.dashboards[0].id);
  });
  assert.equal(state.committed, true);

  const [user] = state.users;
  assert.ok(libDemo.IsDemoEmail(user.email));
  assert.equal(user.passwordHash, NO_PASSWORD);

  // src_unused isn't on any board, and the showcase's foreign binding has no row to copy
  assert.deepEqual(state.sources.map((s) => s.name).sort(), ['history', 'metrics']);
  assert.ok(state.sources.every((s) => s.userId === 101 && s.id.startsWith('src_new')));
  assert.deepEqual(state.sources.map((s) => s.keyEnc).sort(), ['ENC1', 'ENC2']);

  const copied = state.dashboards[0];
  assert.equal(copied.userId, 101);
  const bound = copied.definition.widgets.flatMap((w) => (w.config.bindings || []).map((b) => b.sourceId));
  const newIds = new Set(state.sources.map((s) => s.id));
  // every binding points at a copied source or is unbound, never at a showcase id
  assert.ok(bound.every((id) => id === '' || newIds.has(id)));
  assert.equal(copied.definition.widgets[3].config.bindings[0].sourceId, '');
  assert.deepEqual(state.sessions, [{ userId: 101, hash: 'hash' }]);
});

test('at the cap, POST replaces the oldest demo that is old enough instead of refusing', async () => {
  const { deps, state } = fakeWorld({ liveDemos: libDemo.MAX_DEMO_ACCOUNTS, oldDemos: 1 });
  await withServer(deps, async (call) => {
    const res = await call('POST');
    assert.equal(res.status, 201);
  });
  assert.deepEqual(state.recycled, [{ domain: 'demo.invalid', minAge: libDemo.DEMO_RECYCLE_MIN_AGE_HOURS }]);
  assert.equal(state.users.length, 1);
});

test('under the cap, POST never deletes anyone', async () => {
  const { deps, state } = fakeWorld({ liveDemos: libDemo.MAX_DEMO_ACCOUNTS - 1, oldDemos: 5 });
  await withServer(deps, async (call) => assert.equal((await call('POST')).status, 201));
  assert.deepEqual(state.recycled, []);
});

test('POST answers 503 at the cap when every live demo is too new to replace', async () => {
  const { deps, state } = fakeWorld({ liveDemos: libDemo.MAX_DEMO_ACCOUNTS });
  await withServer(deps, async (call) => {
    const res = await call('POST');
    assert.equal(res.status, 503);
    assert.equal(res.cookie, null);
  });
  assert.equal(state.users.length, 0);
});

test('demo accounts can never be logged in to, and real signups can never look like one', async () => {
  assert.equal(await verifyPassword('anything', NO_PASSWORD), false);
  assert.equal(await verifyPassword('', NO_PASSWORD), false);
  const id = libDemo.NewDemoIdentity();
  const signup = validateSignup({ username: id.username, email: 'a@b.co', displayName: 'x', password: 'long-enough-pw' });
  assert.equal(signup.ok, false);
  assert.ok(signup.fields.username);
  assert.ok(libDemo.IsDemoEmail(id.email));
  assert.equal(libDemo.IsDemoEmail('someone@example.com'), false);
  assert.equal(libDemo.IsDemoEmail('demo.invalid@example.com'), false);
});

test('mail to a demo (.invalid) address is never sent', async () => {
  let calls = 0;
  const mailer = CreateMailer({ apiKey: 'k', fetch: async () => { calls += 1; return { ok: true, json: async () => ({}) }; }, logger: { log() {}, error() {} } });
  const res = await mailer.sendPasswordReset('demo-ab12@demo.invalid', 'https://x/login?reset=t');
  assert.deepEqual(res, { sent: false });
  assert.equal(calls, 0);
});

// Property: cloning never leaves a binding on an id outside the map's values, never mutates the
// input, and keeps every widget (count, ids, order).
const sourceId = fc.oneof(fc.constant(''), fc.constantFrom('src_a', 'src_b', 'src_c', 'src_d'), fc.string({ maxLength: 6 }));
const widget = fc.record({
  id: fc.string({ minLength: 1, maxLength: 4 }),
  type: fc.constantFrom('kpi', 'line', 'bar', 'text'),
  config: fc.oneof(
    fc.record({ text: fc.string() }),
    fc.record({ bindings: fc.array(fc.record({ sourceId, yField: fc.string({ maxLength: 4 }) }), { maxLength: 3 }) }),
  ),
});
const mapArb = fc.dictionary(fc.constantFrom('src_a', 'src_b', 'src_c'), fc.constantFrom('src_n1', 'src_n2', 'src_n3'));

test('property: CloneDefinition only binds to copied sources and never mutates', () => {
  fc.assert(fc.property(fc.record({ name: fc.string(), widgets: fc.array(widget, { maxLength: 6 }) }), mapArb, (def, map) => {
    const before = JSON.stringify(def);
    const out = libDemo.CloneDefinition(def, map);
    assert.equal(JSON.stringify(def), before);
    assert.deepEqual(out.widgets.map((w) => w.id), def.widgets.map((w) => w.id));
    const allowed = new Set(['', ...Object.values(map)]);
    out.widgets.forEach((w) => (w.config.bindings || []).forEach((b) => {
      if (typeof b.sourceId === 'string') assert.ok(allowed.has(b.sourceId), `leaked ${b.sourceId}`);
    }));
  }));
});

test('a demo session cookie has no Max-Age, so it ends when the browser closes', async () => {
  const session = (await import('../Web/backend/lib/session.js')).default;
  const cookie = session.buildBrowserSessionCookie('tok');
  assert.match(cookie, /^sid=tok; HttpOnly; SameSite=Lax; Path=\//);
  assert.doesNotMatch(cookie, /Max-Age|Expires/i);
  assert.match(session.buildSessionCookie('tok'), /Max-Age=\d+/);
});
