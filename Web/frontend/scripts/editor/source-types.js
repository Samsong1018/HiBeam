// ============================================================
// SOURCE TYPES
// The connection fields for each input type, and how they're packed into the
// one encrypted key string the backend stores.
// ============================================================

// `secret: true` fields are sent to the server once and never kept in the browser.
export const SOURCE_TYPES = [
  {
    id: 'excel',
    label: 'Excel',
    short: 'XLS',
    fields: [
      { name: 'file', label: 'Workbook (.xlsx or .csv, up to 5 MB)', type: 'file', accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { name: 'sheet', label: 'Sheet', type: 'text', placeholder: 'first sheet', optional: true },
    ],
  },
  {
    id: 'scrape',
    label: 'Web scraping',
    short: 'WEB',
    fields: [
      { name: 'url', label: 'Page URL', type: 'url', placeholder: 'https://example.com/pricing' },
      { name: 'selector', label: 'CSS selector', type: 'text', placeholder: 'table.prices tr' },
    ],
  },
  {
    id: 'logs',
    label: 'System logs',
    short: 'LOG',
    fields: [
      // A URL the server fetches, never a path on the server itself: that would let any
      // account read the host's files.
      { name: 'url', label: 'Log file URL', type: 'url', placeholder: 'https://logs.example.com/access.log' },
      { name: 'format', label: 'Format', type: 'select', options: ['json', 'nginx', 'apache', 'syslog'] },
      { name: 'auth', label: 'Auth header', type: 'password', placeholder: 'Bearer …', optional: true, secret: true },
    ],
  },
  {
    id: 'rest',
    label: 'REST API',
    short: 'API',
    fields: [
      { name: 'url', label: 'Endpoint URL', type: 'url', placeholder: 'https://api.example.com/v1/stats' },
      { name: 'auth', label: 'Auth header', type: 'password', placeholder: 'Bearer …', optional: true, secret: true },
    ],
  },
  {
    id: 'sql',
    label: 'SQL',
    short: 'SQL',
    fields: [
      { name: 'connection', label: 'MySQL connection string', type: 'password', placeholder: 'mysql://readonly:pass@db.example.com:3306/shop', secret: true },
      { name: 'query', label: 'Query', type: 'textarea', placeholder: 'SELECT day, COUNT(*) AS orders FROM orders GROUP BY day' },
    ],
  },
  {
    id: 'json',
    label: 'JSON',
    short: 'JSN',
    fields: [
      { name: 'url', label: 'JSON URL', type: 'url', placeholder: 'https://example.com/data.json' },
      { name: 'path', label: 'Array path', type: 'text', placeholder: 'data.items', optional: true },
    ],
  },
];

export const SOURCE_TYPE_BY_ID = Object.fromEntries(SOURCE_TYPES.map((t) => [t.id, t]));

// The backend stores one encrypted `key` string per source, read as JSON by the
// connector: { url, token, path } for rest/json, { url, selector } for scrape,
// { url, format, token } for logs, { connection, query } for sql, { sheet } for
// excel (the file itself is uploaded separately). `auth` becomes a bearer token.
export function packSourceKey(type, config = {}) {
  const { auth, ...rest } = config;
  const token = typeof auth === 'string' ? auth.trim().replace(/^Bearer\s+/i, '') : '';
  return JSON.stringify(token ? { ...rest, token } : rest);
}
