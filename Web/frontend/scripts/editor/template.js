// ============================================================
// TEMPLATES
// Pure functions, no DOM: turn a board into a shareable template
// and back. Covered by tests/template.test.mjs.
//
// A template is an ordinary dashboard definition (the same shape as
// APP1/ and APP2/'s dashboard.template.json) whose binding sourceIds
// are placeholders like "{{metrics}}". Importing one maps each
// placeholder, or any source id this account doesn't have, to one of
// the account's sources. Leaving a slot unmapped is allowed: those
// widgets come in empty and get bound in the editor.
// ============================================================

export const MAX_TEMPLATE_BYTES = 1024 * 1024;
const PLACEHOLDER = /^\{\{\s*([A-Za-z0-9_.-]{1,40})\s*\}\}$/;

/** "Nginx access log" → "nginx-access-log" */
export function slugify(name) {
  const slug = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'source';
}

/** "{{metrics}}" → "metrics", anything else → null */
export function placeholderName(sourceId) {
  const match = PLACEHOLDER.exec(String(sourceId ?? ''));
  return match ? match[1] : null;
}

const bindingsOf = (def) => (Array.isArray(def?.widgets) ? def.widgets : [])
  .flatMap((w) => (Array.isArray(w?.config?.bindings) ? w.config.bindings.map((b) => ({ widget: w, binding: b })) : []));

function fieldsUsed(widget, binding) {
  const c = widget.config || {};
  return [binding.xField, binding.agg === 'count' ? '' : binding.yField,
    ...(widget.type === 'table' && Array.isArray(c.columns) ? c.columns : []),
    Number(c.quietAfter) > 0 ? c.quietField : '']
    .filter((f) => typeof f === 'string' && f);
}

/**
 * The sources a template needs, in first-use order:
 * [{ key, label, placeholder: boolean, widgets: number, fields: string[] }]
 * `knownIds` are this account's source ids; bindings to them need no mapping.
 */
export function templateSlots(def, knownIds = []) {
  const known = new Set(knownIds);
  const slots = new Map();
  bindingsOf(def).forEach(({ widget, binding }) => {
    const key = binding?.sourceId;
    if (typeof key !== 'string' || !key || known.has(key)) return;
    const name = placeholderName(key);
    if (!slots.has(key)) slots.set(key, { key, label: name || key, placeholder: Boolean(name), widgetIds: new Set(), fields: new Set() });
    const slot = slots.get(key);
    slot.widgetIds.add(widget.id);
    fieldsUsed(widget, binding).forEach((f) => slot.fields.add(f));
  });
  return [...slots.values()].map(({ widgetIds, fields, ...rest }) => ({ ...rest, widgets: widgetIds.size, fields: [...fields] }));
}

/**
 * A new definition with each slot key swapped for mapping[key].
 * Keys missing from the mapping become '' (an unbound widget). Known ids
 * pass through. The input is not mutated.
 */
export function fillTemplate(def, mapping = {}, knownIds = []) {
  const known = new Set(knownIds);
  const pick = (id) => {
    if (typeof id !== 'string' || !id || known.has(id)) return id;
    return typeof mapping[id] === 'string' ? mapping[id] : '';
  };
  return {
    ...def,
    widgets: (Array.isArray(def?.widgets) ? def.widgets : []).map((w) => (Array.isArray(w?.config?.bindings)
      ? { ...w, config: { ...w.config, bindings: w.config.bindings.map((b) => ({ ...b, sourceId: pick(b.sourceId) })) } }
      : w)),
  };
}

/**
 * Guess a mapping from source names: a slot "metrics" matches a source
 * called "Metrics" or "metrics". Never maps two slots to one source by guess.
 */
export function suggestMapping(slots, sources) {
  const used = new Set();
  const mapping = {};
  slots.forEach((slot) => {
    const want = slugify(slot.label);
    const match = sources.find((s) => !used.has(s.id) && slugify(s.name) === want);
    if (match) {
      mapping[slot.key] = match.id;
      used.add(match.id);
    }
  });
  return mapping;
}

/**
 * Swap every bound source id for "{{slug-of-its-name}}", so the layout can
 * be imported on another account. `nameOf(id)` gives a source's display
 * name, or null. Returns { definition, sources: { slug: name } }.
 */
export function toTemplate(def, nameOf = () => null) {
  const slugById = new Map();
  const taken = new Map(); // slug -> count
  const sources = {};
  bindingsOf(def).forEach(({ binding }) => {
    const id = binding?.sourceId;
    if (typeof id !== 'string' || !id || slugById.has(id)) return;
    if (placeholderName(id)) { slugById.set(id, placeholderName(id)); return; }
    const name = nameOf(id);
    const base = slugify(name || `source-${slugById.size + 1}`);
    const n = (taken.get(base) || 0) + 1;
    taken.set(base, n);
    const slug = n === 1 ? base : `${base}-${n}`;
    slugById.set(id, slug);
    sources[slug] = name || null;
  });
  const definition = fillTemplate(def, Object.fromEntries([...slugById].map(([id, slug]) => [id, `{{${slug}}}`])));
  return { definition, sources };
}

export class TemplateError extends Error {}

/** Parse an uploaded file's text. Throws TemplateError with a message fit for the page. */
export function parseTemplate(text) {
  if (typeof text !== 'string' || !text.trim()) throw new TemplateError('That file is empty.');
  if (text.length > MAX_TEMPLATE_BYTES) throw new TemplateError('That file is over 1 MB, which is too big for a board layout.');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new TemplateError('That file isn\'t valid JSON.');
  }
  // accept a bare definition, or { definition } as the API and MCP return it
  const def = raw && typeof raw === 'object' && raw.definition && typeof raw.definition === 'object' ? raw.definition : raw;
  if (!def || typeof def !== 'object' || Array.isArray(def) || !Array.isArray(def.widgets)) {
    throw new TemplateError('That JSON isn\'t a HiBeam board. A board has a "widgets" list.');
  }
  return def;
}
