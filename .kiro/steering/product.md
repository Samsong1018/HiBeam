---
inclusion: always
---
# Product

HiBeam is a self-hosted dashboard builder, made for Kiroween 2026 in the **Skeleton Crew** category. You connect a data source, put widgets on a grid, and share the board as a public link or export it as a PNG/PDF.

## The skeleton rule
`Web/` is the skeleton. `APP1/` (Homelab Ops) and `APP2/` (Monthly Money Report) are two different apps built on it. **An app never changes `Web/`.** If an app needs something the skeleton can't do, add it to the skeleton as a general feature that any board can use (a KPI threshold, not "the CPU tile turns red"). Then use it from the app's template or scripts.

## Who it's for
- **The homelabber.** Runs a box at home and wants a status page they can glance at or share. Data is live (REST, logs) and refreshes every 30s.
- **The spreadsheet person.** Keeps a budget or a weekly report in Excel and wants it as a clean page or a PDF without learning a BI tool.

## What to optimize for
1. **Correct numbers.** A wrong board is worse than no board. Never add up IDs or status codes, show the latest value for rates and balances, keep time axes in order.
2. **Boards that read well at a glance**, in light, dark and the Kiroween theme.
3. **Safety by default.** Owner-scoped data, no credentials in the browser, SSRF guards. See `#security`.
