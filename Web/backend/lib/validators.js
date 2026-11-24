'use strict';
// Pure input validators. Each returns { ok: true, value } or { ok: false, fields: { name: message } }.
const { z } = require('zod');

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_EMAIL = 254;
const MAX_DISPLAY_NAME = 60;
const MAX_PASSWORD_BYTES = 72;
const MIN_NEW_PASSWORD_BYTES = 10;

const CHART_TYPES = ['line', 'bar', 'pie', 'kpi', 'table'];
const SOURCE_TYPES = ['excel', 'scrape', 'logs', 'rest', 'sql', 'json', 'csv', 'prometheus'];
const WIDGET_TYPE_IDS = ['line', 'bar', 'pie', 'kpi', 'gauge', 'status', 'table', 'text', 'label'];
const GRID_COLUMNS = [24, 48, 72, 96];

const isString = (v) => typeof v === 'string';
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const okResult = (value) => ({ ok: true, value });
const failResult = (fields) => ({ ok: false, fields });

// ---- field checkers: return { value } or { error } ----

function checkUsername(v) {
  if (!isString(v)) return { error: 'Username is required' };
  const value = v.trim().toLowerCase();
  if (!USERNAME_RE.test(value)) return { error: 'Username must be 3-24 characters: a-z, 0-9, underscore' };
  return { value };
}

function checkEmail(v) {
  if (!isString(v)) return { error: 'Email is required' };
  const value = v.trim().toLowerCase();
  if (value.length === 0) return { error: 'Email is required' };
  if (value.length > MAX_EMAIL) return { error: `Email must be at most ${MAX_EMAIL} characters` };
  if (!EMAIL_RE.test(value)) return { error: 'Email is not valid' };
  return { value };
}

function checkDisplayName(v) {
  if (!isString(v)) return { error: 'Display name is required' };
  const value = v.trim();
  if (value.length < 1 || value.length > MAX_DISPLAY_NAME) {
    return { error: `Display name must be 1-${MAX_DISPLAY_NAME} characters` };
  }
  return { value };
}

// New password: 10 to 72 bytes, not trimmed.
function checkNewPassword(v) {
  if (!isString(v) || v.length === 0) return { error: 'Password is required' };
  const n = bytes(v);
  if (n > MAX_PASSWORD_BYTES) return { error: `Password must be at most ${MAX_PASSWORD_BYTES} bytes` };
  if (n < MIN_NEW_PASSWORD_BYTES) return { error: `Password must be at least ${MIN_NEW_PASSWORD_BYTES} characters` };
  return { value: v };
}

// Existing password: 1 to 72 bytes.
function checkExistingPassword(v) {
  if (!isString(v) || v.length === 0) return { error: 'Password is required' };
  if (bytes(v) > MAX_PASSWORD_BYTES) return { error: `Password must be at most ${MAX_PASSWORD_BYTES} bytes` };
  return { value: v };
}

// Runs a map of { field: checker(body[field]) } and builds the combined result.
function run(body, checks) {
  const src = isPlainObject(body) ? body : {};
  const value = {};
  const fields = {};
  for (const [name, check] of Object.entries(checks)) {
    const r = check(src[name]);
    if ('error' in r) fields[name] = r.error;
    else value[name] = r.value;
  }
  return Object.keys(fields).length ? failResult(fields) : okResult(value);
}

function single(name, check, v) {
  const r = check(v);
  return 'error' in r ? failResult({ [name]: r.error }) : okResult(r.value);
}

// ---- public validators ----

const validateUsername = (v) => single('username', checkUsername, v);
const validateEmail = (v) => single('email', checkEmail, v);
const validateDisplayName = (v) => single('displayName', checkDisplayName, v);
const validateNewPassword = (v) => single('password', checkNewPassword, v);

function validateSignup(body) {
  return run(body, {
    username: checkUsername,
    email: checkEmail,
    displayName: checkDisplayName,
    password: checkNewPassword,
  });
}

function validateLogin(body) {
  return run(body, {
    identifier: (v) => {
      if (!isString(v)) return { error: 'Identifier is required' };
      const value = v.trim().toLowerCase();
      if (value.length < 1 || value.length > MAX_EMAIL) return { error: `Identifier must be 1-${MAX_EMAIL} characters` };
      return { value };
    },
    password: checkExistingPassword,
  });
}

function validateProfile(body) {
  return run(body, { displayName: checkDisplayName, username: checkUsername });
}

function validatePreferences(body) {
  return run(body, {
    defaultChart: (v) => (isString(v) && CHART_TYPES.includes(v)
      ? { value: v }
      : { error: `defaultChart must be one of: ${CHART_TYPES.join(', ')}` }),
    refreshRate: (v) => (Number.isInteger(v) && v >= 0 && v <= 86400
      ? { value: v }
      : { error: 'refreshRate must be an integer from 0 to 86400' }),
  });
}

function validateChangePassword(body) {
  const r = run(body, { currentPassword: checkExistingPassword, newPassword: checkNewPassword });
  if (!r.ok) return r;
  if (r.value.newPassword === r.value.currentPassword) {
    return failResult({ newPassword: 'New password must differ from the current password' });
  }
  return r;
}

function validateChangeEmail(body) {
  return run(body, { newEmail: checkEmail, password: checkExistingPassword });
}

function validateSourceInput(body) {
  return run(body, {
    name: (v) => {
      if (!isString(v)) return { error: 'Name is required' };
      const value = v.trim();
      if (value.length < 1 || value.length > 100) return { error: 'Name must be 1-100 characters' };
      return { value };
    },
    type: (v) => (isString(v) && SOURCE_TYPES.includes(v)
      ? { value: v }
      : { error: `type must be one of: ${SOURCE_TYPES.join(', ')}` }),
    key: (v) => {
      if (!isString(v) || v.length === 0) return { error: 'Key is required' };
      // room for a SQL query or scrape selector alongside the connection details
      if (v.length > 8192) return { error: 'Key must be at most 8192 characters' };
      return { value: v };
    },
  });
}

function isValidId(id) {
  return isString(id) && ID_RE.test(id);
}

// ---- dashboard definition ----

const BOARD_THEMES = ['kiroween'];

const bindingSchema = z.object({
  sourceId: z.string().max(64),
  xField: z.string().max(120).optional(),
  yField: z.string().max(120).optional(),
  agg: z.string().max(10).optional(),
  // bar charts: draw this series as bars (default) or as a line over them
  as: z.enum(['bar', 'line']).optional(),
}).strict();

const widgetSchema = z.object({
  id: z.string().regex(ID_RE),
  type: z.enum(WIDGET_TYPE_IDS),
  x: z.number().int().min(0).max(10000),
  y: z.number().int().min(0).max(10000),
  w: z.number().int().min(1).max(1000),
  h: z.number().int().min(1).max(1000),
  config: z.object({ bindings: z.array(bindingSchema).max(6).optional() }).passthrough(),
}).strict();

const dashboardSchema = z.object({
  name: z.string().min(1).max(120),
  grid: z.object({
    columns: z.union(GRID_COLUMNS.map((c) => z.literal(c))),
    showGrid: z.boolean(),
  }).strict(),
  widgets: z.array(widgetSchema).max(200),
  // optional board theme; absent = follow each viewer's own light/dark setting
  theme: z.enum(BOARD_THEMES).optional(),
}).strict();

function validateDashboardDefinition(def) {
  const parsed = dashboardSchema.safeParse(def);
  if (parsed.success) return okResult(parsed.data);
  const fields = {};
  for (const issue of parsed.error.issues) {
    let path = issue.path.join('.');
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      path = [path, issue.keys.join(', ')].filter(Boolean).join('.');
    }
    const key = path || 'definition';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return failResult(fields);
}

// Distinct non-empty source ids referenced by widget bindings.
function collectSourceIds(def) {
  const ids = new Set();
  const widgets = isPlainObject(def) && Array.isArray(def.widgets) ? def.widgets : [];
  for (const w of widgets) {
    const bindings = isPlainObject(w) && isPlainObject(w.config) && Array.isArray(w.config.bindings)
      ? w.config.bindings : [];
    for (const b of bindings) {
      if (isPlainObject(b) && isString(b.sourceId) && b.sourceId !== '') ids.add(b.sourceId);
    }
  }
  return [...ids];
}

module.exports = {
  validateSignup,
  validateLogin,
  validateEmail,
  validateUsername,
  validateDisplayName,
  validateNewPassword,
  validateProfile,
  validatePreferences,
  validateChangePassword,
  validateChangeEmail,
  validateSourceInput,
  isValidId,
  validateDashboardDefinition,
  collectSourceIds,
};
