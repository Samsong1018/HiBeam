# Implementation Plan: Dashboard Generator

## Code style note

`generator.js` and `generate-dialog.js` live in `Web/frontend/scripts/editor/` alongside ES modules that use camelCase identifiers, K&R braces and plain `export function` declarations. They deliberately do **not** follow the `tmp`/`p` prefixes and Allman braces in `steering/format.md`, which apply to the backend. The design records this decision; the spec-consistency hook should not flag these files for style.

## Overview

JavaScript ES modules in the browser editor, no build step. The pure `generator.js` is built and tested first, then the renderer flag, then the dialog and editor wiring. Property tests use `fast-check` and run with `npm test`; each sits in its own file, `tests/generator-pN-<name>.test.mjs`, starting with `// Feature: dashboard-generator, Property N: <title>`, and shares arbitraries from `tests/generator-arbitraries.mjs`.

## Tasks

- [x] 1. Field profiling
  - [x] 1.1 Export `toNumber` from `Web/frontend/scripts/editor/data.js` without changing its behaviour
    - `tests/editor.test.mjs` still passes
    - _Requirements: 1.5_

  - [x] 1.2 Implement `profileFields(rows)` in `Web/frontend/scripts/editor/generator.js`
    - Sample the first 100 plain-object rows; first-seen order; skip names over 120 chars
    - Rules in order: empty → identifier → time → number / coded number → ordered label → category → unordered label → text
    - Ordered labels (months, clock times) may repeat; unordered labels must be unique; both need at least 2 values
    - Coded numbers need a code-like name or 0/1 values
    - _Requirements: 1.1–1.11_

  - [x] 1.3 Implement `rankNumbers(profiles)`: rates, totals/counts, money, rest
    - _Requirements: 2.2_

  - [x]* 1.4 Property test: profiling is total
    - **Property 1** · **Validates: Requirements 1.1, 1.10, 1.11** · `tests/generator-p1-profiling.test.mjs`

  - [x]* 1.5 Property test: identifiers and bare numbers
    - **Property 2** · **Validates: Requirements 1.3, 1.4** · `tests/generator-p2-identifiers.test.mjs`

- [x] 2. Widget selection and section layout
  - [x] 2.1 Implement `generateSection(source, rows, { columns, makeId, top })`
    - KPI picking with gauge/flow aggregation and `%`/`$` formatting; "Rows" count KPI when there are no measures
    - Charts only from 2 rows: time line, category bar/pie (count variants without measures), label line/bar when there is no time or category
    - `reverseData` on line and KPI when the time field is newest-first
    - Every widget has `bindings`; every binding has all four keys; titles cut to 80 chars
    - Zero rows → label + "This source returned no rows." text
    - _Requirements: 2.1–2.15_

  - [x] 2.2 Implement band layout (`layoutBands`)
    - Bands `[label]`, `[kpis]`, `[charts]`, `[table | text]`; widen to full width; heights from `scaleSize`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 2.3 Unit tests in `tests/generator.test.mjs`
    - APP2 Budget vs Actual, Net Worth, Monthly Spending, Debts; APP1 history, metrics (one row), services, nginx logs (through the real parser); time series, text only, identifiers only, zero rows; profiling edge cases; ranking; layout
    - _Requirements: 1.x, 2.x, 3.1_

  - [x]* 2.4 Property test: bindings reference the section's source and real fields
    - **Property 3** · **Validates: Requirements 2.13** · `tests/generator-p3-bindings.test.mjs`

  - [x]* 2.5 Property test: bounds for 24, 48, 72, 96 columns
    - **Property 4** · **Validates: Requirements 3.4** · `tests/generator-p4-bounds.test.mjs`

  - [x]* 2.6 Property test: no overlap
    - **Property 5** · **Validates: Requirements 3.5** · `tests/generator-p5-no-overlap.test.mjs`

  - [x]* 2.7 Property test: only measures are aggregated
    - **Property 11** · **Validates: Requirements 2.14** · `tests/generator-p11-measures.test.mjs`

- [x] 3. Checkpoint: all tests pass

- [x] 4. Whole-dashboard generation
  - [x] 4.1 Implement `generateDashboard(current, inputs, { mode, makeId })`
    - Stack sections in selection order; `append` starts at the old bottom edge and keeps the old widget objects; copy `name` and `grid`; errors `no_sources`, `too_many_widgets`, `too_tall` return `current`; never mutate inputs
    - _Requirements: 3.6, 3.7, 4.3–4.6_

  - [x]* 4.2 Property test: normalization is a no-op
    - **Property 6** · **Validates: Requirements 4.1** · `tests/generator-p6-normalize.test.mjs`

  - [x]* 4.3 Property test: determinism
    - **Property 7** · **Validates: Requirements 4.2** · `tests/generator-p7-determinism.test.mjs`

  - [x]* 4.4 Property test: immutability
    - **Property 8** · **Validates: Requirements 4.3** · `tests/generator-p8-immutability.test.mjs`

  - [x]* 4.5 Property test: append placement
    - **Property 9** · **Validates: Requirements 3.7** · `tests/generator-p9-append.test.mjs`

  - [x]* 4.6 Property test: widget caps
    - **Property 10** · **Validates: Requirements 2.15, 4.6** · `tests/generator-p10-caps.test.mjs`

- [x] 5. Newest-first rows
  - [x] 5.1 Add `reverseData: false` to the `line` and `kpi` defaults in `widget-types.js`
    - _Requirements: 2.10, 4.1_
  - [x] 5.2 Reverse each binding's rows in `widget-render.js` when `reverseData` is set (editor and viewer share it)
    - _Requirements: 5.11_
  - [x] 5.3 "Rows are newest first" toggle for line and KPI in `inspector.js`
    - _Requirements: 5.11_

- [x] 6. Editor integration
  - [x] 6.1 Generate button and `<dialog id="generate-dialog">` in `Web/frontend/pages/edit.html`
    - Source checkboxes, Replace board / Add below cards, empty state with "+ Add source", inline error, Cancel / Generate
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 6.2 `Web/frontend/scripts/editor/generate-dialog.js`
    - Default mode from widget count; `Promise.allSettled` rows; skip and name failures; confirm before replacing a non-empty board; one `store.commit`; busy state; drop late results after close; focus handling
    - _Requirements: 5.2–5.9_

  - [x] 6.3 Wire it in `main.js` (`uid` as `makeId`, the source panel's `openDialog` as `openAddSource`, toast as `notify`) and extend the shortcut guard
    - _Requirements: 4.4, 5.1, 5.10_

  - [x] 6.4 Style the dialog in `Web/frontend/style/edit.css`
    - Reuses the source dialog's type cards; designed hover, checked, focus and disabled states; overrides `.field label` so source names keep their case
    - _Requirements: 5.1, 5.7_

- [x] 7. Docs
  - [x] 7.1 Add the Generator to the README feature list and `Web/frontend/TODO.md`
    - _Requirements: 5.1_

- [x] 8. Final checkpoint: `npm test` passes; browser check with stubbed `/api/*` covers generate with a failing source, newest-first line order, undo/redo, replace confirm both ways, append default, keyboard guard, Escape/focus, empty state and "+ Add source"
- [ ] 9. Manual check against the live backend: generate once from each of the six source types on a real account
