---
inclusion: always
---
# Where things live

Paths are from the repo root.

```
Web/backend/server.js           Express app, route mounting, helmet/CSP, static allowlist
Web/backend/api.js              Fetch client served to the browser at /backend/api.js
Web/backend/db/schema.sql       Full schema; db/migrations/ for existing databases
Web/backend/lib/routes/         auth, account, sources, dashboards, public-dashboards
Web/backend/lib/repos/          SQL, every query takes the owner id
Web/backend/lib/connectors/     logs, scrape, spreadsheet, sql parsers
Web/backend/lib/source-connector.js   All outbound fetches (SSRF guard lives here)
Web/frontend/pages/             login, home, edit, view, account (.html)
Web/frontend/scripts/editor/    Editor modules; pure ones (data, model, generator, kpi, semantic) are unit-tested
Web/frontend/scripts/view/      Read-only viewer, export
Web/frontend/style/style.css    Design tokens (light, dark, kiroween)
mcp/hibeam-server.mjs           MCP server: Kiro reads and builds boards through it
APP1/                           Homelab Ops: metrics agent, deploy configs, template
APP2/                           Monthly Money Report: workbook, template, monthly import script
tests/                          *.test.mjs; property tests are named <spec>-p<N>-<topic>.test.mjs
.kiro/specs/                    One folder per spec: requirements, design, tasks
```

When you add a file, put it next to the code it belongs to and update this list if it adds a new area.
