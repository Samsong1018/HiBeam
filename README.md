# HiBeam

> **Kiroween Hackathon 2026 · Skeleton Crew**

Connect your data, drop widgets onto a grid, and share the result — or export it as a PNG or PDF. HiBeam is the foundation: accounts, six source types, a drag-and-drop editor, and a read-only viewer. The two applications built on top of it will live in `APP1/` and `APP2/` (in progress).

![The HiBeam viewer showing a sales dashboard with KPI tiles, a line chart, a pie chart, a bar chart and a table](docs/screenshots/viewer.png)

---

## Features

### Data sources
Every source is fetched server-side, so credentials never reach the browser.

| Type | What it reads |
|------|---------------|
| REST API | JSON from an HTTP endpoint, with an optional bearer token |
| JSON | A JSON file by URL, with an optional array path like `data.items` |
| SQL | A `SELECT` against your own MySQL / MariaDB database, run read-only with a 100-row cap |
| Web scrape | A page plus a CSS selector — tables become columns, other elements become rows |
| System logs | A log file by URL, parsed as JSON lines, nginx, apache, or syslog |
| Excel / CSV | An uploaded `.xlsx` or `.csv` up to 5 MB |

### Editor
Drag-and-drop grid with **line, bar, pie, KPI, table, text, and label** widgets. Autosave, undo/redo, per-widget refresh intervals, and a live preview link.

### Viewer and sharing
A read-only view of any dashboard. Flip it public and anyone with the link can see it without an account. Only the owner can edit.

### Export
From the view page, click **Export** and choose:
- **Export as PNG** — captures the full rendered board at 2× resolution and downloads it as a `.png`.
- **Export as PDF** — wraps the same capture in a PDF page sized exactly to the board and downloads it as a `.pdf`.

Charts, KPIs, tables, and all widget styles are captured as they appear on screen.

### Accounts
Sign up and log in, profile and avatar, email change with confirmation, password reset, preferences, sign-out-everywhere, and account deletion.

![The editor with a line chart selected: component palette and sources on the left, the grid in the middle, settings on the right](docs/screenshots/editor.png)

---

## Built with Kiro

Everything Kiro uses lives in [`.kiro/`](.kiro/). Here's what's in there and what it did for us.

### Specs
| Spec | What it covers | Status |
|------|----------------|--------|
| [`auth-account-endpoints`](.kiro/specs/auth-account-endpoints/) | Sign-up, login, sessions, lockout, account management, and the static-file allowlist. 18 requirements and 22 numbered correctness properties | Built. 13 of the properties have their own `tests/auth-p*.test.mjs` suite |
| [`dashboard-generator`](.kiro/specs/dashboard-generator/) | A generator that looks at a source's rows, works out each field's type, and proposes a full dashboard layout | Requirements, design and tasks written, not built yet |

The auth spec is where property-based testing paid off. Each property in `design.md` maps to a `fast-check` test, and one of them found an input that crashed the error handler, which the hand-written unit tests had missed.

### Steering
- [`product.md`](.kiro/steering/product.md): who it's for and what to optimize for
- [`tech.md`](.kiro/steering/tech.md): the stack, so Kiro doesn't reach for a framework we aren't using
- [`structure.md`](.kiro/steering/structure.md): where things live
- [`format.md`](.kiro/steering/format.md): our naming rules (`tmpVar`, `pParam`, `libModule`, PascalCase functions, Allman braces)

### Hooks
| Hook | Trigger | What it does |
|------|---------|--------------|
| `session-context` | Session start | Gives every new session the branch, recent commits and uncommitted files |
| `guard-tool-use` | Before a tool runs | Blocks force-pushes and hard resets on `main`, broad `rm -rf`, destructive SQL against the shared database, and any read or write of `.env` |
| `syntax-check-on-save` | Saving a `.js` / `.mjs` file | Runs `npm run check`. Added after a stray quote broke the whole home page and no test loaded that file |
| `api-contract-sync` | Saving a route file | Checks the browser code that calls the route still matches its request and response shapes |
| `spec-consistency` | Saving a spec's `requirements.md` | Checks that `design.md` and `tasks.md` still cover every acceptance criterion |
| `verify-after-task` | Finishing a spec task | Runs the syntax check and the full test suite and fixes what broke before the next task |

### Custom agents
- **`security-reviewer`** checks a diff against the rules this codebase depends on: owner-scoped queries, SSRF guards, read-only SQL sources, the response envelope, no `innerHTML` with user data.
- **`frontend-reviewer`** looks for the frontend bugs that have actually hit this project, plus accessibility, theming and branding.
- **`pbt-writer`** writes `fast-check` property tests in the repo's style.
- **`submission-checker`** audits the repo against the Skeleton Crew rules before submission.

There's also a [`security-review`](.kiro/skills/security-review/SKILL.md) skill with the project's security checklist, which Kiro loads on its own when a change touches routes, connectors, auth or user input.

---

## Tech stack

| Layer | What's used |
|-------|-------------|
| Runtime | Node.js 22+, Express 5 |
| Database | MySQL / MariaDB via `mysql2` |
| Frontend | Plain HTML, CSS, ES modules — no build step |
| Charts | Chart.js 4 (CDN) |
| Export | html2canvas-pro 2.6 + jsPDF 4.2 (CDN with SRI, client-side) |
| Validation | `zod` |
| Auth | `bcrypt`, `HttpOnly` session cookies |
| Security | `helmet` (CSP, HSTS), `express-rate-limit`, SSRF protection on source fetches |
| Scraping | `cheerio` |
| Spreadsheets | `exceljs` |
| Tests | Node built-in test runner + `fast-check` for property tests |

---

## Getting started

### 1. Install

```bash
npm install
```

Requires **Node 22 or newer**.

### 2. Configure

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

| Variable | Required | Notes |
|----------|----------|-------|
| `DB_HOST` | ✓ | `127.0.0.1` when using the SSH tunnel below |
| `DB_PORT` | | Defaults to `3306` |
| `DB_USER` | ✓ | |
| `DB_PASSWORD` | ✓ | Can be empty string, but must be set |
| `DB_NAME` | ✓ | |
| `SOURCE_KEY_SECRET` | ✓ | 32 random bytes, base64 — encrypts stored source credentials. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `APP_BASE_URL` | | Base URL for password-reset and email-confirm links, e.g. `http://localhost:8000` |
| `PORT` | | Defaults to `8000` |
| `TRUST_PROXY` | | Set when behind a reverse proxy so rate limits see real client IPs. A hop count (`1`) or `loopback` |
| `NODE_ENV` | | Set to `production` when serving over HTTPS: enables `Secure` cookies and HSTS |

The server refuses to start and names any missing required variable.

### 3. Database

The shared database is reached through an SSH tunnel. Keep this running in its own terminal while you work:

```bash
ssh -N -L 3306:127.0.0.1:3306 dbtunnel@<db-host>
```

**New database** — load the full schema once:

```bash
mysql -h 127.0.0.1 -u <user> -p <database> < Web/backend/db/schema.sql
```

**Existing database** — run any migrations you haven't applied yet, in order:

```bash
mysql -h 127.0.0.1 -u <user> -p <database> < Web/backend/db/migrations/001_dashboard_visibility.sql
mysql -h 127.0.0.1 -u <user> -p <database> < Web/backend/db/migrations/002_source_files.sql
```

| Migration | Adds | Needed for |
|-----------|------|------------|
| `001_dashboard_visibility.sql` | `dashboards.is_public` | Public / private sharing |
| `002_source_files.sql` | `sources.file_data` | Spreadsheet uploads |

To check whether a migration has already been applied:

```sql
SHOW COLUMNS FROM dashboards LIKE 'is_public';
SHOW COLUMNS FROM sources LIKE 'file_data';
```

A row in the result means it's applied. Running a migration twice fails with "Duplicate column name" — harmless.

### 4. Run

```bash
npm run serve
```

Open <http://localhost:8000>.

> There is no mail service. Password-reset and email-confirm links are printed to the server console.

### 5. Test

```bash
npm test
```

Tests don't need a database — they use in-memory fakes. There are 97 of them, 34 of which are `fast-check` property tests.

---

## Project structure

```
Web/
  backend/
    server.js              Express app and route mounting
    api.js                 Fetch client served to the browser at /backend/api.js
    db/
      schema.sql           Full schema for a new database
      migrations/          One-off changes for existing databases
    lib/
      routes/              auth · account · sources · dashboards · public-dashboards
      repos/               SQL queries, every one scoped to the owner's id
      connectors/          Parsers for scrape, logs, spreadsheet, and SQL sources
      source-connector.js  Fetches source data with SSRF protection
      validators.js        Input validation (zod)
  frontend/
    index.html
    pages/                 login · home · edit · view · account
    scripts/
      editor/              Dashboard editor modules
      view/                Read-only viewer (including export.js)
    style/
    TODO.md                Frontend and project task list
tests/                     node:test suites
docs/screenshots/          Images used in this README
.kiro/                     Specs, steering, hooks, agents, and a skill
APP1/                      Skeleton Crew application 1 (in progress)
APP2/                      Skeleton Crew application 2 (in progress)
```

---

## API

All responses follow the same envelope: `{ "success": true, "data": … }` or `{ "success": false, "error": "…" }`.

| Area | Routes | Auth |
|------|--------|------|
| Auth | `POST /api/auth/signup` `/login` `/logout` `/forgot-password` `/reset-password` | — |
| Account | `GET/DELETE /api/account` · `PATCH /profile` `/preferences` · `PUT/GET/DELETE /avatar` · `POST /password` `/email` `/sessions/revoke-all` | session |
| Email confirm | `GET /api/account/email/confirm?token=` | token |
| Sources | `GET/POST /api/sources` · `DELETE /:id` · `POST /:id/test` · `GET /:id/preview` · `PUT /:id/file` | session |
| Dashboards | `GET/POST /api/dashboards` · `GET/PATCH/DELETE /:id` · `PATCH /:id/visibility` · `GET /:id/data` | session |
| Public dashboards | `GET /api/public/dashboards/:id` · `GET /:id/data` | — |

---

## Security notes

- Passwords are hashed with bcrypt. After 5 failed logins within 15 minutes the account is locked for a cooldown period.
- Sessions are `HttpOnly`, `SameSite=Lax` cookies. `Secure` is set in production.
- Every dashboard and source query is scoped to its owner — a foreign id returns 404, never 403, so IDs can't be enumerated.
- Source credentials are encrypted at rest with `SOURCE_KEY_SECRET` and are never sent back to the browser.
- Source fetches block private and internal addresses and pin the connection to the resolved IP, so a source URL can't be redirected to the server's internal network (SSRF protection).
- SQL sources run in a read-only transaction with a timeout and a 100-row cap.
- Log sources accept a URL, never a file path on the server.
- Public dashboards only send the columns their widgets actually display. A table set to show all columns exposes all of them.
- Rate limits (per IP unless noted): login 30 / 15 min; signup, forgot-password and reset-password 10 / 15 min combined; source test/preview and dashboard data 120 / min per user; public dashboards 120 / min. Over the limit returns 429.
- Security headers via `helmet`, including a CSP that permits scripts only from the app origin and jsDelivr.
- Expired sessions, used or expired tokens, and old login-attempt records are pruned at startup and then every hour.

---

## Team

Aesop · Alex · Amos
