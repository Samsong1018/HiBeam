# Requirements Document

## Introduction

This feature implements the REST endpoints listed in the comment block of `Web/backend/server.js` (Auth, Account, Sources, Dashboards) on the Express server, backed by the self-hosted MySQL database. It also adds the matching fetch-based client calls in `Web/backend/api.js`, as requested.

Passwords are hashed and verified with bcrypt. Every Account, Sources, and Dashboards query is scoped to the authenticated user.

The Server also serves the fetch client `Web/backend/api.js` to browser pages through a restricted static route. The route exposes only `api.js` so that `server.js` and the `lib/` modules cannot be downloaded. The avatar is returned by `GET /api/account/avatar` as raw image bytes, which is the one successful response that is not a JSON Response_Envelope.

Current state:
- `server.js` has a MySQL connection, JSON parsing, static file serving, and a comment listing the endpoints. No endpoint is implemented.
- `api.js` is empty.
- `Web/frontend/scripts/accounts.js` uses a mock `api.request` and already defines the request bodies for the Account endpoints.
- `Web/frontend/scripts/editor/api.js` already expects `{ success, data, error }` response envelopes and 404 (not 403) for resources owned by another user.
- `bcrypt` is not yet in `package.json`.

## Glossary

- **Server**: The Express application in `Web/backend/server.js`.
- **Api_Client**: The fetch-based client module in `Web/backend/api.js` that wraps calls to the Server endpoints.
- **Database**: The self-hosted MySQL database the Server connects to.
- **User**: A registered account record in the Database.
- **Authenticated_User**: The User identified by a valid, unexpired, unrevoked Session attached to the current request.
- **Session**: A server-recognized login state tied to one User and one device, identified by a token sent in an HttpOnly cookie.
- **Password_Hasher**: The component that hashes and verifies passwords using bcrypt.
- **Password_Hash**: The bcrypt output stored in the Database in place of a plaintext password.
- **Response_Envelope**: The JSON body `{ "success": boolean, "data": any, "error": string }` returned by every endpoint.
- **Owned_Resource**: A Source or Dashboard row whose owner is a specific User.
- **Reset_Token**: A single-use, time-limited random value that authorizes a password reset.
- **Email_Confirmation_Token**: A single-use, time-limited random value that authorizes an email address change.
- **Auth_Endpoints**: `POST /api/auth/signup`, `/login`, `/logout`, `/forgot-password`, `/reset-password`.
- **Account_Endpoints**: All `/api/account` routes listed in `server.js`, including `GET /api/account/avatar`.
- **Avatar_URL**: The string `/api/account/avatar?v=<updatedAt epoch>`, where `<updatedAt epoch>` is the avatar's last-update time as an integer count of seconds since 1970-01-01T00:00:00Z. The query value changes whenever the avatar changes, so browsers do not reuse a stale image.
- **Static_Backend_Route**: The Server route mounted at `/backend/` that serves files from the `Web/backend` directory.
- **Static_Allowlist**: The set of file names the Static_Backend_Route may serve. The set contains only `api.js`.
- **Source_Endpoints**: All `/api/sources` routes listed in `server.js`.
- **Dashboard_Endpoints**: All `/api/dashboards` routes listed in `server.js`.

## Requirements

### Requirement 1: Password hashing with bcrypt

**User Story:** As a user, I want my password stored as a bcrypt hash, so that a database leak does not reveal my password.

#### Acceptance Criteria

1. WHEN a password of 1 to 72 bytes is stored, THE Password_Hasher SHALL store a bcrypt Password_Hash with a cost factor of at least 10 and SHALL NOT store the plaintext password in any database column.
2. WHEN a password is checked, THE Password_Hasher SHALL compare the submitted password with the stored Password_Hash using bcrypt and SHALL return true if they match and false if they do not.
3. FOR ALL passwords of 10 to 72 bytes, hashing then verifying the same password SHALL return true (round-trip property).
4. FOR ALL pairs of different passwords of 10 to 72 bytes, verifying one against the Password_Hash of the other SHALL return false.
5. IF a submitted password is longer than 72 bytes, THEN THE Server SHALL reject the request with HTTP 400, state the maximum length of 72 bytes, and leave stored account data unchanged.
6. IF a submitted password is empty, THEN THE Server SHALL reject the request with HTTP 400 stating a password is required, and leave stored data unchanged.
7. IF the stored Password_Hash is missing or not a valid bcrypt hash when a password is checked, THEN THE Password_Hasher SHALL return false and THE Server SHALL reject the request as an authentication failure without revealing the cause.
8. THE Server SHALL exclude the Password_Hash and the plaintext password from every response body and every log entry.

### Requirement 2: Sign up

**User Story:** As a new user, I want to create an account, so that I can build and save dashboards.

#### Acceptance Criteria

1. WHEN `POST /api/auth/signup` receives a username, email, display name, and password that pass the rules in criterion 2 and match no existing User under criterion 4, THE Server SHALL create a User with a Password_Hash, start a Session, and return HTTP 201 with the new User's public profile in the Response_Envelope, excluding the password and the Password_Hash.
2. THE Server SHALL validate signup input as follows: username, after trimming and lowercasing, matches `^[a-z0-9_]{3,24}$`; email, after trimming, is at most 254 characters, has the form local-part@domain with a non-empty local part, a domain containing at least one dot, and no whitespace; display name is 1 to 60 characters after trimming; password is 10 to 72 bytes and is not trimmed or altered.
3. IF any signup field is missing, not a string, or fails criterion 2, THEN THE Server SHALL return HTTP 400 with an error naming each invalid field, and SHALL NOT create a User or start a Session.
4. IF the submitted username or email, compared case-insensitively, already belongs to a User, THEN THE Server SHALL return HTTP 409 naming the conflicting field, and SHALL NOT create a User or start a Session.
5. THE Server SHALL store email addresses and usernames in lowercase and treat uniqueness case-insensitively.
6. IF two signup requests with the same username or email are processed concurrently, THEN THE Server SHALL create at most one User and return HTTP 409 for each request that does not create a User.
7. IF a database or internal error occurs during signup, THEN THE Server SHALL return HTTP 500 with a generic error message and SHALL leave no partially created User.

### Requirement 3: Log in

**User Story:** As a registered user, I want to log in with my credentials, so that I can access my dashboards.

#### Acceptance Criteria

1. WHEN `POST /api/auth/login` receives an identifier (username or email, 1 to 254 characters) and a password (1 to 72 bytes) that matches the stored Password_Hash, THE Server SHALL start a Session and return HTTP 200 with the User's public profile.
2. WHEN a Session is started, THE Server SHALL send the Session token in a cookie with HttpOnly and SameSite=Lax and a Max-Age of 604800 seconds.
3. IF the identifier does not match a User or the password does not match, THEN THE Server SHALL return HTTP 401 with the same generic error message in both cases, and SHALL NOT start a Session or set a Session cookie.
4. WHEN the identifier does not match any User, THE Password_Hasher SHALL still perform a bcrypt comparison against a dummy hash, so that the response time difference between unknown-identifier and wrong-password failures is under 100 ms on average over 20 requests.
5. IF 5 consecutive failed logins occur for one identifier within 15 minutes, THEN THE Server SHALL return HTTP 429 with a Retry-After header giving the remaining lockout seconds, for all further attempts on that identifier (including with the correct password) until 15 minutes have elapsed since the 5th failure.
6. IF the identifier or password is omitted, empty, not a string, or exceeds the limits in criterion 1, THEN THE Server SHALL return HTTP 400 naming the invalid field, without a password comparison and without counting a failed login.
7. WHEN a login succeeds, THE Server SHALL reset the consecutive failed-login count for that identifier to 0.

### Requirement 4: Log out and session validity

**User Story:** As a user, I want to end my session, so that nobody else can use my browser to reach my account.

#### Acceptance Criteria

1. WHEN `POST /api/auth/logout` is received with a valid Session, THE Server SHALL revoke that Session, clear the Session cookie, and return HTTP 200.
2. IF a request to an Account_Endpoint (including `GET /api/account/avatar`), Source_Endpoint, or Dashboard_Endpoint has no valid Session, THEN THE Server SHALL return HTTP 401, SHALL NOT run any query for that request, and SHALL NOT modify stored data.
3. IF a Session has passed its expiry time or has been revoked, THEN THE Server SHALL treat the request as having no valid Session.
4. WHEN `POST /api/auth/logout` is received without a valid Session, THE Server SHALL return HTTP 200 and clear the Session cookie.
5. WHEN a Session is revoked by logout, THE Server SHALL return HTTP 401 for every later request presenting that Session's cookie to an Account_Endpoint, Source_Endpoint, or Dashboard_Endpoint.
6. IF the Server fails to revoke the Session during logout because of a database error, THEN THE Server SHALL return HTTP 500, still clear the Session cookie, and leave the Session unrevoked in storage.

### Requirement 5: Forgot and reset password

**User Story:** As a user who forgot my password, I want to reset it, so that I can regain access.

#### Acceptance Criteria

1. WHEN `POST /api/auth/forgot-password` receives a well-formed email of at most 254 characters, THE Server SHALL return HTTP 200 with an identical response body and status whether or not a User has that email.
2. WHEN `POST /api/auth/forgot-password` receives an email that belongs to a User, THE Server SHALL create a Reset_Token that expires 30 minutes after creation, store only a hash of it in the Database, and invalidate every earlier unused Reset_Token for that User.
3. IF the email is missing, empty, malformed, or longer than 254 characters, THEN THE Server SHALL return HTTP 400 and create no Reset_Token.
4. WHERE no email delivery service is configured, THE Server SHALL write the reset link to the server console instead of sending an email.
5. WHEN `POST /api/auth/reset-password` receives a valid, unexpired, unused Reset_Token and a new password of 10 to 72 bytes, THE Server SHALL replace the Password_Hash, mark the Reset_Token used, and revoke all of that User's Sessions in a single atomic operation, then return HTTP 200.
6. IF the new password is shorter than 10 characters or longer than 72 bytes, THEN THE Server SHALL return HTTP 400, leave the Password_Hash unchanged, and leave the Reset_Token unused.
7. IF the Reset_Token is missing, unknown, expired, or already used, THEN THE Server SHALL return HTTP 400 and leave the Password_Hash unchanged.
8. FOR ALL Reset_Tokens, applying the same Reset_Token a second time SHALL fail with HTTP 400 and leave the Password_Hash set by the first reset unchanged (idempotence of single-use tokens).

### Requirement 6: Read account

**User Story:** As a user, I want to load my account details, so that the account page shows my current data.

#### Acceptance Criteria

1. WHEN `GET /api/account` is received with a valid Session, THE Server SHALL return, within 2 seconds, the Authenticated_User's display name, username, email, avatar URL, preferences, and Source count, where Source count is the integer number (0 or more) of Sources currently owned by the user.
2. THE Server SHALL select the User row using the Session's user id and SHALL NOT use any user id supplied in the path, query string, or body.
3. THE Server SHALL exclude the password, Password_Hash, and Session token from every `GET /api/account` response.
4. IF the Session is missing, malformed, expired, or revoked, THEN THE Server SHALL return HTTP 401, no account data, and leave stored data unchanged.
5. IF no User row exists for the Session's user id, THEN THE Server SHALL return HTTP 404, no account data, and leave stored data unchanged.
6. IF the database is unavailable or the query fails, THEN THE Server SHALL return HTTP 500, no partial account data, and leave stored data unchanged.
7. WHEN the Authenticated_User has an avatar, THE Server SHALL set the avatar URL in the `GET /api/account` response to the Avatar_URL.
8. WHEN the Authenticated_User has no avatar, THE Server SHALL set the avatar URL in the `GET /api/account` response to null.
9. THE Server SHALL return the avatar URL as either the Avatar_URL or null, and SHALL NOT return a `data:` URL.

### Requirement 7: Update profile

**User Story:** As a user, I want to change my display name and username, so that my profile is accurate.

#### Acceptance Criteria

1. WHEN `PATCH /api/account/profile` receives from an Authenticated_User a `displayName` of 1 to 60 characters after trimming and a `username` matching `^[a-z0-9_]{3,24}$`, THE Server SHALL update only that user's row with the trimmed displayName and the username, and return the updated profile.
2. IF `username` fails the rule, is missing, or is not a string, THEN THE Server SHALL return HTTP 400 indicating the username is invalid and leave the profile unchanged.
3. IF `displayName` is missing, not a string, empty after trimming, or exceeds 60 characters after trimming, THEN THE Server SHALL return HTTP 400 indicating the display name is invalid and leave the profile unchanged.
4. IF `username` already belongs to a different User, THEN THE Server SHALL return HTTP 409 indicating the username is taken and leave the profile unchanged.
5. IF the request has no valid Session, THEN THE Server SHALL return HTTP 401 and leave all profiles unchanged.

### Requirement 8: Avatar

**User Story:** As a user, I want to set or remove a profile photo, so that my account is recognizable.

#### Acceptance Criteria

1. WHEN `PUT /api/account/avatar` receives from an Authenticated_User a PNG, JPEG, or WebP image of 1 byte to 2 MB (2,097,152 bytes) inclusive, THE Server SHALL store it, replace any earlier avatar, and return HTTP 200.
2. IF the image type is not PNG, JPEG, or WebP, THEN THE Server SHALL return HTTP 400 (unsupported type) and keep the existing avatar.
3. IF the image exceeds 2,097,152 bytes, THEN THE Server SHALL return HTTP 400 (too large) and keep the existing avatar.
4. IF the request contains no image or a 0-byte image, THEN THE Server SHALL return HTTP 400 (image missing) and keep the existing avatar.
5. THE Server SHALL determine image type from the file content and not from the client-supplied file name or content type.
6. IF a PUT or DELETE avatar request has no valid Session, THEN THE Server SHALL return HTTP 401 and leave all avatars unchanged.
7. WHEN `DELETE /api/account/avatar` is received from an Authenticated_User, THE Server SHALL remove the avatar and return HTTP 200, including when no avatar was set.
8. WHEN an avatar is stored by `PUT /api/account/avatar`, THE Server SHALL record the content-sniffed image type and the update time with the avatar, and SHALL expose the avatar in account profiles only as the Avatar_URL.
9. WHEN `GET /api/account/avatar` is received from an Authenticated_User who has an avatar, THE Server SHALL return HTTP 200 with the raw stored image bytes as the response body.
10. WHEN `GET /api/account/avatar` returns an avatar, THE Server SHALL set Content-Type to the stored content-sniffed type, which is one of `image/png`, `image/jpeg`, or `image/webp`.
11. WHEN `GET /api/account/avatar` returns an avatar, THE Server SHALL set the response header `X-Content-Type-Options: nosniff`.
12. WHEN `GET /api/account/avatar` returns an avatar, THE Server SHALL set the response header `Cache-Control: private, no-cache`.
13. THE Server SHALL select the avatar for `GET /api/account/avatar` using only the Session's user id, and SHALL ignore any user id supplied in the path, query string (including the `v` version parameter), body, or headers.
14. IF `GET /api/account/avatar` is received from an Authenticated_User who has no avatar, THEN THE Server SHALL return HTTP 404 with a Response_Envelope whose `success` is false.
15. IF `GET /api/account/avatar` has no valid Session, THEN THE Server SHALL return HTTP 401 with a Response_Envelope, return no image bytes, and leave all avatars unchanged.
16. FOR ALL valid PNG, JPEG, or WebP images of 1 byte to 2,097,152 bytes, storing the image with `PUT /api/account/avatar` and then reading it with `GET /api/account/avatar` SHALL return bytes identical to the stored image (round-trip property).

### Requirement 9: Change password

**User Story:** As a user, I want to change my password while logged in, so that I can keep my account secure.

#### Acceptance Criteria

1. WHEN `POST /api/account/password` receives a `currentPassword` matching the stored Password_Hash and a `newPassword` of 10 to 72 bytes that differs from currentPassword, THE Server SHALL store a new Password_Hash and return HTTP 200.
2. IF currentPassword does not match, THEN THE Server SHALL return HTTP 403 (current password incorrect) and leave the Password_Hash unchanged.
3. IF newPassword is shorter than 10 characters, longer than 72 bytes, or equals currentPassword, THEN THE Server SHALL return HTTP 400 indicating which rule failed and leave the Password_Hash unchanged.
4. WHEN the Password_Hash is changed, THE Server SHALL revoke all of the user's Sessions other than the requesting Session, and keep that Session valid.
5. IF currentPassword or newPassword is missing or not a string, THEN THE Server SHALL return HTTP 400 and leave the Password_Hash and Sessions unchanged.
6. IF there is no valid Session, THEN THE Server SHALL return HTTP 401 and leave the Password_Hash and Sessions unchanged.

### Requirement 10: Change email

**User Story:** As a user, I want to change my email address after confirming it, so that I only receive mail at an address I control.

#### Acceptance Criteria

1. WHEN `POST /api/account/email` receives from an Authenticated_User a `newEmail` that is valid and not in use by another User, and a `password` matching the stored Password_Hash, THE Server SHALL create an Email_Confirmation_Token that expires 24 hours after creation and is bound to the user and newEmail, return HTTP 200, and leave the current email unchanged.
2. IF password does not match, THEN THE Server SHALL return HTTP 403, create no token, and leave the email unchanged.
3. IF newEmail is not valid (missing, empty, longer than 254 characters, or not local-part@domain), THEN THE Server SHALL return HTTP 400, create no token, and leave the email unchanged.
4. IF newEmail already belongs to a User (case-insensitive, including the user's own current email), THEN THE Server SHALL return HTTP 409, create no token, and leave the email unchanged.
5. WHEN `GET /api/account/email/confirm` receives an Email_Confirmation_Token that exists, is under 24 hours old, and is unused, and the bound newEmail belongs to no User, THE Server SHALL set the bound User's email to newEmail, mark the token used, and return HTTP 200.
6. IF the token is missing, unknown, expired, or used, THEN THE Server SHALL return HTTP 400 and leave the email unchanged.
7. IF the bound newEmail has become another User's email before confirmation, THEN THE Server SHALL return HTTP 409, leave the email unchanged, and mark the token used.
8. WHERE no email delivery service is configured, THE Server SHALL write the confirmation link containing the token to the server console when the token is created.

### Requirement 11: Preferences

**User Story:** As a user, I want to save my default chart and refresh rate, so that new dashboards start with my choices.

#### Acceptance Criteria

1. WHEN an Authenticated_User sends `PATCH /api/account/preferences` with valid `defaultChart` and `refreshRate`, THE Server SHALL save them and return HTTP 200 with the saved values.
2. IF defaultChart is missing, not a string, or not a chart type known to the editor, or refreshRate is missing or not an integer from 0 to 86400 inclusive (seconds), THEN THE Server SHALL return HTTP 400 indicating which field is invalid and leave preferences unchanged.
3. IF there is no valid Session, THEN THE Server SHALL return HTTP 401 and leave preferences unchanged.
4. IF saving fails in the database, THEN THE Server SHALL return HTTP 500 and leave preferences unchanged.

### Requirement 12: Revoke all sessions and delete account

**User Story:** As a user, I want to sign out everywhere and delete my account, so that I control my data and access.

#### Acceptance Criteria

1. WHEN `POST /api/account/sessions/revoke-all` is received from an Authenticated_User, THE Server SHALL revoke every Session of that User including the current one, clear the Session cookie, and return HTTP 200.
2. IF revoke-all is received without a valid Session, THEN THE Server SHALL return HTTP 401 and revoke no Sessions.
3. WHEN `DELETE /api/account` is received from an Authenticated_User, THE Server SHALL delete the User's row and every Owned_Resource, Session, Reset_Token, and Email_Confirmation_Token belonging to that User in one transaction, and return HTTP 200 after commit.
4. IF `DELETE /api/account` is received without a valid Session, THEN THE Server SHALL return HTTP 401 and delete no data.
5. IF any deletion fails, THEN THE Server SHALL roll back the transaction, return HTTP 500, leave all of the user's data unchanged, and leave the Session cookie unchanged.
6. WHEN the transaction commits, THE Server SHALL clear the Session cookie in the same response.
7. WHEN `DELETE /api/account` has returned HTTP 200, THE Server SHALL reject any later request presenting a Session of the deleted User with HTTP 401.

### Requirement 13: Per-user query scoping

**User Story:** As a user, I want my data to be invisible to other users, so that my sources and dashboards stay private.

#### Acceptance Criteria

1. WHEN the Server handles an authenticated request, including `GET /api/account/avatar`, THE Server SHALL derive the acting user id from the Session only and ignore any owner or user id supplied by the client in the body, query string, path, or headers.
2. THE Server SHALL include the Authenticated_User's id as a condition in every SELECT, UPDATE, and DELETE query against Users, Sources, Dashboards, Sessions, and token tables, so each query can match only rows owned by that user.
3. IF a request names an Owned_Resource id that belongs to a different User or does not exist, THEN THE Server SHALL return HTTP 404 with a byte-identical response body in both cases and leave stored data unchanged.
4. FOR ALL pairs of distinct Users A and B, any Source or Dashboard read, update, or delete by A SHALL return zero rows owned by B and modify zero rows owned by B (isolation property).
5. THE Server SHALL execute every query with parameterized placeholders and SHALL NOT concatenate request values into SQL text.
6. IF a Source or Dashboard request has no valid Session, THEN THE Server SHALL return HTTP 401, execute no query against Sources or Dashboards, and leave stored data unchanged.

### Requirement 14: Sources endpoints

**User Story:** As a user, I want to manage my data sources, so that dashboards can draw on them.

#### Acceptance Criteria

1. WHEN `GET /api/sources` is received from an Authenticated_User, THE Server SHALL return HTTP 200 with only that user's Sources, each with id, name, type, status, last four characters of the key, and last-sync time (null if never synced).
2. WHEN `POST /api/sources` receives a `name` of 1 to 100 characters, a `type` that is a supported Source type, and a non-empty `key` of at most 512 characters, THE Server SHALL create a Source owned by the user with initial status "untested" and return HTTP 201 with its id.
3. IF name or key is missing, empty, or over-length, or type is unsupported, THEN THE Server SHALL return HTTP 400 identifying the invalid field and create no Source.
4. THE Server SHALL omit the full source key and any other secret from every response after creation, exposing only the last four characters.
5. WHEN `DELETE /api/sources/:id` is received for an Owned_Resource, THE Server SHALL permanently delete that Source and return HTTP 200 with the Response_Envelope and `data` null.
6. WHEN `POST /api/sources/:id/test` is received for an Owned_Resource, THE Server SHALL attempt a connection within 10 seconds, store the resulting status and last-sync time, and return HTTP 200 with the status.
7. IF the connection attempt fails or exceeds 10 seconds, THEN THE Server SHALL set the status to "failed", leave the stored key unchanged, and return HTTP 200 with the failed status and the failure reason.
8. WHEN `GET /api/sources/:id/preview` is received for an Owned_Resource, THE Server SHALL return HTTP 200 with 0 to 100 sample rows.
9. IF preview cannot retrieve rows within 10 seconds or the Source returns an error, THEN THE Server SHALL return HTTP 502 indicating the Source is unreachable, with no rows.
10. IF `:id` does not match `^[A-Za-z0-9_-]{1,64}$`, THEN THE Server SHALL return HTTP 400 before accessing any Source.
11. IF `:id` is valid but not an Owned_Resource, THEN THE Server SHALL return HTTP 404 without revealing whether the Source exists.

### Requirement 15: Dashboards endpoints

**User Story:** As a user, I want to create, edit, and delete my dashboards, so that my work is saved and private.

#### Acceptance Criteria

1. WHEN `GET /api/dashboards` is received from an Authenticated_User, THE Server SHALL return HTTP 200 with only that user's dashboards, each with id, name, and updated time, and an empty list if none.
2. WHEN `POST /api/dashboards` receives a valid dashboard definition, THE Server SHALL create a dashboard owned by the user and return HTTP 201 with id, definition, and updated time.
3. WHEN `GET /api/dashboards/:id` is received for an Owned_Resource, THE Server SHALL return HTTP 200 with id, definition, and updated time.
4. WHEN `PATCH /api/dashboards/:id` receives a valid definition for an Owned_Resource, THE Server SHALL replace the stored definition, set updated time to the time of change, and return HTTP 200 with the updated dashboard.
5. WHEN `DELETE /api/dashboards/:id` is received for an Owned_Resource, THE Server SHALL permanently delete it and return HTTP 200 with the Response_Envelope and `data` null, and a later GET for that id SHALL return HTTP 404.
6. WHEN `GET /api/dashboards/:id/data` is received for an Owned_Resource, THE Server SHALL return HTTP 200 with data for each widget, using only Sources owned by the user.
7. IF a definition submitted to POST or PATCH references a Source id not owned by the user, THEN THE Server SHALL return HTTP 400 indicating the invalid Source reference and create or modify no dashboard.
8. IF a definition submitted to POST or PATCH is not valid JSON or does not match the editor schema, THEN THE Server SHALL return HTTP 400 indicating the validation failure and create or modify no dashboard.
9. IF GET, PATCH, DELETE, or `/data` is received for an id that does not exist or is not owned by the user, THEN THE Server SHALL return HTTP 404 with the same body in both cases and change no data.
10. FOR ALL valid dashboard definitions, creating then reading a dashboard SHALL return a definition equivalent to the one submitted (round-trip property).

### Requirement 16: Response format and error handling

**User Story:** As a frontend developer, I want consistent responses, so that the existing client code works without per-endpoint handling.

#### Acceptance Criteria

1. WHEN the Server handles a request successfully, THE Server SHALL return a Response_Envelope with `success` true and `data` set to the endpoint result, except for a successful `GET /api/account/avatar` and a successful Static_Backend_Route response, which return raw bytes as specified in Requirement 8 and Requirement 18.
2. IF a request fails, THEN THE Server SHALL return a Response_Envelope with `success` false and `error` set to a non-empty string, and SHALL NOT include `data`.
3. IF an unexpected error occurs, THEN THE Server SHALL return HTTP 500 with a generic `error` containing no stack traces, SQL text, file paths, or credentials, and SHALL write details to the server log only.
4. THE Server SHALL read database credentials from environment variables and SHALL NOT include the database host, user, password, or database name in any response body.
5. IF a request body fails schema validation, THEN THE Server SHALL return HTTP 400 with an `error` naming each invalid field, and SHALL NOT change stored data.
6. IF a required database credential environment variable is missing at startup, THEN THE Server SHALL log an error naming the missing variable (not its value) and SHALL NOT begin accepting requests.

### Requirement 17: Fetch client in api.js

**User Story:** As a developer, I want one fetch-based client for every endpoint, so that pages call the backend consistently.

#### Acceptance Criteria

1. THE Api_Client SHALL expose exactly one function for each endpoint listed in `server.js`, including `GET /api/account/avatar`, each accepting the path ids and request body its endpoint requires.
2. WHEN an Api_Client function is called, THE Api_Client SHALL send a fetch request with `credentials: 'same-origin'` using the HTTP method of the matching endpoint.
3. WHEN an Api_Client function is called with a body, THE Api_Client SHALL send the body as JSON with the `Content-Type: application/json` header.
4. WHEN an Api_Client function is called without a body, THE Api_Client SHALL send the request with no body.
5. WHEN the Server returns a 2xx status and an envelope with `success` true to any Api_Client function other than the avatar GET function, THE Api_Client SHALL resolve with the envelope's `data`.
6. IF the Server returns `success` false or a non-2xx status, THEN THE Api_Client SHALL reject with an error carrying the HTTP status and the envelope's `error` message.
7. IF the response body of any Api_Client function other than the avatar GET function cannot be parsed as a Response_Envelope, THEN THE Api_Client SHALL reject with an error carrying the HTTP status and a message that the response was invalid.
8. IF the network request fails, THEN THE Api_Client SHALL reject with an error stating that the server cannot be reached, carrying no HTTP status.
9. WHEN an id is placed in a request path, THE Api_Client SHALL URL-encode the id so that ids containing `/`, `?`, `#`, or `%` are sent as a single path segment.
10. WHEN the avatar GET function is called and the Server returns a 2xx status, THE Api_Client SHALL resolve with the response body as a Blob.
11. IF the Server returns a non-2xx status to the avatar GET function, THEN THE Api_Client SHALL reject with an error carrying the HTTP status and the envelope's `error` message, or a message that the response was invalid when the body is not a Response_Envelope.

### Requirement 18: Serve the fetch client to browsers

**User Story:** As a frontend developer, I want browser pages to load `api.js` from the Server, so that pages can call the backend, while the server code stays private.

#### Acceptance Criteria

1. THE Server SHALL mount the Static_Backend_Route at `/backend/` serving files from the `Web/backend` directory, restricted to the Static_Allowlist.
2. WHEN `GET /backend/api.js` is received, THE Server SHALL return HTTP 200 with the contents of `Web/backend/api.js` and a JavaScript Content-Type.
3. WHEN `GET /backend/api.js` is received, THE Server SHALL serve the file without requiring a Session.
4. IF a request to the Static_Backend_Route names a file that is not in the Static_Allowlist (including `server.js`, any path under `lib/`, and any file whose name begins with `.`), THEN THE Server SHALL return HTTP 404.
5. IF a request to the Static_Backend_Route names a directory (including `/backend/` and `/backend/lib/`), THEN THE Server SHALL return HTTP 404 and SHALL NOT return a directory listing or an index file.
6. IF the path of a request to the Static_Backend_Route contains `..`, a percent-encoded `..` (such as `%2e%2e`), a percent-encoded `/` or `\` (such as `%2f` or `%5c`), a null byte (`%00`), or a backslash, THEN THE Server SHALL return HTTP 404.
7. THE Server SHALL compare the requested file name with the Static_Allowlist after decoding the path once and SHALL serve a file only on an exact, case-sensitive match.
8. IF a request to the Static_Backend_Route uses a method other than GET or HEAD, THEN THE Server SHALL return HTTP 404.
9. THE Server SHALL return the same HTTP 404 response body for every rejected Static_Backend_Route request, whether or not the named file exists.
10. FOR ALL request paths under `/backend/` other than `/backend/api.js`, THE Server SHALL return a response body that contains no byte of `server.js` or any file under `lib/` (no-disclosure property).
