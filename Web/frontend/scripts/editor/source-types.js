// ============================================================
// SOURCE TYPES + MOCK DATA
// The connection fields for each planned input type, plus fake rows so
// the editor has something to chart before the server can fetch real data.
// Delete mockRowsFor() once GET /api/sources/:id/preview exists.
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

// ------------------------------------------------------------
// Mock rows: deterministic per source id so charts don't jump on reload
// ------------------------------------------------------------
function seededRandom(seedText) {
  let seed = [...String(seedText)].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const REGIONS = ['North', 'South', 'East', 'West'];

const GENERATORS = {
  excel: (rand) => MONTHS.flatMap((month, i) => REGIONS.map((region) => ({
    month,
    region,
    revenue: Math.round(8000 + i * 650 + rand() * 4000),
    units: Math.round(120 + i * 9 + rand() * 60),
  }))),
  scrape: (rand) => ['Starter', 'Basic', 'Pro', 'Team', 'Business', 'Enterprise'].map((product, i) => ({
    product,
    price: Math.round((9 + i * 14 + rand() * 6) * 100) / 100,
    rating: Math.round((3.4 + rand() * 1.6) * 10) / 10,
    reviews: Math.round(40 + rand() * 900),
  })),
  logs: (rand) => Array.from({ length: 24 }, (_, hour) => {
    const requests = Math.round(400 + Math.sin((hour - 6) / 3.8) * 300 + rand() * 120 + 300);
    return {
      hour: `${String(hour).padStart(2, '0')}:00`,
      level: rand() > 0.85 ? 'error' : 'info',
      requests,
      errors: Math.round(requests * (0.005 + rand() * 0.02)),
      p95_ms: Math.round(140 + rand() * 160),
    };
  }),
  rest: (rand) => Array.from({ length: 14 }, (_, i) => ({
    date: `Nov ${i + 1}`,
    stars: Math.round(1200 + i * 35 + rand() * 30),
    forks: Math.round(140 + i * 4 + rand() * 6),
    open_issues: Math.round(30 + rand() * 20),
  })),
  sql: (rand) => DAYS.flatMap((day) => ['web', 'mobile', 'store'].map((channel) => ({
    day,
    channel,
    orders: Math.round(80 + rand() * 140),
    avg_order_value: Math.round((32 + rand() * 30) * 100) / 100,
  }))),
  json: (rand) => Array.from({ length: 12 }, (_, i) => ({
    time: `${String(i * 2).padStart(2, '0')}:00`,
    temp_c: Math.round((6 + Math.sin((i - 3) / 2) * 6 + rand() * 2) * 10) / 10,
    humidity: Math.round(55 + rand() * 30),
    condition: rand() > 0.6 ? 'cloudy' : 'clear',
  })),
};

export function mockRowsFor(source) {
  const generate = GENERATORS[source.type] || GENERATORS.json;
  return generate(seededRandom(source.id));
}

// The backend stores one encrypted `key` string per source, read as JSON by the
// connector: { url, token, path } for rest/json, { url, selector } for scrape,
// { url, format, token } for logs, { connection, query } for sql, { sheet } for
// excel (the file itself is uploaded separately). `auth` becomes a bearer token.
export function packSourceKey(type, config = {}) {
  const { auth, ...rest } = config;
  const token = typeof auth === 'string' ? auth.trim().replace(/^Bearer\s+/i, '') : '';
  return JSON.stringify(token ? { ...rest, token } : rest);
}
