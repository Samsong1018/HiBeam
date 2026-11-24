# Requirements Document

## Introduction

This feature makes HiBeam generate dashboards. Today every dashboard is built by hand: the user adds a source, drags widgets onto the grid and binds each one to fields. The Generator looks at the rows a source returns, works out what each field is (a measure, a date, a category, a label axis, free text), and proposes a finished layout of KPI tiles, charts and a table. The user can then adjust that layout in the editor like any other dashboard.

The Generator is a pure function over source rows. It runs in the browser on the rows the editor already fetches through `GET /api/sources/:id/preview`, so no new backend endpoint and no database change is needed. The same module is meant to be reused by the two Skeleton Crew applications (`APP1/`, `APP2/`), which will call it with their own starter sources.

Current state:
- `Web/frontend/scripts/editor/data.js` has `fieldsOf(rows)`, which only tells numbers from strings, plus `aggregate` and `groupSeries`.
- `Web/frontend/scripts/editor/widget-types.js` defines the widget registry (line, bar, pie, kpi, table, text, label), default sizes in 48-column units and the binding shape `{ sourceId, xField, yField, agg }`.
- `Web/frontend/scripts/editor/model.js` has `normalizeDashboard`, which cleans any untrusted dashboard document.
- `Web/frontend/scripts/editor/sources.js` caches preview rows per source (0 to 100 rows each).
- The editor store (`store.js`) supports undo and redo of whole-document commits.

Out of scope: AI or LLM-based generation, server-side generation, and generating from sources the user has not connected yet.

## Glossary

- **Generator**: The pure module `Web/frontend/scripts/editor/generator.js`.
- **Editor**: The dashboard editor page `Web/frontend/pages/edit.html` and its scripts.
- **Source**: A data source connected to the user's account, with an `id`, `name` and `type`.
- **Rows**: The array of plain objects a Source's preview returns (0 to 100 items).
- **Field**: A key that appears in at least one of the sampled Rows, whose name is at most 120 characters long.
- **Sample**: The first 100 Rows of a Source, or all of them if there are fewer.
- **Present_Values**: The values of a Field across the Sample, excluding `null`, `undefined` and the empty string.
- **Field_Profile**: The Generator's description of one Field: `{ name, role, distinct, presentCount, ordered }`.
- **Role**: One of `time`, `number`, `category`, `label`, `text`, `empty`.
- **Generated_Section**: The widgets the Generator produces for one Source.
- **Generated_Dashboard**: A dashboard document `{ name, grid, widgets }` returned by the Generator.
- **Grid_Columns**: The dashboard's column count, one of 24, 48, 72, 96.
- **Generate_Dialog**: The Editor dialog in which the user picks Sources and a placement mode.
- **Placement_Mode**: `replace` (the Generated_Dashboard replaces all current widgets) or `append` (the generated widgets are added below the current ones).

## Requirements

### Requirement 1: Field profiling

**User Story:** As a user, I want HiBeam to understand what my columns contain, so that it picks sensible charts without me configuring each one.

#### Acceptance Criteria

1. WHEN the Generator profiles Rows, THE Generator SHALL return one Field_Profile per Field in the Sample, in first-seen order. A Field_Profile also carries `ordered` (true only for an ordered `label`).
2. IF a Field has no Present_Values, THEN THE Generator SHALL assign it the Role `empty`.
3. WHERE a Field's name matches `/^id$/i`, `/_id$/i` or `/[a-z]Id$/`, THE Generator SHALL assign it the Role `text` whatever its values, so identifiers are never summed or used as an axis.
4. IF every Present_Value of a Field is an ISO 8601 date or date-time string, or a `YYYY/MM/DD` string, that `Date.parse` accepts, THEN THE Generator SHALL assign it the Role `time`. Bare numbers (`2024`, `1700000000`) and clock strings (`14:05`) are never `time`.
5. IF every Present_Value is numeric under `toNumber` from `data.js`, THE Generator SHALL assign the Role `number`, EXCEPT that a coded number becomes `category`. A coded number has only integer values, `2 <= distinct <= 12`, `distinct <= presentCount / 2`, AND either a code-like name (`status`, `code`, `level`, `type`, `kind`, `state`, as a whole name, a `_suffix` or a camelCase suffix) or only the values 0 and 1. Integer measures such as `units` stay `number`.
6. IF a Field is not covered by criteria 2 to 5, has at least 2 Present_Values, all strings of at most 80 characters, and at least 80% of them are month names or abbreviations (optionally followed by a year, e.g. `Jun 2026`) or clock times (`H:MM`, `HH:MM:SS`), THEN THE Generator SHALL assign it the Role `label` with `ordered: true`. Values may repeat (a 30-second sample feed repeats each `HH:MM`).
7. IF a Field is not covered by criteria 2 to 6, all Present_Values are strings or booleans, and `2 <= distinct <= 12` and `distinct <= presentCount / 2`, THEN THE Generator SHALL assign it the Role `category`.
8. IF a Field is not covered by criteria 2 to 7, has at least 2 Present_Values, all strings of at most 80 characters, and every value is distinct, THEN THE Generator SHALL assign it the Role `label` with `ordered: false`.
9. IF a Field matches none of criteria 2 to 8, THEN THE Generator SHALL assign it the Role `text`. In particular a single-row Source never yields a `label`.
10. THE Generator SHALL ignore Rows that are not plain objects, and SHALL ignore any Field whose name is longer than 120 characters (`normalizeBinding` cuts field names at 120).
11. FOR ALL Rows, profiling SHALL return exactly one Role per Field, and that Role SHALL be one of the six Roles (total-function property).

### Requirement 2: Widget selection for one Source

**User Story:** As a user, I want a generated layout that shows the most useful views of my data first, so that the dashboard is useful straight away.

Terms used below: a **rate** Field's name ends in `Pct`, `percent` or `%` (also `(%)`); a **stock** Field's name contains `balance`, `worth`, `price`, `uptime`, `inventory`, `stock` or `temp`; a **money** Field's name contains `$`. The Source has an **ordered axis** when it has a `time` Field or an ordered `label`.

#### Acceptance Criteria

1. THE Generator SHALL start each Generated_Section with a `label` widget whose text is the Source name.
2. THE Generator SHALL rank `number` Fields as: rates, then names ending in `Total` or `Count`, then money, then the rest, keeping first-seen order within a tier.
3. WHEN a Source has at least one `number` Field, THE Generator SHALL add one `kpi` widget for each of the first three ranked Fields, titled with the Field name. The aggregation SHALL be `last` for a rate or stock on an ordered axis, `avg` for a rate otherwise, and `sum` for everything else. Rate KPIs get suffix `%` and 1 decimal; money KPIs get prefix `$`.
4. WHEN a Source has no `number` Field and at least one Row, THE Generator SHALL add one `kpi` widget titled `Rows` that counts rows (`agg: 'count'`).
5. Charts SHALL only be generated when the Sample has at least 2 Rows. In charts, rates aggregate with `avg`, stocks with `last` and everything else with `sum`, so a repeated x value never adds up percentages or balances.
6. WHEN a Source has a `time` Field and at least one `number` Field, THE Generator SHALL add one `line` widget with the first `time` Field as `xField` and one binding per ranked Field, up to three.
7. WHEN a Source has a `category` Field and at least one `number` Field, THE Generator SHALL add one `bar` widget with the first `category` Field as `xField` and the first non-rate ranked Field (or the first ranked Field if all are rates) as `yField`. IF that category has at most 6 distinct values and the bar aggregates with `sum`, THE Generator SHALL also add a `pie` widget with the same Fields.
8. WHEN a Source has a `category` Field and no `number` Field, THE Generator SHALL add one `bar` widget that counts rows per category, plus a counting `pie` widget when the category has at most 6 distinct values.
9. WHEN a Source has a `label` Field and at least one `number` Field, and no `time` or `category` Field, THE Generator SHALL chart the first ordered `label` (or else the first `label`): an ordered label gets a `line` like criterion 6, and an unordered label gets a `bar` like criterion 7.
10. IF the first `time` Field's first Present_Value is later than its last (a newest-first feed), THEN the `line` and `kpi` widgets of that section SHALL have `reverseData: true`, so the line reads oldest to newest and `last` means the newest row.
11. WHEN a Source has at least one Row, THE Generator SHALL end the Generated_Section with a `table` widget titled `All rows` bound to the Source.
12. IF a Source has zero plain-object Rows, THEN THE Generated_Section SHALL contain only the `label` widget and one `text` widget saying the source returned no rows.
13. THE Generator SHALL set `sourceId` on every binding to the id of the Source it was generated from, and SHALL only use Field names that exist in that Source's Sample.
14. Every non-empty `yField` SHALL be a `number` Field, so coded numbers, identifiers, labels and text are never aggregated.
15. THE Generator SHALL produce at most 10 widgets per Generated_Section.

### Requirement 3: Layout

**User Story:** As a user, I want the generated widgets laid out neatly, so that I do not have to rearrange them before the dashboard is readable.

#### Acceptance Criteria

1. THE Generator SHALL place widgets in rows from top to bottom: the label, then the KPI tiles side by side, then the charts, then the table.
2. THE Generator SHALL size each widget from its type's default size in `widget-types.js`, scaled to the Grid_Columns with the existing `scaleSize` helper.
3. THE Generator SHALL widen widgets in a row so that the row spans the full Grid_Columns when the row has three or fewer widgets.
4. FOR ALL generated layouts, every widget SHALL satisfy `0 <= x`, `x + w <= Grid_Columns`, `w >= 1`, `h >= 1` and `y >= 0` (bounds property).
5. FOR ALL generated layouts, no two widgets SHALL overlap (no-overlap property).
6. WHEN more than one Source is selected, THE Generator SHALL stack the Generated_Sections vertically in the order the Sources were selected.
7. WHEN the Placement_Mode is `append`, THE Generator SHALL offset every generated widget so that its `y` is at least the bottom edge (`y + h`) of the lowest existing widget.

### Requirement 4: Output is a valid, stable dashboard

**User Story:** As a developer, I want the Generator's output to be an ordinary dashboard document, so that the editor, autosave and viewer handle it without special cases.

#### Acceptance Criteria

1. FOR ALL inputs, passing the Generated_Dashboard through `normalizeDashboard` SHALL return a document deeply equal to it (normalization is a no-op property).
2. FOR ALL inputs, generating twice from the same Sources, Rows, Grid_Columns and id function SHALL return deeply equal results (determinism property).
3. THE Generator SHALL NOT modify the Rows, Sources or existing dashboard passed to it (immutability property).
4. THE Generator SHALL take widget ids from an injected id function, so tests can make ids predictable. In the Editor the id function SHALL be the same one used for manually added widgets.
5. THE Generated_Dashboard SHALL keep the current dashboard's `name` and `grid`.
6. IF the result would exceed the 200-widget limit, THEN THE Generator SHALL return the current dashboard unchanged and report `too_many_widgets`. IF any generated widget would start below `y = 10000` (where `normalizeDashboard` clamps), it SHALL report `too_tall`. IF no Source is given, it SHALL report `no_sources`.

### Requirement 5: Generate dialog in the editor

**User Story:** As a user, I want a Generate button in the editor, so that I can build a dashboard from my sources in one step.

#### Acceptance Criteria

1. THE Editor toolbar SHALL include a "Generate" button that opens the Generate_Dialog.
2. THE Generate_Dialog SHALL list the user's Sources with a checkbox each, plus a Placement_Mode choice. The default Placement_Mode SHALL be `replace` when the dashboard has no widgets and `append` otherwise.
3. IF the user has no Sources, THEN THE Generate_Dialog SHALL explain that a source is needed and offer the existing "Add source" action, and its Generate button SHALL be disabled.
4. WHEN the user confirms, THE Editor SHALL load the Rows of each selected Source through the existing source registry, then apply the Generated_Dashboard as a single store commit, so one Undo restores the previous dashboard.
5. IF a selected Source's preview fails, THEN THE Editor SHALL skip that Source, still generate from the others, and name the skipped Source in a non-blocking message.
6. WHEN the Placement_Mode is `replace` and the dashboard already has widgets, THE Editor SHALL ask for confirmation before applying.
7. WHILE Rows are loading, THE Generate_Dialog SHALL show a busy state and its Generate button SHALL be disabled.
8. THE Generate_Dialog SHALL be keyboard accessible: focus moves into it on open, Escape closes it, and focus returns to the Generate button on close.
9. AFTER applying, THE Editor SHALL autosave the dashboard through the existing autosave path.
10. THE Editor keyboard handler SHALL ignore Delete, Backspace, Undo, Redo and Duplicate shortcuts while the Generate_Dialog is open, so these keys act within the dialog and never mutate the canvas behind it.
11. WHEN a `line` or `kpi` widget has `reverseData: true`, THE widget renderer (editor and viewer) SHALL reverse each binding's rows before grouping or aggregating. THE inspector SHALL show a "Rows are newest first" toggle for both widget types.
