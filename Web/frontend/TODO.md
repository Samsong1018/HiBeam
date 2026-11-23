# Frontend TODO

## Sign up / Login page (`login.html`)
- [x] Build sign-up form (username, email, display name, password + confirm)
- [x] Build login form (identifier + password)
- [x] Handle `?reset=<token>` query param to show reset-password form
- [x] Forgot-password flow (email input → POST `/api/auth/forgot-password`)
- [x] Wire all forms to the real API (uses `KiroApi` if loaded, else its own fetch helper)
- [x] Show field-level validation errors from server responses
- [x] Redirect to `home.html` on successful login/signup

## Homepage (`home.html`)
- [x] Load and display the user's dashboards (GET `/api/dashboards`)
- [x] "New dashboard" button → POST `/api/dashboards` then redirect to `edit.html?id=<id>`
- [x] Dashboard cards with name, last-updated time, and delete button
- [x] Empty state when no dashboards exist
- [x] Redirect unauthenticated users to `login.html`
- [ ] Cards only link to `edit.html`. Add an "Open" link to `view.html?id=<id>` alongside "Edit"

## Account page (`account.html`): wired to the real API
- [x] Load profile, avatar, preferences and sources on page load
- [x] Profile, avatar upload/remove, password, email, preferences forms
- [x] Add / remove source (the account form only takes REST and JSON URLs; other types are added from the editor)
- [x] Sign out all devices, delete account, nav Sign Out
- [x] Redirect to `login.html` on 401
- [x] "Member since", dashboard count and last login come from `GET /api/account` (`createdAt`, `dashboardCount`, `lastLoginAt`)

## View Dashboard (`view.html`)
- [x] Load dashboard by `?id=`, render widgets read-only, 404 handling
- [x] Edit button + Share dialog for the owner (`GET /api/dashboards/:id` returns `isOwner` + `public`)
- [x] Public / private toggle → `PATCH /api/dashboards/:id/visibility` (needs migration `001_dashboard_visibility.sql` on old DBs)
- [x] Public links work signed out: falls back to `GET /api/public/dashboards/:id` (+ `/data`) on 401/404
- [ ] Signed-out visitors on a public dashboard still see "Sign Out" in the header and footer nav. Show "Log in" instead when there's no session

## Editor (`edit.html`)
- [x] Real backend (`USE_MOCK = false`)
- [x] Add source sends `{ name, type, key }`; connection fields are packed into `key` as JSON (`packSourceKey`)
- [x] Spreadsheet sources upload the file with `PUT /api/sources/:id/file` after the source is created
- [x] Sign Out + Preview link
- [ ] Optional: switch widget data to `GET /api/dashboards/:id/data` (currently per-source `/preview`)

## Shared / cross-cutting
- [x] Nav Sign Out on every page (`script.js`)
- [x] 401 → `login.html` on every authenticated page
- [x] Email confirm: `login.html?token=` calls `confirmEmail`
- [x] All six source types fetch real data: `rest`, `json`, `sql` (MySQL/MariaDB), `scrape`, `logs` (log file URL), `excel` (.xlsx/.csv upload)

## Backend / ops
- [ ] Run `Web/backend/db/migrations/002_source_files.sql` on the shared DB (spreadsheet uploads fail without it)
- [ ] Per-IP rate limit on `/api/public/dashboards/*` before deploying publicly (there's a 15s data cache, but no request limit)
- [ ] Optional property/unit tests still unchecked in `.kiro/specs/auth-account-endpoints/tasks.md` (items marked `*`)

## Hackathon submission (Skeleton Crew)
- [ ] Build the two distinct apps on top of the foundation in `APP1/` and `APP2/` (both empty right now)
- [ ] Check the official Kiroween rules for anything else the submission needs
