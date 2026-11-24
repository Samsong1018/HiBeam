# Design Document: APP2 Monthly Import

## Overview

```
workbook.xlsx ──ReadWorkbook──▶ sheets ──BuildReport──▶ report ──ApplyReport──▶ new definition
                   (exceljs)        │        (pure)                 (pure)            │
                                    └── CheckSheets (pure, fails fast)                 ▼
              HiBeam REST: PUT /api/sources/:id/file × 5 → POST /:id/test × 5 → PATCH /api/dashboards/:id
```

| File | Role |
|---|---|
| `APP2/import/workbook.mjs` | `ReadWorkbook(path)` reads with `exceljs` into `{ [sheet]: rows[] }`. `CheckSheets(sheets)` checks the required sheets and columns. |
| `APP2/import/report.mjs` | `BuildReport(sheets, { year })` and `ApplyReport(definition, report)`. Pure, no I/O. |
| `APP2/import/hibeam-client.mjs` | A small session client: login, then get/post/patch/put, re-logging in on a 401. |
| `APP2/import/monthly-import.mjs` | The CLI: argument parsing, `--setup`, `--dry-run`, and orchestration. |

## Decisions

| Decision | Why |
|---|---|
| Captions come from fixed rules, not an LLM | The report is financial. Every sentence has to be checkable against the sheet, and the same workbook should always give the same text (Requirement 2.7). |
| Savings lines are found by name (`/saving|invest|retire|401|ira/i`) | Coming in under a savings budget is bad news, the opposite of every other category. Without this, the caption would praise skipping savings. |
| Thresholds are set on `w_spent` by the pipeline, not fixed in the template | The budget total changes from month to month. The KPI thresholds feature in the skeleton is general, and the app supplies the numbers. |
| Talks only to the REST API | This keeps `Web/` untouched, as the Skeleton Crew rule requires. It uses the same endpoints the MCP server uses. |
| Uploads and tests all finish before the board PATCH | A failed sheet must never leave the board saying "December" over November's data (Requirement 4.5). |
| The PDF stays client-side | Server-side rendering would need a headless browser in the app. The viewer's Export already produces the PDF, so the script prints the link and a file name. |
| CommonJS `exceljs` is loaded through `createRequire` | The rest of APP2 is ESM, like APP1's agent. |

## Correctness properties

1. **Determinism.** `BuildReport(s, o)` deep-equals `BuildReport(s, o)`, and neither call changes `s`. *Validates 2.7*
2. **Overspend accuracy.** Every category the caption names as over budget has Actual > Budget and isn't a savings line, and no non-savings category is over by more than the smallest one named. *Validates 2.2*
3. **Caption bound.** The caption is a string of at most 4000 characters for any rows. *Validates 2.8*
4. **Surgical update.** `ApplyReport(def, r)` changes only `config` on `w_title`, `w_where`, `w_note` and `w_spent`. Every other widget is `===` the input, and the input is not mutated. *Validates 3.1–3.4*
5. **Thresholds.** On the updated board, `w_spent.config.alertAt` equals the budget total, `warnAt` equals `Math.round(0.95 × total)`, and `kpiStatus` (from the skeleton's `kpi.js`) returns `alert` exactly when spent ≥ budget. *Validates 3.2*

## Error handling

- Checks fail before any network call, with a message that names the sheet and column.
- If an upload or test fails, the script exits with code 1 and the board is not touched.
- The board is fetched and then PATCHed as a whole definition. Unknown widgets are passed through unchanged.
