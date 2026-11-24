# Requirements Document

## Introduction

APP2 (Monthly Money Report) turns one budget workbook into a board and a PDF. Today the monthly update is manual: re-upload the workbook to five sources, then edit the board's title, the "Where November went" chart title and the hand-written "This month" text box. This feature adds a monthly import pipeline. You give it next month's workbook, and it updates every source, rewrites the month-specific text from the numbers with fixed rules, and moves the spending alert to the new budget total.

The pipeline lives entirely in `APP2/import/`. It talks to HiBeam only over its public REST API, so the skeleton (`Web/`) doesn't change. That is the Skeleton Crew rule.

Out of scope: LLM-written captions, server-side PDF rendering (the PDF still comes from the viewer's Export button), and workbooks with different sheet names or headers.

## Glossary

- **Workbook**: an `.xlsx` with the sheets `Budget vs Actual`, `Monthly Spending`, `Net Worth`, `Accounts` and `Debts`. `Profile` is optional.
- **Report**: what the pipeline works out from a Workbook: the month, the totals and the caption sentences.
- **Board**: the APP2 dashboard, built from `APP2/dashboard.template.json`.
- **State file**: `APP2/import/state.json`, which maps each sheet to its source id and holds the board id. It's created by `--setup` and gitignored.
- **Savings line**: a budget category named like savings, investing or retirement. For these, spending less than the budget is the bad direction.

## Requirements

### Requirement 1: Read and check the workbook

**User Story:** As someone with a budget spreadsheet, I want a bad file rejected before anything is uploaded, so my board never ends up half-updated.

#### Acceptance Criteria
1.1 WHEN the pipeline reads a Workbook THE pipeline SHALL turn each required sheet into rows keyed by that sheet's header row.
1.2 IF a required sheet is missing, or is missing a required column, THEN THE pipeline SHALL stop before any network call and name the sheet and column.
1.3 THE pipeline SHALL use a formula cell's cached result, and SHALL treat rich-text cells as their plain text.
1.4 IF the file isn't `.xlsx`, or is larger than 5 MB, THEN THE pipeline SHALL stop with a clear message.

### Requirement 2: Work out the report with fixed rules

**User Story:** As the reader of the report, I want the "This month" text to always match the numbers, so I don't have to rewrite it by hand.

#### Acceptance Criteria
2.1 THE Report month SHALL be the last row's `Month` in `Monthly Spending`, with the year taken from `--year` or, if that isn't given, the current year.
2.2 THE caption SHALL name up to two non-savings categories that went furthest over budget, with the amount over. IF none went over, THEN it SHALL say spending stayed within budget in every category.
2.3 WHEN there is a Savings line THE caption SHALL say whether it hit its target or by how much it came in under.
2.4 WHEN `Net Worth` has at least two rows THE caption SHALL give the change from the previous month and the new total.
2.5 WHEN `Monthly Spending` has at least two rows THE caption SHALL compare this month's spending with the previous month's.
2.6 WHEN `Debts` has rows THE caption SHALL name the debt with the highest APR as first in line for extra payments.
2.7 THE Report SHALL be a pure function of the Workbook rows and the year: the same input always gives the same text, and its inputs are never mutated.
2.8 THE caption SHALL be at most 4000 characters, the text widget's limit.

### Requirement 3: Update the board

**User Story:** As the board's owner, I want the board to show the new month without opening the editor.

#### Acceptance Criteria
3.1 THE pipeline SHALL set the title label (`w_title`) to `<Name> · <Month Year>`, the donut title (`w_where`) to `Where <Month> went`, and the text box (`w_note`) body to the caption.
3.2 THE pipeline SHALL set the "Spent this month" KPI (`w_spent`) to `alertAt` = the budget total and `warnAt` = 95% of it, rounded to whole dollars, with `higherIs: "bad"`.
3.3 THE pipeline SHALL leave every other widget, its position and the grid unchanged, and SHALL return a new definition without mutating the old one.
3.4 IF the Board is missing any of `w_title`, `w_where`, `w_note` or `w_spent`, THEN THE pipeline SHALL skip that update and warn, not fail.

### Requirement 4: Run it

**User Story:** As the board's owner, I want one command each month.

#### Acceptance Criteria
4.1 `--setup` SHALL create one Excel source per required sheet, upload the Workbook to each, test them, create the Board from the template with every placeholder swapped for its source id, and write the State file.
4.2 A normal run SHALL upload the Workbook to every source in the State file, test each, then update the Board, and SHALL print the board's view link and a suggested PDF file name `money-report-YYYY-MM.pdf`.
4.3 `--dry-run` SHALL print the Report and make no network calls.
4.4 THE pipeline SHALL log in with `HIBEAM_BASE_URL`, `HIBEAM_USERNAME` and `HIBEAM_PASSWORD` from the environment or `mcp/.env`. It SHALL never print the password.
4.5 IF any upload or test fails, THEN THE pipeline SHALL NOT update the Board, and SHALL exit non-zero naming the failed sheet.
