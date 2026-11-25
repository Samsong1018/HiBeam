// Transactional email (Resend) and the two routes that send it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { CreateMailer, RESEND_URL, DEFAULT_FROM } = require('../Web/backend/lib/mailer.js');
const { CreateAuthRouter } = require('../Web/backend/lib/routes/auth.js');
const { CreateAccountRouter, CreateEmailConfirmRouter } = require('../Web/backend/lib/routes/account.js');

const quiet = { log() {}, error() {} };

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fn, calls };
}

const okResponse = { ok: true, status: 200, json: async () => ({ id: 'x' }) };

async function withApp(app, fn) {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---- mailer ----

test('with no API key the mailer is disabled and logs the link instead of sending', async () => {
  const lines = [];
  const f = fakeFetch(okResponse);
  const mailer = CreateMailer({ apiKey: '', fetch: f.fn, logger: { log: (m) => lines.push(m) } });
  assert.equal(mailer.enabled, false);
  const out = await mailer.sendPasswordReset('a@example.com', 'https://h.test/login?reset=abc');
  assert.deepEqual(out, { sent: false });
  assert.equal(f.calls.length, 0);
  assert.match(lines[0], /reset=abc/);
});

test('sends to Resend with bearer auth, the sender, and both html and text bodies', async () => {
  const f = fakeFetch(okResponse);
  const mailer = CreateMailer({ apiKey: 're_test', fetch: f.fn, logger: quiet });
  assert.equal(mailer.enabled, true);
  await mailer.sendEmailConfirm('new@example.com', 'https://h.test/login?token=t1');
  const [call] = f.calls;
  assert.equal(call.url, RESEND_URL);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer re_test');
  assert.equal(call.body.from, DEFAULT_FROM);
  assert.deepEqual(call.body.to, ['new@example.com']);
  assert.match(call.body.subject, /Confirm/);
  assert.match(call.body.html, /href="https:\/\/h\.test\/login\?token=t1"/);
  assert.match(call.body.text, /https:\/\/h\.test\/login\?token=t1/);
});

test('MAIL_FROM-style override is used as the sender', async () => {
  const f = fakeFetch(okResponse);
  const mailer = CreateMailer({ apiKey: 're_test', from: 'X <x@somab.dev>', fetch: f.fn, logger: quiet });
  await mailer.sendPasswordReset('a@example.com', 'https://h.test/');
  assert.equal(f.calls[0].body.from, 'X <x@somab.dev>');
});

test('the link is HTML-escaped in the html body', async () => {
  const f = fakeFetch(okResponse);
  const mailer = CreateMailer({ apiKey: 're_test', fetch: f.fn, logger: quiet });
  await mailer.sendPasswordReset('a@example.com', 'https://h.test/"><script>x</script>');
  assert.doesNotMatch(f.calls[0].body.html, /<script>/);
  assert.match(f.calls[0].body.html, /&quot;&gt;&lt;script&gt;/);
});

test('a Resend error rejects without leaking the key or the link', async () => {
  const f = fakeFetch({ ok: false, status: 403, json: async () => ({ name: 'validation_error', message: 'domain not verified' }) });
  const mailer = CreateMailer({ apiKey: 're_secret', fetch: f.fn, logger: quiet });
  await assert.rejects(mailer.sendPasswordReset('a@example.com', 'https://h.test/login?reset=tok123'), (err) => {
    assert.match(err.message, /HTTP 403 validation_error/);
    assert.doesNotMatch(err.message, /re_secret|tok123/);
    return true;
  });
});

test('a network error rejects with a short message', async () => {
  const f = fakeFetch(Object.assign(new Error('connect ECONNREFUSED'), { name: 'TypeError' }));
  const mailer = CreateMailer({ apiKey: 're_secret', fetch: f.fn, logger: quiet });
  await assert.rejects(mailer.sendEmailConfirm('a@example.com', 'https://h.test/'), /mail send failed \(emailConfirm\): TypeError/);
});

// ---- forgot-password ----

function authApp({ user, mailer, logger = quiet }) {
  const repos = {
    users: { findByIdentifier: async () => user },
    tokens: { invalidateUnusedReset: async () => {}, createReset: async () => {} },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/auth', CreateAuthRouter({
    repos, mailer, logger, baseUrl: 'https://h.test', withTransaction: async (fn) => fn({}),
  }));
  return app;
}

test('forgot-password mails a /login?reset= link to the address on file', async () => {
  const sent = [];
  const mailer = { sendPasswordReset: async (to, url) => { sent.push({ to, url }); } };
  await withApp(authApp({ user: { id: 7, email: 'Owner@Example.com' }, mailer }), async (base) => {
    const res = await post(base, '/api/auth/forgot-password', { email: 'owner@example.com' });
    assert.equal(res.status, 200);
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'Owner@Example.com');
  assert.match(sent[0].url, /^https:\/\/h\.test\/login\?reset=[A-Za-z0-9_-]+$/);
});

test('forgot-password sends nothing for an unknown address and gives the same reply', async () => {
  const sent = [];
  const mailer = { sendPasswordReset: async (to) => { sent.push(to); } };
  let known;
  let unknown;
  await withApp(authApp({ user: { id: 7, email: 'a@example.com' }, mailer }), async (base) => {
    known = await (await post(base, '/api/auth/forgot-password', { email: 'a@example.com' })).json();
  });
  await withApp(authApp({ user: null, mailer }), async (base) => {
    unknown = await (await post(base, '/api/auth/forgot-password', { email: 'b@example.com' })).json();
  });
  assert.deepEqual(known, unknown);
  assert.equal(sent.length, 1);
});

test('forgot-password still answers 200 when the mail send fails, and logs it', async () => {
  const errors = [];
  const mailer = { sendPasswordReset: async () => { throw new Error('mail send failed (passwordReset): HTTP 500'); } };
  const logger = { log() {}, error: (m) => errors.push(m) };
  await withApp(authApp({ user: { id: 7, email: 'a@example.com' }, mailer, logger }), async (base) => {
    const res = await post(base, '/api/auth/forgot-password', { email: 'a@example.com' });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /HTTP 500/);
});

// ---- change email ----

function accountApp({ mailer, logger = quiet }) {
  const repos = {
    users: { getPasswordHash: async () => 'h', emailExists: async () => false },
    tokens: { createEmail: async () => {} },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.userId = 1; next(); });
  app.use('/api/account', CreateAccountRouter({
    repos, mailer, logger, baseUrl: 'https://h.test',
    passwords: { verifyPassword: async () => true, hashPassword: async () => 'h' },
  }));
  return app;
}

test('change-email mails a /login?token= link to the new address', async () => {
  const sent = [];
  const mailer = { sendEmailConfirm: async (to, url) => { sent.push({ to, url }); } };
  await withApp(accountApp({ mailer }), async (base) => {
    const res = await post(base, '/api/account/email', { newEmail: 'new@example.com', password: 'correct horse battery' });
    assert.equal(res.status, 200);
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'new@example.com');
  assert.match(sent[0].url, /^https:\/\/h\.test\/login\?token=[A-Za-z0-9_-]+$/);
});

test('change-email answers 502 when the mail send fails', async () => {
  const mailer = { sendEmailConfirm: async () => { throw new Error('mail send failed'); } };
  await withApp(accountApp({ mailer }), async (base) => {
    const res = await post(base, '/api/account/email', { newEmail: 'new@example.com', password: 'correct horse battery' });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /confirmation email/);
  });
});

// ---- security notices ----

const tick = () => new Promise((r) => setTimeout(r, 20));

test('notice templates send a login link to the given address', async () => {
  const f = fakeFetch(okResponse);
  const mailer = CreateMailer({ apiKey: 're_test', fetch: f.fn, logger: quiet });
  await mailer.sendPasswordChanged('a@example.com', 'https://h.test/login');
  await mailer.sendEmailChanged('old@example.com', 'https://h.test/login');
  assert.match(f.calls[0].body.subject, /password was changed/);
  assert.deepEqual(f.calls[1].body.to, ['old@example.com']);
  assert.match(f.calls[1].body.subject, /email was changed/);
  assert.match(f.calls[1].body.html, /href="https:\/\/h\.test\/login"/);
});

function resetApp({ mailer, consumed, logger = quiet, getEmail = async () => 'owner@example.com' }) {
  const repos = {
    users: { setPasswordHash: async () => {}, getEmail },
    sessions: { revokeAll: async () => {} },
    tokens: { consumeReset: async () => consumed },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/auth', CreateAuthRouter({
    repos, mailer, logger, baseUrl: 'https://h.test', withTransaction: async (fn) => fn({}),
    passwords: { hashPassword: async () => 'h' },
  }));
  return app;
}

test('a completed password reset notifies the address on file', async () => {
  const sent = [];
  const mailer = { sendPasswordChanged: async (to, url) => { sent.push({ to, url }); } };
  await withApp(resetApp({ mailer, consumed: { consumed: true, userId: 7 } }), async (base) => {
    const res = await post(base, '/api/auth/reset-password', { token: 'tok', password: 'a long enough passphrase' });
    assert.equal(res.status, 200);
    await tick();
  });
  assert.deepEqual(sent, [{ to: 'owner@example.com', url: 'https://h.test/login' }]);
});

test('a rejected reset token sends no notice', async () => {
  const sent = [];
  const mailer = { sendPasswordChanged: async (to) => { sent.push(to); } };
  await withApp(resetApp({ mailer, consumed: { consumed: false } }), async (base) => {
    const res = await post(base, '/api/auth/reset-password', { token: 'tok', password: 'a long enough passphrase' });
    assert.equal(res.status, 400);
    await tick();
  });
  assert.equal(sent.length, 0);
});

test('a failing notice is logged and the reset still succeeds', async () => {
  const errors = [];
  const mailer = { sendPasswordChanged: async () => { throw new Error('mail send failed (passwordChanged): HTTP 500'); } };
  const logger = { log() {}, error: (m) => errors.push(m) };
  await withApp(resetApp({ mailer, logger, consumed: { consumed: true, userId: 7 } }), async (base) => {
    const res = await post(base, '/api/auth/reset-password', { token: 'tok', password: 'a long enough passphrase' });
    assert.equal(res.status, 200);
    await tick();
  });
  assert.equal(errors.length, 1);
});

function noticeAccountApp({ mailer, repos, logger = quiet }) {
  const app = express();
  app.use(express.json());
  const deps = {
    repos, mailer, logger, baseUrl: 'https://h.test', withTransaction: async (fn) => fn({}),
    passwords: { verifyPassword: async () => true, hashPassword: async () => 'h' },
  };
  app.use('/api/account', CreateEmailConfirmRouter(deps));
  app.use((req, res, next) => { req.userId = 1; req.sessionId = 's'; next(); });
  app.use('/api/account', CreateAccountRouter(deps));
  return app;
}

test('changing the password notifies the account email', async () => {
  const sent = [];
  const mailer = { sendPasswordChanged: async (to) => { sent.push(to); } };
  const repos = {
    users: { getPasswordHash: async () => 'h', setPasswordHash: async () => {}, getEmail: async () => 'me@example.com' },
    sessions: { revokeAllExcept: async () => {} },
  };
  await withApp(noticeAccountApp({ mailer, repos }), async (base) => {
    const res = await post(base, '/api/account/password', {
      currentPassword: 'old passphrase here', newPassword: 'new passphrase here',
    });
    assert.equal(res.status, 200);
    await tick();
  });
  assert.deepEqual(sent, ['me@example.com']);
});

test('confirming a new email notifies the OLD address, read before the change', async () => {
  const sent = [];
  let current = 'old@example.com';
  const mailer = { sendEmailChanged: async (to) => { sent.push(to); } };
  const repos = {
    users: {
      emailExists: async () => false,
      getEmail: async () => current,
      setEmail: async (id, email) => { current = email; },
    },
    tokens: { consumeEmail: async () => ({ consumed: true, userId: 1, newEmail: 'new@example.com' }) },
  };
  await withApp(noticeAccountApp({ mailer, repos }), async (base) => {
    const res = await fetch(`${base}/api/account/email/confirm?token=tok`);
    assert.equal(res.status, 200);
    await tick();
  });
  assert.equal(current, 'new@example.com');
  assert.deepEqual(sent, ['old@example.com']);
});

test('an email confirm that loses to another user sends no notice', async () => {
  const sent = [];
  const mailer = { sendEmailChanged: async (to) => { sent.push(to); } };
  const repos = {
    users: { emailExists: async () => true, getEmail: async () => 'old@example.com', setEmail: async () => {} },
    tokens: { consumeEmail: async () => ({ consumed: true, userId: 1, newEmail: 'taken@example.com' }) },
  };
  await withApp(noticeAccountApp({ mailer, repos }), async (base) => {
    const res = await fetch(`${base}/api/account/email/confirm?token=tok`);
    assert.equal(res.status, 409);
    await tick();
  });
  assert.equal(sent.length, 0);
});
