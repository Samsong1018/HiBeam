# How we used Kiro

Most of what's in `.kiro/` is there because something broke first. This page lists each incident, the commit where it happened or was fixed, and the Kiro guardrail it led to.

> **Draft.** The commits and files are checked against the repo. Lines marked **TODO (team)** need someone who was there to fill them in. Don't publish a guess.

## Bug → guardrail ledger

| # | What broke | Evidence | Guardrail it became | What it has caught since |
|---|---|---|---|---|
| 1 | A stray quote in one script stopped the whole home page from running, and no test loaded that file. | Hook and checker added in `48dd28c`. The story is in the header of `tools/check-syntax.mjs`. | **Hook** `syntax-check-on-save` runs `npm run check` (`node --check` on every tracked file) whenever a `.js`/`.mjs` file is saved. | TODO (team) |
| 2 | The editor read `GET /api/dashboards/:id` without unwrapping `definition`. Every saved board opened empty, and the next autosave overwrote the real one. | The fix and its comment are in `Web/frontend/scripts/editor/main.js` `loadDashboard` (`3cd34ec`). An earlier payload mismatch was fixed in `50c7258`. | **Hook** `api-contract-sync`: when a route file is saved, an agent checks every caller in `api.js` and `scripts/` against the route's request and response shapes. **Steering** `backend.md` documents the envelope. | TODO (team) |
| 3 | An unexpected error could crash the error handler instead of returning a generic 500. | Auth spec Property 15, `tests/auth-p15-generic-errors.test.mjs`. PBT results are in `.kiro/specs/auth-account-endpoints/tasks.meta.json`. | **Spec + property tests.** Each correctness property in `design.md` maps to one `fast-check` file, and the **`pbt-writer` agent** writes new ones in the same style. | Found the crash input the hand-written unit tests had missed. |
| 4 | The secret-scan workflow had bad indentation, so GitHub couldn't parse it and nothing was being scanned. | `baa1a56` added it, `9e50449` fixed it. | CI `secret-scan.yml`. The **`guard-tool-use` hook** also blocks any agent read or write of `.env`. | TODO (team) |
| 5 | Agents working against a shared MySQL database and a shared `main` branch can do real damage: `DROP`, a `DELETE` with no `WHERE`, a force-push. | Rules in `.kiro/hooks/scripts/guard-tool-use.mjs` (`48dd28c`). | **Hook** `guard-tool-use` (PreToolUse) blocks force-pushes or hard resets of `main`, broad `rm -rf`, destructive SQL, and `.env` access. | TODO (team) |
| 6 | Requirements changed while design and tasks didn't, and the spec drifted. | `spec-consistency.json` (`48dd28c`). | **Hook** `spec-consistency`: saving a `requirements.md` checks that `design.md` and `tasks.md` still cover every acceptance criterion. | TODO (team) |
| 7 | Spec tasks were marked done while the suite was red. | `verify-after-task.json` (`48dd28c`). | **Hook** `verify-after-task` runs the syntax check and the full suite after each spec task. | TODO (team) |
| 8 | Agent sessions started from stale assumptions about the branch and uncommitted work. | `session-context.json` (`48dd28c`). | **Hook** `session-context` gives every new session the branch, the last 5 commits and `git status`. | TODO (team) |
| 9 | Security rules (owner scoping, SSRF pinning, read-only SQL) were spread across files, and reviews kept missing them. | SSRF pinning landed in `b29dda6`. 404-not-403 scoping in `622de73`. | **Skill** `security-review` (loaded automatically for routes, connectors and auth). **Agent** `security-reviewer`. **Steering** `security.md` (manual, `#security`). | TODO (team) |
| 10 | Steering was 4 short docs, and `structure.md` pointed at paths that don't exist (`../../../Web/`). Every doc loaded on every request, including backend naming rules that the frontend doesn't follow. | The old docs are in git history before this change. | **Steering rebuilt with inclusion modes:** `always` for product, tech and structure; `fileMatch` for backend, frontend and tests; `manual` for `#security` and `#mcp`; `#[[file:…]]` references to the schema, the widget registry and the app templates. | New. |
| 11 | APP2's monthly update was manual and error-prone: re-upload to 5 sources, rewrite the title, the donut title and the "This month" text by hand. | `.kiro/specs/app2-monthly-import/` | **Third spec**, with 5 correctness properties, each a `fast-check` test (`tests/app2-import-p*.test.mjs`). | New. |

## Specs

| Spec | Built with | Properties |
|---|---|---|
| `auth-account-endpoints` | Kiro spec workflow. TODO (team): IDE or CLI? | 22, of which 13 have their own test file |
| `dashboard-generator` | Kiro spec workflow. TODO (team) | 11 |
| `app2-monthly-import` | See "After the credits ran out" | 5 |

## IDE vs CLI

What the repo shows:
- **CLI first.** `c087ea0` (Nov 13) added `.kiro/steering` "for kiro-cli", before any backend code existed.
- **Spec workflow.** `4ed7791` (Nov 14), "first run with kiro AI added backend auth", brought in the auth spec. `tasks.meta.json` holds Kiro's PBT run results for each task.
- **MCP.** `6fc762c` (Nov 23) registered `mcp/hibeam-server.mjs` in `.kiro/settings/mcp.json`. Both app boards were built through it, one prompt each.

TODO (team), in a few sentences each:
- Which of you used the IDE and which used the CLI, and for what kind of work?
- What did one do better than the other? (For example, specs and hooks in the IDE versus quick shell-driven fixes in the CLI.)
- Did a hook or agent behave differently between the two?

## After the credits ran out

We ran low on Kiro credits near the end. These were done without Kiro running them, but they follow the steering, specs and conventions above, and the same hooks and tests check them:
- The steering rebuild (#10) and the `app2-monthly-import` spec and code (#11)
- KPI thresholds and change since the previous row, semantic status colours, tables that show only whole rows, and the Kiroween theme
- The `generate_dashboard` MCP tool, which explains each widget the generator chose

TODO (team): say plainly what tool you used for these, if any, and which teammate did them.
