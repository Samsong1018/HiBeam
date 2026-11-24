# APP2: Monthly Money Report

![Monthly Money Report board](../docs/screenshots/app2-money-report.png)

A personal finance report built from one spreadsheet. Upload a workbook and you get a board with spending against budget, where the money went, net worth over time, accounts and debts. Export it as a PDF and that's your month-end report.

This is the "non-technical user, uploaded file" half of the Skeleton Crew pair. [APP1](../APP1/) is the opposite: a technical user with live data from a server. The two apps don't share a single source type, and they run on the same HiBeam skeleton with no code changes.

| | APP1 Homelab Ops | APP2 Money Report |
|---|---|---|
| User | Someone who runs servers | Someone with a budget spreadsheet |
| Data | Live REST and log feeds | One uploaded `.xlsx` |
| Updates | Every 30 seconds | When you upload a new month |
| Shared as | A public status page | An exported PDF |

## What's in here

| Path | What it is |
|------|------------|
| `John_Doe_finance.xlsx` | Sample workbook. John Doe is made up, and so is every number |
| `dashboard.template.json` | The board layout. `{{budget}}` and the other placeholders are replaced by source ids |
| `import/` | The monthly import: `monthly-import.mjs` (the command), `report.mjs` (the rules, pure and tested), `workbook.mjs`, `hibeam-client.mjs` |

## The workbook

Each sheet becomes its own HiBeam Excel source. The header row turns into field names.

| Sheet | Columns | Used for |
|-------|---------|----------|
| `Budget vs Actual` | Category, Budget ($), Actual ($), Difference | Spent and budgeted KPIs, budget-vs-actual bars, the donut |
| `Monthly Spending` | Month, Spending ($) | Spending by month |
| `Net Worth` | Month, Net Worth ($) | Net worth KPI and trend |
| `Accounts` | Account, Balance ($) | Accounts table |
| `Debts` | Debt, Balance ($), Min Payment ($/mo), APR (%) | Total debt KPI and debts table |
| `Profile` | Field, Value | Not on the board. It's there for context |

To use your own numbers, keep the sheet names and header rows, replace the rows, and re-upload the file to each source. The charts don't need to change.

## Building the board

### With the HiBeam MCP server (how we did it)

With `mcp/hibeam-server.mjs` connected in Kiro, ask:

> Create an Excel source for each sheet in APP2/John_Doe_finance.xlsx except Profile, upload the workbook to each one, test them, then create a dashboard from APP2/dashboard.template.json with the placeholders swapped for the new source ids.

The agent calls `create_source` with `{ sheet }`, then `upload_source_file`, then `test_source` for each sheet, and finally `create_dashboard`.

### By hand

1. **Sources**, then **New source**, then **Excel**. Pick the workbook and type the sheet name. Do this once for each of the five sheets.
2. Open the editor and lay out the widgets from `dashboard.template.json`, or build your own. KPIs use `sum` for the budget sheet and `last` for net worth.
3. On the view page, **Export** and then **Export as PDF** gives you the month-end report.

## Every month after: the import script

Once the board exists, next month is one command. Copy `mcp/.env.example` to `mcp/.env` with your HiBeam login (the same one the MCP server uses), then:

```bash
# first time only: creates the five sources and the board, saves their ids to APP2/import/state.json
node APP2/import/monthly-import.mjs APP2/John_Doe_finance.xlsx --setup --year 2026

# each month after
node APP2/import/monthly-import.mjs path/to/december.xlsx --year 2026

# see what it would write, without touching anything
node APP2/import/monthly-import.mjs path/to/december.xlsx --dry-run
```

Here's what a run does:
1. Checks that the workbook has every sheet and column the board needs. If not, it stops before anything is uploaded and names what's missing.
2. Uploads the workbook to every source and tests each one. If any of them fails, the board isn't touched.
3. Rewrites only the month-specific widgets: the title (`John Doe · December 2026`), the donut title (`Where December went`) and the **This month** text.
4. Sets the "Spent this month" alert to the new budget total, and the warning to 95% of it.
5. Prints the board link and a file name for the PDF (`money-report-2026-12.pdf`). Open the board, then **Export → Export as PDF**.

The "This month" text comes from fixed rules, not a language model, so every sentence can be checked against the sheet. For the sample workbook it writes:

> Clothing (+$110) and Dining Out (+$87) went furthest over budget. Savings came in $200 under the $600 target. Net worth rose $950 to $58,250. Total spending was $357 lower than October. The Credit Card is the 22.9% APR one, so it's first in line for extra payments.

Savings, investing and retirement lines count the other way round: coming in under budget there is flagged, not praised. The script talks to HiBeam only through its REST API, so nothing in `Web/` changes. The spec is [`.kiro/specs/app2-monthly-import/`](../.kiro/specs/app2-monthly-import/).

## Notes

- The workbook is stored server-side and only parsed there, read-only. Nothing in it runs. Uploads are capped at 5 MB and must be `.xlsx` or `.csv`.
- The donut has 11 categories and HiBeam has 6 chart colours, so some colours repeat. If that bothers you, merge small categories into `Misc`.
- The "This month" text in the template is a placeholder for November. The import script rewrites it every month. If you build the board by hand, edit it yourself.
