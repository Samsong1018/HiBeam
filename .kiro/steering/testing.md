---
inclusion: fileMatch
fileMatchPattern: ["tests/**/*.mjs", ".kiro/specs/**/*.md"]
---
# Tests

- Use the `node:test` runner with `node:assert/strict`, and `fast-check` for properties.
- **No database, no network.** Inject fakes through the `pDeps` object a router takes.
- **Property tests map to a spec.** Name the file `<spec>-p<N>-<topic>.test.mjs` and open it with:
  ```js
  // Feature: <spec>, Property <N>: <name>
  // **Validates: Requirements x.y**
  ```
- **Use real fixtures where they exist:** `APP1/agent/simulate.mjs` (homelab rows) and the APP2 workbook shapes. A rule change that breaks a showcase board should fail a test.
- To write a new property test, ask the `pbt-writer` agent.
