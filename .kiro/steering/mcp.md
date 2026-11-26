---
inclusion: manual
---
# Building boards through MCP (pull in with #mcp)

The `hibeam` MCP server (`mcp/hibeam-server.mjs`) logs in as a real HiBeam account. Every call waits for approval because `autoApprove` is empty.

## The loop that built APP1 and APP2
1. `list_sources` / `create_source` (+ `upload_source_file` for Excel), then `test_source`.
2. `preview_source` to see the **real** field names. Never guess them.
3. Either `generate_dashboard` for a rule-based draft, which comes back with a reason for every widget, or fill in an app's `dashboard.template.json`, swapping each `{{placeholder}}` for a source id.
4. `create_dashboard` (or `update_dashboard`).
5. `screenshot_dashboard` to see the board as a viewer does (`viewport: "mobile"` for the phone layout), then `update_dashboard` to fix what reads badly: overlapping labels, a pie with too many slices, a KPI that sums a rate. Screenshot again after the fix.
6. `get_dashboard_data` to check the numbers are what the source says.

## Rules
- Bind KPIs for rates and balances with `agg: "last"`. Never `sum` an id or a status code.
- Use the template's widget ids, so a later `update_dashboard` diff stays small.
- For live sources with a timestamp column, set `quietAfter` (minutes) and an explicit `quietField`, so the widget shows "gone quiet" when the source stops reporting. Public links only get the columns a board uses, so don't rely on auto-detect.
- Time-series from a log or agent: set `bucket` on the line chart so outages show as gaps. CPU, memory and disk lines get `thresholds` that match the KPI's `warnAt` / `alertAt`.
- A pie with more than about 6 slices gets `topN`. Levels like net worth get `zeroBased: false`.
- `delete_*` only when the user names the thing to delete.

The two templates, for the shape a finished board has:
#[[file:APP1/dashboard.template.json]]
#[[file:APP2/dashboard.template.json]]
