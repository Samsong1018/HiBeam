---
name: hibeam-boards
description: Build, check and fix HiBeam dashboards through the hibeam MCP server. Use when the user wants a dashboard, status page, KPI board or report made from their data (REST APIs, JSON, SQL, logs, web pages, Excel/CSV), wants to know what a board is showing, or wants one shared.
---

# Building HiBeam boards

The `hibeam` MCP server logs in as a real HiBeam account and works on that account's sources and dashboards. Calls that change things (create, update, upload, delete, visibility) should wait for the user's OK.

## The loop

1. **Sources.** `list_sources` first. Make what's missing with `create_source`, plus `upload_source_file` for `.xlsx`/`.csv`. Then `test_source`.
2. **Real field names.** `preview_source` on every source you'll bind. Never guess a field name. A misspelt `yField` shows up as a `No "cpuPct" column` message instead of a number.
3. **Draft.** Either:
   - `generate_dashboard` for a rule-based draft. It returns a reason for every widget ("`cpuPct` is a rate, so show the latest value"). It only previews unless you pass `create`.
   - Or fill in a template: swap each `{{placeholder}}` source id for a real source id. `APP1/dashboard.template.json` is a live homelab status page, and `APP2/dashboard.template.json` is a monthly budget report.
4. **Save.** `create_dashboard`, or `update_dashboard` with the full definition.
5. **Look at it.** Get a screenshot from the user (or open `view.html?id=<id>`). Then `update_dashboard` to fix what reads badly: overlapping labels, a pie with too many slices, a KPI that sums a rate, a line chart drawn right to left.
6. **Check the numbers.** `get_dashboard_data` and compare against `preview_source`.
7. **Share** only when asked: `set_dashboard_visibility`.

## Rules for correct numbers

- KPIs for rates, percentages and balances use `agg: "last"`. Never `sum` an id, a status code or a percentage.
- Newest-first feeds set `reverseData: true`, so lines read left to right and "Latest" is the newest row.
- Status fields (`status`, `state`, HTTP codes) get coloured by meaning automatically. Bind them as categories (pie or bar with `agg: "count"`), not as numbers.
- Keep a template's widget ids when you update, so the diff stays small and reviewable.
- `delete_*` only when the user names the thing to delete.

## Settings worth knowing

| Setting | Widgets | What it does |
|---|---|---|
| `refresh` | data widgets | 0, 30, 60, 300 or 900 seconds. The viewer refetches while the tab is visible |
| `warnAt`, `alertAt`, `higherIs` | kpi | Amber/red thresholds. `higherIs: "bad"` for CPU or spending, `"good"` for savings |
| `showDelta` | kpi | Change since the previous row (▲ / ▼) |
| `quietAfter`, `quietField` | data widgets | **Gone quiet.** Minutes (5, 15, 60, 1440, 10080, 44640). When the newest timestamp in `quietField` is older than that, the widget fades and a ghost says when the source last reported. A failed refresh does the same on its own |
| `theme: "kiroween"` | board | Halloween palette for everyone who opens the board |

Set `quietField` explicitly (for example `sampledAt`). Public links only receive the columns a board uses, so an auto-detected column would be missing there.

## Layouts as files

Any board can be exported from the viewer (**Export → Layout as JSON**). Source ids become `{{placeholders}}` named after the sources. **Import layout** on the dashboards page maps each placeholder back to one of the account's sources. A layout you write here can be checked into a repo and reviewed like code.
