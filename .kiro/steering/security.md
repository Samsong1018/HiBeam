---
inclusion: manual
---
# Security review (pull in with #security)

Use this when a change touches a route, a connector, auth, uploads or anything a user types. The full checklist is the security-review skill:

#[[file:.kiro/skills/security-review/SKILL.md]]

Short version, for the rules this repo has already been bitten by:
1. Owner-scoped queries, and 404 for anything that isn't yours.
2. Every outbound fetch goes through `source-connector.js`, which pins the resolved IP.
3. SQL sources stay read-only, with a timeout and a 100-row cap.
4. Public dashboards only send the columns their widgets display (`public-projection.js`).
5. No `innerHTML` with user data, and no secrets in responses or logs.
6. Never read or write `.env`. The `guard-tool-use` hook blocks it anyway.
