---
inclusion: always
---
# Tech stack

- **Runtime:** Node.js 22+, Express 5, CommonJS on the backend.
- **Database:** MySQL / MariaDB via `mysql2`. Every repo query is scoped to the owner.
- **Frontend:** plain HTML, CSS and ES modules. **No build step and no framework.** Don't add React, Tailwind, a bundler or TypeScript.
- **Libraries in the browser:** Chart.js 4, gridstack, html2canvas-pro and jsPDF, loaded from jsDelivr **with SRI hashes**. The CSP only allows the app origin and jsDelivr.
- **Validation:** `zod` on the backend (`Web/backend/lib/validators.js`).
- **Tests:** `node:test` plus `fast-check`. No database needed; tests use in-memory fakes.

## Commands
| Command | What it does |
|---|---|
| `npm run serve` | Start the server on :8000 (needs `.env` and the DB tunnel) |
| `npm run check` | `node --check` on every tracked .js/.mjs file |
| `npm test` | The full suite |

Run `npm run check && npm test` before saying a task is done.
