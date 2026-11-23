# Requirements Document

## Introduction

This feature makes DashGen generate dashboards. Today every dashboard is built by hand: the user adds a source, drags widgets onto the grid and binds each one to fields. The Generator looks at the rows a source returns, works out what each field is (a number, a date, a category, free text), and proposes a finished layout of KPI tiles, charts and a table. The user can then adjust that layout in the editor like any other dashboard.

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
- **Field**: A key that appears in at least one of the sampled Rows.
- **Sample**: The first 100 Rows of a Source, or all of them if there are fewer.
- **Present_Values**: The values of a Field across the Sample, excluding `null`, `undefined` and the empty string.
- **Field_Profile**: The Generator's description of one Field: `{ name, role, distinct, presentCount }`.
- **Role**: One of `time`, `number`, `category`, `text`, `empty`.
- **Generated_Section**: The widgets the Generator produces for one Source.
- **Generated_Dashboard**: A dashboard document `{ name, grid, widgets }` returned by the Generator.
- **Grid_Columns**: The dashboard's column count, one of 24, 48, 72, 96.
- **Generate_Dialog**: The Editor dialog in which the user picks Sources and a placement mode.
- **Placement_Mode**: `replace` (the Generated_Dashboard replaces all current widgets) or `append` (the generated widgets are added below the current ones).

## Requirements

### Requirement 1: Field profiling

**User Story:** As a user, I want DashGen to understand what my columns contain, so that it picks sensible charts without me configuring each one.

#### Acceptance Criteria

1. WHEN the Generator profiles Rows, THE Generator SHALL return one Field_Profile per Field in the Sample, in first-seen order.
2. IF a Field has no Present_Values, THEN THE Generator SHALL assign it the Role `empty`.
3. IF every Present_Value of a Field parses as a date or timestamp (an ISO 8601 date or date-time string, or a `YYYY/MM/DD` string), THEN THE Generator SHALL assign it the Role `time`.
4. IF a Field is not `time` and every Present_Value parses as a number using the same rules as `data.js` (commas, `$`, `%` and whitespace ignored), THEN THE Generator SHALL assign it the Role `number`.
5. IF a Field is neither `time` nor `number` and its distinct Present_Values number from 2 to 12 and are at most half of its Present_Values, THEN THE Generator SHALL assign it the Role `category`.
6. IF a Field matches none of criteria 2 to 5, THEN THE Generator SHALL assign it the Role `text`.
7. WHERE a Field's name is `id` or ends with `_id` or `Id`, THE Generator SHALL assign it the Role `text` even if its values are numeric, so identifiers are never summed or charted.
8. THE Generator SHALL treat a bare number (for example `2024` or `1700000000`) as a `number`, not a `time`.
9. THE Generator SHALL ignore Rows that are not plain objects.
10. FOR ALL Rows, profiling SHALL return exactly one Role per Field, and that Role SHALL be one of the five Roles (total-function property).

### Requirement 2: Widget selection for one Source

**User Story:** As a user, I want a generated layout that shows the most useful views of my data first, so that the dashboard is useful straight away.

#### Acceptance Criteria

1. THE Generator SHALL start each Generated_Section with a `label` widget whose text is the Source name.
2. WHEN a Source has at least one `number` Field, THE Generator SHALL add one `kpi` widget for each of the first three `number` Fields, titled with the Field name. The aggregation SHALL be `last` if the Source has a `time` Field and `sum` otherwise.
3. WHEN a Source has no `number` Field and at least one Row, THE Generator SHALL add one `kpi` widget that shows the row count (`agg: 'count'`).
4. WHEN a Source has a `time` Field and at least one `number` Field, THE Generator SHALL add one `line` widget with the first `time` Field as `xField` and one binding per `number` Field, up to the first three, with `agg: 'sum'`.
5. WHEN a Source has a `category` Field and at least one `number` Field, THE Generator SHALL add one `bar` widget with the first `category` Field as `xField` and the first `number` Field as `yField`, with `agg: 'sum'`.
6. WHEN a Source has a `category` Field with at most 6 distinct values and at least one `number` Field, THE Generator SHALL also add a `pie` widget using the same category and number Fields.
7. WHEN a Source has a `category` Field and no `number` Field, THE Generator SHALL add one `bar` widget that counts Rows per category (`agg: 'count'`).
8. WHEN a Source has at least one Row, THE Generator SHALL end the Generated_Section with a `table` widget bound to the Source.
9. IF a Source has zero Rows, THEN THE Generated_Section SHALL contain only the `label` widget and one `text` widget saying the source returned no rows.
10. THE Generator SHALL set `sourceId` on every binding to the id of the Source it was generated from and SHALL only use Field names that exist in that Source's Sample.
11. THE Generator SHALL produce at most 10 widgets per Generated_Section.

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
6. IF appending would make the dashboard exceed the 200-widget limit, THEN THE Generator SHALL return the dashboard unchanged and report the reason `too_many_widgets`.

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
