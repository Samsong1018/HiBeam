---
name: security-review
description: Review code changes in this project for security problems. Use when writing or modifying backend routes, connectors, validators, auth flows, or anything that handles user input, credentials, or external data fetches.
---

# HiBeam Security Review

This project has a defined security model. When reviewing any change, check every applicable rule below and report findings with the file, line, and a one-line fix. Do not report rules that don't apply to the change.

---

## 1. Owner-scoped queries

Every SQL query that touches user data must include an `owner_id` (or `userId`) condition.
Check `lib/repos/` — every repo function accepts an owner parameter and passes it to the query.
A query that fetches by `id` alone is a broken access control bug (OWASP A01).

**Check:** Does the route extract the owner from `req.userId` (set by `requireSession`) and pass it to the repo? Does the repo include it in the `WHERE` clause? A missing id returns 404, never 403 — do not change that behaviour.

---

## 2. SSRF protection on source fetches

All outbound HTTP requests go through `lib/source-connector.js → ResolveSafeAddress → IsBlockedAddress`.
This blocks all RFC-1918 private ranges, loopback, link-local, CGNAT, multicast, and IPv6 equivalents including 6to4, NAT64, and `::ffff:` mapped addresses.

**Check:** Any new code that makes an outbound HTTP/HTTPS request must route through `FetchText` (or the full `ResolveSafeAddress` + pinned transport chain). Direct use of `fetch`, `axios`, `http.get`, or `https.get` with a user-supplied URL is a critical SSRF vulnerability.

Additional rules already enforced — do not remove them:
- No redirects are followed (the transport uses a custom `lookup` that pins to the vetted address).
- Credentials in URLs (`user:pass@host`) are rejected in `ParseSourceUrl`.
- Only `http:` and `https:` protocols are allowed.

---

## 3. Source credentials at rest

Source credentials (API keys, bearer tokens, SQL connection strings) are stored encrypted with AES-256-GCM in `lib/crypto-box.js`. The key is `SOURCE_KEY_SECRET` from the environment.

**Check:**
- Credentials must never be stored or logged as plaintext.
- `decryptKey` output must never be sent to the browser. `lib/public-projection.js` and the source repo's `toSourceView` strip `key_enc`; any new API response involving a source must go through one of these.
- `last4(plain)` is the only portion of a credential that may be shown to the user.
- `SOURCE_KEY_SECRET` must never appear in source code, logs, or API responses.

---

## 4. Input validation at trust boundaries

All user input entering the backend is validated through `lib/validators.js` (custom checkers) or `zod` schemas before it reaches a repo or connector.

**Check:**
- New route parameters, query strings, and request bodies must be validated before use.
- Use the existing `run()` / `single()` helpers in `validators.js` or a `zod` schema — do not write ad-hoc string checks inline in a route.
- Dashboard definitions must pass `validateDashboardDefinition` (zod, strict mode) before storage or rendering.
- `isValidId` must gate every `:id` route parameter before it reaches the DB.

---

## 5. Response envelope and error leakage

All API responses use the `ok()` / `fail()` helpers from `lib/envelope.js`.

**Check:**
- Routes must call `ok(res, data)` or `fail(res, status, message)` — never `res.json(rawObject)` directly.
- `fail()` messages must be generic. Driver errors, stack traces, SQL errors, and upstream response bodies must never be passed to `fail()` or logged at a level visible to the client.
- `SourceError.reason` is a fixed string from the `REASONS` map — it is safe to surface. Raw `Error.message` from a driver or upstream is not.

---

## 6. No `innerHTML` with user data

The frontend builds dynamic content with DOM APIs (`textContent`, `createElement`, `appendChild`).

**Check:** Any new frontend code that renders user-supplied values (dashboard names, source names, widget content) must use `textContent`, not `innerHTML` or `insertAdjacentHTML`. Template literals assigned to `innerHTML` are only safe when the content is entirely developer-controlled (static strings, no user values).

---

## 7. Rate limits on sensitive endpoints

Sensitive operations are protected in `lib/security.js`:
- `login`: 30 req / 15 min / IP
- `authSensitive` (signup, forgot-password, reset-password): 10 req / 15 min / IP
- `sourceFetch` (source test/preview, dashboard data): 120 req / min / user
- `publicDashboards`: 120 req / min / IP

**Check:** Any new route that (a) performs authentication, (b) makes an outbound fetch, or (c) is unauthenticated and publicly reachable must be covered by one of the existing limiters or a new one with a justified window and limit. A new limiter must use `fail(res, 429, TOO_MANY)` as its handler, not the default express-rate-limit HTML response.

---

## 8. Session and cookie hygiene

Sessions are `HttpOnly`, `SameSite=Lax` cookies set in `lib/session.js`. In production (`NODE_ENV=production`) they gain the `Secure` flag.

**Check:**
- Do not set cookies outside `lib/session.js`.
- `requireSession` (from `lib/require-session.js`) must guard every route that accesses user data. It sets `req.userId` and `req.sessionId` — downstream code may rely on these being present once the middleware runs.
- Token expiry and session revocation are enforced at lookup time in the repos; do not cache session objects across requests.

---

## 9. SQL connector constraints

The SQL connector (`lib/connectors/sql.js`) runs queries in a read-only transaction with a timeout and a 100-row cap.

**Check:**
- Only a single `SELECT` is allowed — the connector rejects anything else.
- Only MySQL/MariaDB connection strings are accepted — other DB types are rejected before a connection is attempted.
- The DB host is resolved through `resolveSafeAddress` before connection — the same SSRF rules apply.
- Do not increase `MAX_ROWS` (100) or the query timeout without a documented reason.

---

## Reporting format

For each finding, state:
1. **Rule** — which numbered rule above it violates
2. **File and line** — exact location
3. **Finding** — one sentence describing the problem
4. **Fix** — the minimal change that closes it

If no rules are violated, say so explicitly and briefly.
