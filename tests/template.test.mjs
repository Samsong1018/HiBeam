// Unit + property tests for layout templates (Web/frontend/scripts/editor/template.js):
// export a board as a template, import one onto another account.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';

import { slugify, placeholderName, templateSlots, fillTemplate, suggestMapping, toTemplate, parseTemplate, TemplateError } from '../Web/frontend/scripts/editor/template.js';
import { normalizeDashboard } from '../Web/frontend/scripts/editor/model.js';

const APP1 = JSON.parse(readFileSync(new URL('../APP1/dashboard.template.json', import.meta.url), 'utf8'));
const APP2 = JSON.parse(readFileSync(new URL('../APP2/dashboard.template.json', import.meta.url), 'utf8'));

const sourceIdsOf = (def) => def.widgets.flatMap((w) => (w.config?.bindings || []).map((b) => b.sourceId));

test('slugify and placeholderName', () => {
  assert.equal(slugify('Nginx access log'), 'nginx-access-log');
  assert.equal(slugify('  ¡Budget 2026!  '), 'budget-2026');
  assert.equal(slugify(''), 'source');
  assert.equal(placeholderName('{{metrics}}'), 'metrics');
  assert.equal(placeholderName('{{ spending }}'), 'spending');
  assert.equal(placeholderName('src_abc123'), null);
  assert.equal(placeholderName('{{bad slot}}'), null);
});

test('templateSlots lists each APP1 placeholder once, in first-use order, with the fields it feeds', () => {
  const slots = templateSlots(APP1);
  assert.deepEqual(slots.map((s) => s.label), ['metrics', 'history', 'services', 'logs']);
  assert.ok(slots.every((s) => s.placeholder));
  const metrics = slots.find((s) => s.label === 'metrics');
  assert.ok(metrics.fields.includes('cpuPct'));
  assert.ok(metrics.fields.includes('sampledAt'), 'the quiet check column counts as a field the slot needs');
  assert.equal(metrics.widgets, 4);
});

test('templateSlots skips sources this account already has', () => {
  const def = { widgets: [{ id: 'a', type: 'kpi', config: { bindings: [{ sourceId: 'mine', yField: 'v' }] } },
    { id: 'b', type: 'kpi', config: { bindings: [{ sourceId: 'theirs', yField: 'v' }] } }] };
  const slots = templateSlots(def, ['mine']);
  assert.deepEqual(slots.map((s) => s.key), ['theirs']);
  assert.equal(slots[0].placeholder, false);
});

test('fillTemplate maps slots, empties unmapped ones, keeps known ids, and does not mutate', () => {
  const before = JSON.stringify(APP2);
  const filled = fillTemplate(APP2, { '{{budget}}': 'src_budget' }, []);
  assert.equal(JSON.stringify(APP2), before);
  const ids = new Set(sourceIdsOf(filled));
  assert.ok(ids.has('src_budget'));
  assert.ok(ids.has(''), 'unmapped placeholders become unbound');
  assert.ok(![...ids].some((id) => id.startsWith('{{')), 'no placeholder survives');
  const kept = fillTemplate({ widgets: [{ id: 'a', type: 'kpi', config: { bindings: [{ sourceId: 'mine' }] } }] }, {}, ['mine']);
  assert.equal(sourceIdsOf(kept)[0], 'mine');
});

test('suggestMapping matches by name and never reuses a source', () => {
  const slots = templateSlots(APP1);
  const mapping = suggestMapping(slots, [{ id: 's1', name: 'Metrics' }, { id: 's2', name: 'History' }, { id: 's3', name: 'Something else' }]);
  assert.deepEqual(mapping, { '{{metrics}}': 's1', '{{history}}': 's2' });
  const dupes = suggestMapping([{ key: 'a', label: 'x' }, { key: 'b', label: 'x' }], [{ id: 's', name: 'X' }]);
  assert.deepEqual(dupes, { a: 's' });
});

test('toTemplate swaps ids for name slugs and dedupes clashing names', () => {
  const def = { name: 'B', widgets: [
    { id: 'a', type: 'kpi', config: { bindings: [{ sourceId: 'id1', yField: 'v' }] } },
    { id: 'b', type: 'line', config: { bindings: [{ sourceId: 'id2', xField: 't', yField: 'v' }, { sourceId: 'id1', xField: 't', yField: 'w' }] } },
    { id: 'c', type: 'kpi', config: { bindings: [{ sourceId: 'id3', yField: 'v' }] } },
    { id: 'd', type: 'text', config: { body: 'hi' } },
  ] };
  const names = { id1: 'Metrics', id2: 'Metrics', id3: null };
  const { definition, sources } = toTemplate(def, (id) => names[id]);
  assert.deepEqual(sourceIdsOf(definition), ['{{metrics}}', '{{metrics-2}}', '{{metrics}}', '{{source-3}}']);
  assert.deepEqual(sources, { metrics: 'Metrics', 'metrics-2': 'Metrics', 'source-3': null });
  assert.equal(definition.widgets[3].config.body, 'hi');
});

test('property: export then import with the inverse mapping gives back the original bindings', () => {
  const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/);
  fc.assert(fc.property(
    fc.array(fc.array(idArb, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 8 }),
    fc.dictionary(idArb, fc.string({ maxLength: 20 })),
    (bindingIds, names) => {
      const def = { name: 'x', widgets: bindingIds.map((ids, i) => ({ id: `w${i}`, type: 'line', config: { bindings: ids.map((sourceId) => ({ sourceId, xField: 't', yField: 'v' })) } })) };
      const { definition } = toTemplate(def, (id) => (Object.hasOwn(names, id) ? names[id] : null));
      // rebuild the inverse: placeholder -> original id, in first-use order
      const inverse = {};
      sourceIdsOf(def).forEach((id, i) => { inverse[sourceIdsOf(definition)[i]] = id; });
      const back = fillTemplate(definition, inverse);
      return JSON.stringify(sourceIdsOf(back)) === JSON.stringify(sourceIdsOf(def));
    },
  ));
});

test('round trip through normalizeDashboard keeps the APP templates intact', () => {
  [APP1, APP2].forEach((tpl) => {
    const dash = normalizeDashboard(tpl);
    assert.equal(dash.widgets.length, tpl.widgets.length, 'every widget type is known');
    const exported = toTemplate(dash, () => null).definition;
    assert.deepEqual(templateSlots(exported).map((s) => s.label), templateSlots(tpl).map((s) => s.label));
  });
});

test('parseTemplate: bare definitions, API envelopes, and friendly errors', () => {
  assert.equal(parseTemplate(JSON.stringify(APP1)).name, 'Homelab Ops');
  assert.equal(parseTemplate(JSON.stringify({ id: 'd', definition: APP2 })).name, APP2.name);
  const bad = ['', '   ', '{nope', '[]', '{"name":"x"}', 'null', '42'];
  bad.forEach((text) => assert.throws(() => parseTemplate(text), TemplateError, JSON.stringify(text)));
  assert.throws(() => parseTemplate(`{"widgets":[],"pad":"${'x'.repeat(1024 * 1024)}"}`), /over 1 MB/);
});
