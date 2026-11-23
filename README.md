# DashGen

A dashboard generator built for the Kiroween Hackathon 2026. Connect your data sources (APIs, spreadsheets, databases, web pages, log files), drop charts and numbers onto a grid, and share the result with a public link.

## Hackathon category: Skeleton Crew

> Build a skeleton code template lean enough to be clear but flexible enough to support various use cases. Show us its versatility with two distinct applications from your foundation.

DashGen is the foundation: accounts, data sources, a widget editor and a viewer. The two applications built on it live in `APP1/` and `APP2/` (in progress).

## Features

- **Six source types.** Every source is fetched server-side, so credentials never reach the browser.
  | Type | What it reads |
  |------|---------------|
  | REST API | JSON from an endpoint, with an optional bearer token |
  | JSON | A JSON file by URL, with an optional array path like `data.items` |
  | SQL | A `SELECT` against your own MySQL / MariaDB database, run in a read-only transaction |
  | Web scraping | A page plus a CSS selector. Tables become columns, other elements become rows |
  | System logs | A log file by URL, parsed as JSON lines, nginx, apache or syslog |
  | Excel | An uploaded `.xlsx` or `.csv` (up to 5 MB) |
- **Editor.** A drag-and-drop grid with line, bar, pie, KPI, table, text and label widgets, autosave, undo, and per-widget refresh intervals.
- **Viewer and sharing.** A read-only view of any dashboard. Flip it to public and anyone with the link can see it without an account. Only the owner can edit.
- **Accounts.** Sign up and log in, profile and avatar, email change with confirmation, password reset, preferences, sign out everywhere, and account deletion.

## Tech stack

- Node.js + Express 5
- MySQL (via `mysql2`)
- Plain HTML, CSS and JavaScript on the frontend (ES modules, no build step), with Chart.js for charts
- `zod` for validation, `bcrypt` for passwords, `cheerio` for scraping, `exceljs` for spreadsheets
- Tests use Node's built-in test runner plus `fast-check`

## Getting started

### 1. Install

Needs Node 22 or newer.

```bash
npm install
```

### 2. Configure `.env`

Copy `.env.example` to `.env` in the project root and fill it in. Never commit `.env`; get the real DB values from a teammate over a private channel.

| Variable | Required | Notes |
|----------|----------|-------|
| `DB_HOST` | yes | `127.0.0.1` when using the SSH tunnel below |
| `DB_PORT` | no | Defaults to `3306` |
| `DB_USER` | yes | |
| `DB_PASSWORD` | yes | Can be empty, but must be set |
| `DB_NAME` | yes | |
| `SOURCE_KEY_SECRET` | yes | 32 random bytes, base64. Encrypts stored source credentials. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `APP_BASE_URL` | no | Base URL used in password-reset and email-confirm links, e.g. `http://localhost:8000` |

The server refuses to start and names any missing variable.

### 3. Database

The shared database is reached through an SSH tunnel. Keep this running in its own terminal:

```bash
ssh -N -L 3306:127.0.0.1:3306 dbtunnel@<db-host>
```

**New database:** load the full schema once.

```bash
mysql -h 127.0.0.1 -u <user> -p <database> < Web/backend/db/schema.sql
```

**Existing database:** `schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so it won't add new columns to tables you already have. Run any migrations you haven't applied yet, in order, once each:

```bash
mysql -h 127.0.0.1 -u <user> -p <database> < Web/backend/db/migrations/001_dashboard_visibility.sql
mysql -h 127.0.0.1 -u <user> -p <database> < Web/backend/db/migrations/002_source_files.sql
```

| Migration | Adds | Needed for |
|-----------|------|------------|
| `001_dashboard_visibility.sql` | `dashboards.is_public` | Public / private sharing |
| `002_source_files.sql` | `sources.file_data` | Spreadsheet uploads |

To check whether one is already applied:

```sql
SHOW COLUMNS FROM dashboards LIKE 'is_public';
SHOW COLUMNS FROM sources LIKE 'file_data';
```

A row back means it's applied. Running a migration twice just fails with "Duplicate column name".

### 4. Run

```bash
npm run serve
```

Then open <http://localhost:8000>.

There's no mail service. Password-reset and email-confirm links are printed to the server console.

### 5. Test

```bash
npm test
```

The tests don't need a database; they use in-memory fakes.

## Project structure

```
Web/
  backend/
    server.js              Express app and route mounting
    api.js                 Fetch client, served to the browser at /backend/api.js
    db/
      schema.sql           Full schema for a new database
      migrations/          One-off changes for existing databases
    lib/
      routes/              auth, account, sources, dashboards, public-dashboards
      repos/               SQL queries, every one scoped to the owner
      connectors/          Parsers for scrape, logs, spreadsheet and SQL sources
      source-connector.js  Fetches source data with SSRF protection
      validators.js        Input validation (zod)
  frontend/
    index.html
    pages/                 login, home, edit, view, account
    scripts/
      editor/              Dashboard editor modules
      view/                Read-only viewer
    style/
    TODO.md                Frontend and project task list
tests/                     node:test suites
.kiro/                     Kiro specs and steering docs
APP1/, APP2/               The two Skeleton Crew applications
```

## API overview

All responses use the same envelope: `{ "success": true, "data": ... }` or `{ "success": false, "error": "..." }`.

| Area | Routes | Auth |
|------|--------|------|
| Auth | `POST /api/auth/signup`, `/login`, `/logout`, `/forgot-password`, `/reset-password` | none |
| Account | `GET/DELETE /api/account`, `PATCH /profile`, `/preferences`, `PUT/GET/DELETE /avatar`, `POST /password`, `/email`, `/sessions/revoke-all` | session |
| Email confirm | `GET /api/account/email/confirm?token=` | token |
| Sources | `GET/POST /api/sources`, `DELETE /:id`, `POST /:id/test`, `GET /:id/preview`, `PUT /:id/file` | session |
| Dashboards | `GET/POST /api/dashboards`, `GET/PATCH/DELETE /:id`, `PATCH /:id/visibility`, `GET /:id/data` | session |
| Public dashboards | `GET /api/public/dashboards/:id`, `GET /:id/data` | none (public dashboards only) |

## Security notes

- Passwords are hashed with bcrypt. Logins lock for a while after 5 failed attempts within 15 minutes.
- Sessions are `HttpOnly`, `SameSite=Lax` cookies.
- Every dashboard and source query is scoped to its owner. Someone else's id returns 404, never 403.
- Source credentials are encrypted at rest with `SOURCE_KEY_SECRET` and never sent back to the browser.
- Source fetches block private and internal addresses and pin the connection to the vetted IP, so a source can't be pointed at the server's own network.
- SQL sources run in a read-only transaction with a timeout and a 100-row cap.
- Log sources take a URL, never a file path on the server.

## Team

Aesop, Alex, Amos
