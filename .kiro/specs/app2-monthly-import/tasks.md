# Implementation Plan: APP2 Monthly Import

## Code style note
`APP2/import/*.mjs` follows APP1's agent style, which is the backend style: `tmp`/`p` prefixes, PascalCase functions and Allman braces.

## Tasks

- [x] 1. Read the workbook
  - [x] 1.1 `ReadWorkbook(path)`: exceljs, header row to keys, formula results, rich text, extension and 5 MB checks
    - _Requirements: 1.1, 1.3, 1.4_
  - [x] 1.2 `CheckSheets(sheets)`: required sheets and columns, with an error that names what's missing
    - _Requirements: 1.2_

- [x] 2. Report
  - [x] 2.1 `BuildReport(sheets, { year })`: month, totals, savings detection, caption sentences in a fixed order
    - _Requirements: 2.1–2.6, 2.8_
  - [x]* 2.2 Property test: determinism and no mutation
    - **Property 1** · **Validates: Requirements 2.7** · `tests/app2-import-p1-determinism.test.mjs`
  - [x]* 2.3 Property test: overspend accuracy
    - **Property 2** · **Validates: Requirements 2.2** · `tests/app2-import-p2-overspend.test.mjs`
  - [x]* 2.4 Property test: caption bound
    - **Property 3** · **Validates: Requirements 2.8** · `tests/app2-import-p1-determinism.test.mjs`
  - [x] 2.5 Unit test: the sample workbook gives the expected November caption
    - _Requirements: 2.2–2.6_

- [x] 3. Board update
  - [x] 3.1 `ApplyReport(definition, report)`: title, donut title, note, spend thresholds; warns about missing widgets
    - _Requirements: 3.1–3.4_
  - [x]* 3.2 Property test: surgical update and thresholds
    - **Property 4, 5** · **Validates: Requirements 3.2, 3.3** · `tests/app2-import-p4-apply.test.mjs`

- [x] 4. CLI
  - [x] 4.1 `hibeam-client.mjs`: login from env or `mcp/.env`, retry once on 401, never log the password
    - _Requirements: 4.4_
  - [x] 4.2 `monthly-import.mjs`: `--setup`, `--dry-run`, `--year`, `--state`; upload and test everything before the PATCH
    - _Requirements: 4.1–4.3, 4.5_
  - [x] 4.3 `state.json` gitignored; README section for the monthly run

- [x] 5. Checkpoint: run `--setup` and one monthly run against a live HiBeam, then export the PDF from the viewer
  - `--setup` built a full board (5 sources uploaded and tested, 13 widgets with data), then the test board and sources were deleted. A monthly run updated the real APP2 board, and the viewer's PDF export showed the new caption, the spend warning and the net worth change.
