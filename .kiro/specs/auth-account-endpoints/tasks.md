# Implementation Plan: Auth, Account, Sources and Dashboards Endpoints

## Overview

Implementation is in JavaScript (Node.js, CommonJS backend, Express 5, `mysql`, `zod`). Logic is split into small modules under `Web/backend/lib/`. `server.js` only wires them together. Pure modules are built and tested first, then repositories and routes, then `server.js` wiring and the `api.js` client. Property tests use `fast-check` and run with `npm test` (`node --test tests/*.test.mjs`). Each property test sits in its own file `tests/auth-pN-<name>.test.mjs` and carries the comment `// Feature: auth-account-endpoints, Property N: <title>`.

## Tasks

- [x] 1. Project setup
  - [x] 1.1 Install dependencies and document environment variables
    - Run `npm install bcrypt` and `npm install --save-dev fast-check`
    - Confirm the `test` script in `package.json` runs `node --test tests/*.test.mjs`
    - Add `SOURCE_KEY_SECRET` (32 bytes, base64) and optional `APP_BASE_URL` placeholders to `.env` only if missing (no real secret values committed), and mention them in `README.md`
    - _Requirements: 1.1, 16.4, 16.6_

  - [x] 1.2 Create the database schema
    - Create `Web/backend/db/schema.sql` with the tables `users` (including `avatar`, `avatar_mime`, `avatar_updated_at`), `sessions`, `reset_tokens`, `email_tokens`, `login_attempts`, `sources`, `dashboards` exactly as in the design
    - Include unique indexes on `username_lc` and `email_lc`, owner indexes, and the `ON DELETE CASCADE` foreign keys
    - _Requirements: 2.5, 2.6, 8.8, 13.2_

- [x] 2. Response envelope and error middleware
  - [x] 2.1 Implement `Web/backend/lib/envelope.js`
    - `HttpError(status, message)`, `ok(res, status, data)`, `fail(res, status, error)`, `errorMiddleware`
    - Map `express.json()` parse errors and body-too-large errors to 400; map every other error to 500 with the fixed generic message, logging details server-side only with secrets scrubbed
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x]* 2.2 Write property test for envelope format
    - **Property 14: Envelope format**
    - **Validates: Requirements 16.1, 16.2, 16.5**
    - File: `tests/auth-p14-envelope.test.mjs`

  - [x]* 2.3 Write property test for generic unexpected errors
    - **Property 15: Unexpected errors are generic**
    - **Validates: Requirements 16.3, 16.4**
    - File: `tests/auth-p15-generic-errors.test.mjs`

- [x] 3. Password hashing
  - [x] 3.1 Implement `Web/backend/lib/passwords.js`
    - `hashPassword` (default cost 12, cost overridable), `verifyPassword` (never throws, false for invalid hash), `byteLength`, `checkPasswordRules`, `DUMMY_HASH`
    - Measure length with `Buffer.byteLength(p, 'utf8')`
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 3.4_

  - [x]* 3.2 Write property test for bcrypt round trip
    - **Property 1: bcrypt round trip**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
    - Use `cost: 10`; add a unit test that the production default cost is at least 10
    - File: `tests/auth-p1-bcrypt.test.mjs`

  - [x]* 3.3 Write property test for invalid stored hashes
    - **Property 2: Invalid stored hashes never verify**
    - **Validates: Requirements 1.7**
    - File: `tests/auth-p2-invalid-hash.test.mjs`

  - [x]* 3.4 Write property test for byte-based password length rules
    - **Property 3: Password length rules are measured in bytes**
    - **Validates: Requirements 1.5, 1.6, 2.2, 5.6, 9.3**
    - File: `tests/auth-p3-password-length.test.mjs`

- [x] 4. Validators
  - [x] 4.1 Implement `Web/backend/lib/validators.js`
    - `validateSignup`, `validateLogin`, `validateEmail`, `validateUsername`, `validateDisplayName`, `validateNewPassword`, `validateProfile`, `validatePreferences`, `validateChangePassword`, `validateChangeEmail`, `validateSourceInput`, `isValidId`, `validateDashboardDefinition` (strict zod schema), `collectSourceIds`
    - Return `{ ok, value }` or `{ ok: false, fields }`; handle an undefined body
    - _Requirements: 2.2, 2.3, 2.5, 3.6, 5.3, 7.1, 7.2, 7.3, 9.3, 9.5, 10.3, 11.2, 14.3, 14.10, 15.7, 15.8_

  - [x]* 4.2 Write property test for signup validation and normalization
    - **Property 4: Signup validation and normalization**
    - **Validates: Requirements 2.2, 2.3, 2.5**
    - File: `tests/auth-p4-signup-validation.test.mjs`

  - [x]* 4.3 Write property test for preferences validation
    - **Property 10: Preferences validation**
    - **Validates: Requirements 11.1, 11.2**
    - File: `tests/auth-p10-preferences.test.mjs`

  - [x]* 4.4 Write property test for id validation
    - **Property 12: Id validation** (the `isValidId` part; route-level 400 is checked in task 12.2)
    - **Validates: Requirements 14.10**
    - File: `tests/auth-p12-id-validation.test.mjs`

- [x] 5. Sessions, tokens and lockout
  - [x] 5.1 Implement `Web/backend/lib/session.js` and `Web/backend/lib/tokens.js`
    - `newSessionToken`, `buildSessionCookie` (HttpOnly, SameSite=Lax, Max-Age=604800, Secure in production), `buildClearCookie`, `parseCookies`, `isSessionValid`
    - Reset and email token creation (32 random bytes) and SHA-256 hashing
    - _Requirements: 3.2, 4.3, 5.2, 10.1_

  - [x]* 5.2 Write property test for session validity
    - **Property 7: Session validity**
    - **Validates: Requirements 4.3**
    - File: `tests/auth-p7-session-validity.test.mjs`

  - [x] 5.3 Implement `Web/backend/lib/lockout.js`
    - Pure `evaluateLockout(attempts, now)` returning `{ locked, retryAfterSeconds }` per the design rule
    - _Requirements: 3.5, 3.7_

  - [x]* 5.4 Write property test for the lockout state machine
    - **Property 6: Login lockout state machine**
    - **Validates: Requirements 3.5, 3.7**
    - File: `tests/auth-p6-lockout.test.mjs`

- [x] 6. Image detection and avatar URL
  - [x] 6.1 Implement `Web/backend/lib/image.js`
    - `detectImageType` (PNG, JPEG, WebP magic bytes), `mimeFor`, `checkAvatar` (`missing`, `too_large` above 2,097,152 bytes, `unsupported`), `avatarUrl(epochSeconds)` returning `/api/account/avatar?v=<n>` or `null`
    - _Requirements: 6.7, 6.8, 6.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.8_

  - [ ]* 6.2 Write property test for content-based avatar type
    - **Property 9: Avatar type comes from content**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
    - File: `tests/auth-p9-avatar-type.test.mjs`

  - [ ]* 6.3 Write property test for the avatar URL format
    - **Property 20: Avatar URL format**
    - **Validates: Requirements 6.7, 6.8, 6.9, 8.8**
    - File: `tests/auth-p20-avatar-url.test.mjs`

- [x] 7. Source key encryption and public views
  - [x] 7.1 Implement `Web/backend/lib/crypto-box.js` and `Web/backend/lib/views.js`
    - `encryptKey`/`decryptKey` (AES-256-GCM using `SOURCE_KEY_SECRET`), `last4`
    - `toPublicProfile` and `toSourceView` using explicit allow-lists; `avatarUrl` computed from `avatar_updated_at` only
    - _Requirements: 1.8, 6.1, 6.3, 6.9, 14.4_

  - [x]* 7.2 Write property test for public views
    - **Property 5: Public views never expose secrets**
    - **Validates: Requirements 1.8, 6.3, 14.4**
    - File: `tests/auth-p5-public-views.test.mjs`

- [x] 8. Static allowlist for `/backend/`
  - [x] 8.1 Implement `Web/backend/lib/static-allowlist.js`
    - Pure `resolveStaticRequest(rawUrl, method)` following the five ordered steps in the design (method, prefix and directory, encoded traversal reject, single decode, exact case-sensitive allowlist match of `api.js` only)
    - `staticAllowlist({ dir })` middleware: reads the file with `fs.readFile`, sends `application/javascript; charset=utf-8` and `X-Content-Type-Options: nosniff`, returns the same fixed 404 envelope for every reject and for read errors; no `express.static`, no `res.sendFile`, no `readdir`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10_

  - [x]* 8.2 Write property test for allowlist-only serving
    - **Property 21: Static route serves only the allowlist**
    - **Validates: Requirements 18.1, 18.2, 18.4, 18.5, 18.6, 18.7, 18.8**
    - File: `tests/auth-p21-static-allowlist.test.mjs`

  - [x]* 8.3 Write property test for no disclosure of other files
    - **Property 22: Static route does not disclose other files**
    - **Validates: Requirements 18.3, 18.9, 18.10**
    - Use a temporary directory containing `api.js`, a fake `server.js`, and `lib/secret.js` with unique marker strings
    - File: `tests/auth-p22-static-no-disclosure.test.mjs`

- [ ] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Infrastructure: config, database, repositories, connector, session middleware
  - [x] 10.1 Implement `Web/backend/lib/config.js` and `Web/backend/lib/db.js`
    - `config.js` checks `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SOURCE_KEY_SECRET` and reports the name (never the value) of any missing variable
    - `db.js` creates a `mysql.createPool`, exposes promise-based `query(sql, params)` and `withTransaction(fn)` (rolls back and rethrows on error); values enter SQL only through `?` placeholders
    - _Requirements: 13.5, 16.4, 16.6_

  - [x] 10.2 Implement repositories in `Web/backend/lib/repos/`
    - `users.js`, `sessions.js`, `tokens.js`, `sources.js`, `dashboards.js`, plus login-attempt recording
    - Every function takes `userId` first and puts the owner condition in every SELECT, UPDATE, and DELETE; the only exceptions are token-hash lookups and login-identifier lookup
    - Include `revokeAllExcept`, the conditional token-consume UPDATE (`used_at IS NULL AND expires_at > NOW()` checked through `affectedRows`), and the account-deletion statements
    - _Requirements: 2.4, 2.6, 5.5, 9.4, 12.1, 12.3, 13.2, 13.5_

  - [x] 10.3 Implement `Web/backend/lib/source-connector.js`
    - `testSource` and `previewSource` with a 10-second timeout; `rest` and `json` implemented, other types return `failed` / 502 with a fixed reason
    - Preview capped at 100 rows; outbound URLs limited to http/https and blocked for loopback, link-local, and private ranges; failure reasons come from a fixed message set
    - _Requirements: 14.6, 14.7, 14.8, 14.9_

  - [x] 10.4 Implement the `requireSession` middleware
    - Hash the `sid` cookie token, look up an unrevoked, unexpired session joined to its user, set `req.userId` and `req.sessionId`, otherwise return 401 through `fail()` without running any other query
    - _Requirements: 4.2, 4.3, 13.1, 13.6_

  - [ ]* 10.5 Create in-memory fake repositories for tests
    - `tests/helpers/fake-repos.mjs` with a `Map`-backed implementation of the same interface as `lib/repos/*`, plus a helper that builds an Express app from the route factories
    - _Requirements: 13.2, 13.4_

  - [ ]* 10.6 Write unit tests for the source connector
    - Stubbed transport, 10-second timeout with fake timers, blocked private addresses, 100-row cap
    - _Requirements: 14.6, 14.7, 14.8, 14.9_

- [x] 11. Routes
  - [x] 11.1 Implement `Web/backend/lib/routes/auth.js`
    - `POST /api/auth/signup`, `/login`, `/logout`, `/forgot-password`, `/reset-password` as a factory taking `deps`
    - Signup: transaction, map `ER_DUP_ENTRY` to 409 naming the field, set cookie, 201
    - Login: lockout check, always run `verifyPassword` (against `DUMMY_HASH` when the user is unknown), one generic 401, 429 with `Retry-After`, reset attempts on success, 400 records no attempt
    - Forgot-password: identical 200 body for known and unknown emails, log reset link to console
    - Reset-password: validate the password first, then conditional token consume, password update and revoke-all in one transaction
    - Logout: revoke the session if present, always clear the cookie
    - _Requirements: 2.1, 2.3, 2.4, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 11.2 Implement `Web/backend/lib/routes/account.js` including the avatar GET route
    - `GET /api/account`, `PATCH /profile`, `PUT /avatar` (`express.raw` with 2 MB limit, `checkAvatar`, single UPDATE setting avatar, mime, and `avatar_updated_at`), `DELETE /avatar`, `POST /password`, `POST /email`, `GET /email/confirm`, `PATCH /preferences`, `POST /sessions/revoke-all`, `DELETE /api/account`
    - `GET /api/account/avatar`: behind `requireSession`, one query by `req.userId` only, ignores `v` and any client id, 404 envelope when no avatar, otherwise 200 with raw bytes, stored mime as `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-cache`
    - Profile responses carry the Avatar_URL or `null`, never a `data:` URL
    - Delete-account runs in `withTransaction`, clears the cookie only after commit
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 11.3 Implement `Web/backend/lib/routes/sources.js`
    - `GET /api/sources`, `POST /api/sources` (generate `src_` id, encrypt key, store last four), `DELETE /:id`, `POST /:id/test`, `GET /:id/preview`
    - Reject malformed ids with 400 before any query; identical 404 for missing and foreign ids; test failures return 200 with status `failed`; preview failure returns 502
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11, 13.3, 13.6_

  - [x] 11.4 Implement `Web/backend/lib/routes/dashboards.js`
    - `GET /api/dashboards`, `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `GET /:id/data`
    - Validate with `validateDashboardDefinition`, check every `collectSourceIds` value is owned by the user (400 otherwise), generate `dash_` ids, identical 404 for missing and foreign ids; `/data` uses only owned sources
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 13.3, 13.6_

  - [ ]* 11.5 Write property test for single-use reset tokens
    - **Property 8: Reset tokens are single use**
    - **Validates: Requirements 5.2, 5.5, 5.7, 5.8**
    - Use fake repositories and bcrypt `cost: 4` or 10 injected through the route deps
    - File: `tests/auth-p8-reset-single-use.test.mjs`

  - [ ]* 11.6 Write property test for per-user isolation
    - **Property 11: Per-user isolation**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 14.11, 15.9**
    - File: `tests/auth-p11-isolation.test.mjs`

  - [ ]* 11.7 Write property test for the dashboard round trip
    - **Property 13: Dashboard round trip**
    - **Validates: Requirements 15.2, 15.3, 15.4, 15.10**
    - File: `tests/auth-p13-dashboard-roundtrip.test.mjs`

  - [ ]* 11.8 Write property test for the avatar round trip and headers
    - **Property 19: Avatar round trip and response headers**
    - **Validates: Requirements 8.1, 8.5, 8.9, 8.10, 8.11, 8.12, 8.16**
    - Generate buffers with a valid signature plus random bytes; a few runs near 2,097,152 bytes
    - File: `tests/auth-p19-avatar-roundtrip.test.mjs`

- [x] 12. Wire `server.js`
  - [x] 12.1 Rewrite `Web/backend/server.js` as the wiring file
    - Run the config check first; log the missing variable name and do not listen if any is missing
    - Create the pool, mount `staticAllowlist` at `/backend/` before the JSON parser and session middleware, then JSON and cookie parsing, auth routes, `requireSession` plus account, sources, and dashboards routes, and `errorMiddleware` last
    - Keep the existing frontend static serving; do not use `express.static` for `/backend/`
    - Keep the `npm run serve` entry working
    - _Requirements: 4.2, 13.1, 16.1, 16.6, 18.1, 18.3_

  - [ ]* 12.2 Write unit and integration tests for the server
    - Static route examples: `/backend/api.js` returns 200 with a JavaScript type and no cookie; `/backend/`, `/backend/lib/`, `/backend/server.js`, `/backend/.env`, `/backend/%2e%2e/server.js`, `/backend/lib%2fx.js`, `/backend/api.js%00` and `POST /backend/api.js` return the fixed 404
    - Startup with a missing environment variable logs its name and does not listen
    - Grep-style test asserting no template-literal or concatenated SQL in `Web/backend`
    - Route-level checks: 401 without a session on account, sources, dashboards, and avatar GET; 400 for a malformed `:id` runs no query; avatar PUT rejects empty, 2,097,153-byte, and non-image bodies and keeps the old avatar; avatar GET returns 404 envelope when none is set and ignores `v`; signup and login examples (cookie attributes, 409 duplicates, 429 on the sixth attempt, identical 401 bodies)
    - File: `tests/auth-server.test.mjs`
    - _Requirements: 3.2, 3.3, 3.5, 4.2, 8.2, 8.3, 8.4, 8.13, 8.14, 8.15, 13.5, 14.10, 16.6, 18.2, 18.4, 18.5, 18.6, 18.8_

- [x] 13. Fetch client in `api.js`
  - [x] 13.1 Implement `Web/backend/api.js`
    - `createApiClient({ fetchImpl, baseUrl })` with exactly one function per endpoint (27, including `getAvatar`), `ApiError`, and a default `api` instance
    - Shared `request` that sends `credentials: 'same-origin'`, JSON headers and body only when a body is given, parses envelopes, maps failures per criteria 17.5 to 17.8, handles `as: 'blob'` for `getAvatar`, and encodes ids and the confirm token with `encodeURIComponent`
    - `putAvatar` sends the Blob as is
    - End with the dual export guard (`module.exports` in Node, `globalThis.KiroApi` in the browser); no `require`, no secrets
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11_

  - [ ]* 13.2 Write property test for client request shape
    - **Property 16: Client request shape**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4**
    - File: `tests/auth-p16-client-request.test.mjs`

  - [ ]* 13.3 Write property test for client result mapping
    - **Property 17: Client result mapping**
    - **Validates: Requirements 17.5, 17.6, 17.7, 17.8, 17.10, 17.11**
    - File: `tests/auth-p17-client-result.test.mjs`

  - [ ]* 13.4 Write property test for client id encoding
    - **Property 18: Client id encoding**
    - **Validates: Requirements 17.9**
    - File: `tests/auth-p18-client-id-encoding.test.mjs`

  - [ ]* 13.5 Write a browser-load smoke test for `api.js`
    - Load the file in a `vm` context with no `module` and no `require`, and check that `KiroApi.createApiClient` exists
    - File: `tests/auth-api-browser.test.mjs`
    - _Requirements: 17.1, 18.2_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Property tests validate universal correctness properties; unit tests cover examples, timing, and database behavior.
- Run `npm test` for single-run tests. Do not start the server inside a task; run `npm run serve` manually.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "4.1", "5.1", "5.3", "6.1", "8.1", "10.1", "13.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3", "3.4", "4.2", "4.3", "4.4", "5.2", "5.4", "6.2", "6.3", "7.1", "8.2", "8.3", "10.2", "13.2", "13.3", "13.4", "13.5"] },
    { "id": 3, "tasks": ["7.2", "10.3", "10.4", "10.5"] },
    { "id": 4, "tasks": ["10.6", "11.1", "11.2", "11.3", "11.4"] },
    { "id": 5, "tasks": ["11.5", "11.6", "11.7", "11.8", "12.1"] },
    { "id": 6, "tasks": ["12.2"] }
  ]
}
```
