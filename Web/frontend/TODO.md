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
- Dashboard cards should link to `view.html?id=<id>` (open) and `edit.html?id=<id>` (edit)
- [ ] Load and display the user's dashboards (GET `/api/dashboards`)
- [!] "New dashboard" button → POST `/api/dashboards` then redirect to `edit.html?id=<id>`
- [!] Dashboard cards with name, last-updated time, and delete button
- [!] Empty state when no dashboards exist
- [ ] Redirect unauthenticated users to `login.html`

## Account page (`account.html`) — wired to the real API
- [x] Load profile, avatar, preferences and sources on page load
- [x] Profile, avatar upload/remove, password, email, preferences forms
- [x] Add / remove source (source types match backend)
- [x] Sign out all devices, delete account, nav Sign Out
- [x] Redirect to `login.html` on 401
- [ ] "Member since" in the hero: backend `GET /api/account` doesn't return a created date yet

## View Dashboard (`view.html`)
- [x] Load dashboard by `?id=`, render widgets read-only, 404 handling
- [x] Edit button + Share dialog for the owner (`GET /api/dashboards/:id` returns `isOwner` + `public`)
- [x] Public / private toggle → `PATCH /api/dashboards/:id/visibility` (needs migration `001_dashboard_visibility.sql` on old DBs)
- [ ] Non-owners can't open a public dashboard yet: every dashboard route is login + owner-scoped. Needs an unauthenticated read route for `is_public` dashboards, plus serving widget data via `GET /api/dashboards/:id/data` instead of `/api/sources` (which a non-owner can't read)

## Editor (`edit.html`)
- [x] Real backend (`USE_MOCK = false`)
- [x] Add source sends `{ name, type, key }`; connection fields are packed into `key` as JSON (`packSourceKey`)
- [x] Sign Out + Preview link
- [ ] Optional: switch widget data to `GET /api/dashboards/:id/data` (currently per-source `/preview`)

## Shared / cross-cutting
- [x] Nav Sign Out on every page (`script.js`)
- [x] 401 → `login.html` on every authenticated page
- [x] Email confirm: `login.html?token=` calls `confirmEmail`
- [ ] Backend only fetches `rest` and `json` sources; `sql`, `excel`, `logs`, `scrape` save fine but preview returns "not supported yet"
