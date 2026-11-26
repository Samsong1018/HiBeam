// APP1 one-command setup: the pure plan (APP1/setup/plan.mjs) against the real template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { SOURCES, NormaliseAgentUrl, SourceRequests, FillTemplate } from '../APP1/setup/plan.mjs';

const TOKEN = 'a'.repeat(48);
const TEMPLATE = await fs.readFile(new URL('../APP1/dashboard.template.json', import.meta.url), 'utf8');

test('every placeholder in the real APP1 template has a source in the plan, and nothing extra', () => {
  const used = new Set([...TEMPLATE.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), Object.keys(SOURCES).sort());
});

test('agent URLs are normalised, and loopback or non-http URLs are refused up front', () => {
  assert.equal(NormaliseAgentUrl('https://ex.example/hibeam-agent/'), 'https://ex.example/hibeam-agent');
  assert.equal(NormaliseAgentUrl(' https://ex.example/a//'), 'https://ex.example/a');
  for (const bad of ['', 'not a url', 'ftp://ex.example/a', 'http://localhost:9480', 'http://127.0.0.1:9480/x', 'http://[::1]/x']) {
    assert.throws(() => NormaliseAgentUrl(bad), undefined, bad);
  }
});

test('source requests carry the URL and token inside the encrypted key, with nginx format for the log', () => {
  const reqs = SourceRequests('https://ex.example/hibeam-agent', TOKEN);
  assert.deepEqual(reqs.map((r) => r.placeholder), ['metrics', 'history', 'services', 'logs']);
  const logs = JSON.parse(reqs[3].body.key);
  assert.deepEqual(logs, { url: 'https://ex.example/hibeam-agent/logs/access', token: TOKEN, format: 'nginx' });
  assert.equal(reqs[3].body.type, 'logs');
  reqs.forEach((r) => assert.ok(!r.body.name.includes(TOKEN)));
  assert.throws(() => SourceRequests('https://ex.example/a', ''), /token/);
  assert.throws(() => SourceRequests('https://ex.example/a', 'short'), /token/);
});

test('FillTemplate binds every widget to a real id and refuses a missing one', () => {
  const ids = { metrics: 'src_m', history: 'src_h', services: 'src_s', logs: 'src_l' };
  const def = FillTemplate(TEMPLATE, ids);
  const bound = def.widgets.flatMap((w) => (w.config?.bindings || []).map((b) => b.sourceId));
  assert.ok(bound.length > 0);
  assert.ok(bound.every((id) => Object.values(ids).includes(id)));
  assert.equal(def.name, 'Homelab Ops');
  assert.throws(() => FillTemplate(TEMPLATE, { ...ids, logs: '' }), /\{\{logs\}\}/);
});
