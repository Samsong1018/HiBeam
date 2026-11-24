---
inclusion: fileMatch
fileMatchPattern: ["Web/backend/**/*.js", "mcp/**/*.mjs"]
---
# Backend conventions

## Naming and braces (backend and MCP only)
The frontend does not use these rules. Don't "fix" frontend files to match.
- Globals `_name`, locals `tmpName`, parameters `pName`, required libraries `libName`
- Functions in PascalCase (`CreateSourcesRouter`, `ToIso`)
- Allman braces: the opening brace goes on its own line for functions and blocks

## Rules every route follows
- **Envelope.** Respond through `ok()` / `fail()` from `lib/envelope.js`: `{ success, data }` or `{ success: false, error }`.
- **Owner scoping.** Take the owner from `req.userId` and pass it to the repo. A row that isn't yours is a **404, never a 403**.
- **Validate at the edge.** Put new input shapes in `lib/validators.js` with `zod`. Dashboard definitions are `.strict()`, so a new top-level field has to be added there **and** to `BuildDefinition` in the MCP server.
- **Outbound requests** go through `lib/source-connector.js`. Never call `fetch` on a user-supplied URL anywhere else.
- **Generic errors.** Don't echo stack traces, SQL errors or upstream bodies to the client.
- **Dependency injection.** Routers take a `pDeps` object, so tests can pass fakes. Keep that pattern.

The schema, for column names:
#[[file:Web/backend/db/schema.sql]]

The routes and their callers have to agree. The `api-contract-sync` hook checks this whenever a route file is saved.
