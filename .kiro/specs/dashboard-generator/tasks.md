# Implementation Plan: Dashboard Generator

## Overview

Implementation is in JavaScript ES modules in the browser editor, with no build step, matching the other files in `Web/frontend/scripts/editor/`. The pure module `generator.js` is built and property-tested first, then the dialog and editor wiring. Property tests use `fast-check` and run with `npm test`. Each property test sits in its own file, `tests/generator-pN-<name>.test.mjs`, and starts with the comment `// Feature: dashboard-generator, Property N: <title>`.

## Tasks

- [ ] 1. Field profiling
  - [ ] 1.1 Export `toNumber` from `Web/frontend/scripts/editor/data.js` without changing its behaviour
    - Re-run `tests/editor.test.mjs` to confirm nothing changed
    - _Requirements: 1.4_

  - [ ] 1.2 Implement `profileFields(rows)` in `Web/frontend/scripts/editor/generator.js`
    - Sample the first 100 plain-object rows; first-seen field order; `distinct` and `presentCount`
    - Apply the Role rules in the design's order: empty, identifier name, time (`ISO_DATE` / `SLASH_DATE` + `Date.parse`), number, category, text
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [ ]* 1.3 Write property test for total profiling
    - **Property 1: Profiling is total**
    - **Validates: Requirements 1.1, 1.9, 1.10**
    - File: `tests/generator-p1-profiling.test.mjs`

  - [ ]* 1.4 Write property test for identifier and bare-number rules
    - **Property 2: Identifiers and bare numbers**
    - **Validates: Requirements 1.7, 1.8**
    - File: `tests/generator-p2-identifiers.test.mjs`

- [ ] 2. Widget selection and section layout
  - [ ] 2.1 Implement widget picking in `generateSection(source, rows, { columns, makeId })`
    - Follow the picking table in the design; every binding has all four keys; configs start from `structuredClone(WIDGET_TYPES[type].defaults)`; titles cut to 80 characters
    - Zero rows → label + "This source returned no rows." text widget
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [ ] 2.2 Implement band layout
    - Bands `[label]`, `[kpis]`, `[line, bar, pie]`, `[table | text]`, skipping empty ones; widen each band to the full width; heights from `scaleSize`; band height = tallest widget
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ] 2.3 Write unit tests for the fixture shapes in `tests/generator.test.mjs`
    - Fixtures: time series, category table, logs, text only, empty, identifier columns
    - Assert exact widget types, bindings and band order
    - _Requirements: 2.1–2.9, 3.1_

  - [ ]* 2.4 Write property test for bindings referencing real fields
    - **Property 3: Bindings reference the section's source and real fields**
    - **Validates: Requirements 2.10**
    - File: `tests/generator-p3-bindings.test.mjs`

  - [ ]* 2.5 Write property test for layout bounds
    - **Property 4: Bounds**
    - **Validates: Requirements 3.4**
    - Run for each of 24, 48, 72, 96 columns
    - File: `tests/generator-p4-bounds.test.mjs`

  - [ ]* 2.6 Write property test for no overlap
    - **Property 5: No two widgets overlap**
    - **Validates: Requirements 3.5**
    - File: `tests/generator-p5-no-overlap.test.mjs`

- [ ] 3. Checkpoint: make sure all tests pass, ask the user if questions arise

- [ ] 4. Whole-dashboard generation
  - [ ] 4.1 Implement `generateDashboard(current, inputs, { mode, makeId })`
    - Stack sections in selection order; `append` offsets by the old bottom edge; copy `name` and `grid` from `current`; over 200 widgets → `{ dashboard: current, error: 'too_many_widgets' }`; never mutate inputs
    - _Requirements: 3.6, 3.7, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 4.2 Write property test for normalization being a no-op
    - **Property 6: normalizeDashboard leaves generated output unchanged**
    - **Validates: Requirements 4.1**
    - File: `tests/generator-p6-normalize.test.mjs`

  - [ ]* 4.3 Write property test for determinism
    - **Property 7: Determinism**
    - **Validates: Requirements 4.2**
    - Use a counter-based `makeId` reset before each run
    - File: `tests/generator-p7-determinism.test.mjs`

  - [ ]* 4.4 Write property test for immutability
    - **Property 8: Inputs are not modified**
    - **Validates: Requirements 4.3**
    - File: `tests/generator-p8-immutability.test.mjs`

  - [ ]* 4.5 Write property test for append placement
    - **Property 9: Append places new widgets below and keeps old ones**
    - **Validates: Requirements 3.7**
    - File: `tests/generator-p9-append.test.mjs`

  - [ ]* 4.6 Write property test for widget caps
    - **Property 10: Section and dashboard widget caps**
    - **Validates: Requirements 2.11, 4.6**
    - File: `tests/generator-p10-caps.test.mjs`

- [ ] 5. Checkpoint: make sure all tests pass, ask the user if questions arise

- [ ] 6. Editor integration
  - [ ] 6.1 Add the Generate button and dialog markup to `Web/frontend/pages/edit.html`
    - Button in the toolbar group next to Save; `<dialog id="generate-dialog">` with a source checkbox list, a Replace / Add below radio pair, a busy indicator, an empty state with "Add source", and Cancel / Generate buttons
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ] 6.2 Implement `Web/frontend/scripts/editor/generate-dialog.js`
    - `createGenerateDialog({ dialog, openButton, registry, store, makeId, notify, openAddSource })`
    - Default mode from widget count; load rows with `Promise.allSettled`; skip and name failed sources; confirm before replacing a non-empty dashboard; one `store.commit`; busy state; focus handling
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [ ] 6.3 Wire the dialog in `Web/frontend/scripts/editor/main.js`
    - Pass `uid` from `dom.js` as `makeId`, and the source panel's open action as `openAddSource`
    - _Requirements: 4.4, 5.1_

  - [ ] 6.4 Style the dialog in `Web/frontend/style/edit.css`
    - Reuse the source dialog's layout classes; designed hover, focus and disabled states for the button
    - _Requirements: 5.1, 5.7_

- [ ] 7. Docs
  - [ ] 7.1 Add the Generator to the README feature list, and tick the editor item in `Web/frontend/TODO.md`
    - _Requirements: 5.1_

- [ ] 8. Final checkpoint: run `npm test`, then generate from each of the six source types in the running editor and check undo, replace confirmation, append and keyboard use
