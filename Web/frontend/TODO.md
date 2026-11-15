# Frontend TODO

## Sign up / Login page (`login.html`)
- [x] Build sign-up form (username, email, display name, password + confirm)
- [x] Build login form (identifier + password)
- [x] Handle `?reset=<token>` query param to show reset-password form
- [x] Forgot-password flow (email input → POST `/api/auth/forgot-password`)
- [ ] Wire all forms to real API via `/backend/api.js` (`KiroApi.api.*`)
- [x] Show field-level validation errors from server responses
- [x] Redirect to `home.html` on successful login/signup

## Homepage (`home.html`)
- [ ] Load and display the user's dashboards (GET `/api/dashboards`)
- [ ] "New dashboard" button → POST `/api/dashboards` then redirect to `edit.html?id=<id>`
- [ ] Dashboard cards with name, last-updated time, and delete button
- [ ] Empty state when no dashboards exist
- [ ] Redirect unauthenticated users to `login.html`

## Account page (`account.html`) — UI is built, needs real API wiring
- [ ] On load: fetch GET `/api/account` and populate hero (display name, username, avatar, member since, source count)
- [ ] Load avatar image from `/api/account/avatar` and show it in both avatar slots
- [ ] Profile form: swap mock `api.request` for `KiroApi.api.updateProfile`
- [ ] Avatar upload: send raw `Blob` via `KiroApi.api.putAvatar` (not JSON)
- [ ] Avatar remove: wire to `KiroApi.api.deleteAvatar`
- [ ] Change password form: wire to `KiroApi.api.changePassword`
- [ ] Change email form: wire to `KiroApi.api.changeEmail`
- [ ] Sources section: load real sources on page load via `KiroApi.api.listSources`
- [ ] Add source dialog: fix source type options to match backend (`excel`, `scrape`, `logs`, `rest`, `sql`, `json`)
- [ ] Remove source: wire to `KiroApi.api.deleteSource`
- [ ] Preferences form: wire to `KiroApi.api.updatePreferences`; align chart/refresh options with backend schema (`line`, `bar`, `pie`, `kpi`, `table`)
- [ ] Sign out all devices: wire to `KiroApi.api.revokeAllSessions`
- [ ] Delete account: wire to `KiroApi.api.deleteAccount`
- [ ] Nav "Sign Out" button: wire to `KiroApi.api.logout` then redirect to `login.html`
- [ ] Redirect unauthenticated users (401 from API) to `login.html`

## View Dashboard (`view.html`) — page does not exist yet
- [ ] Create `view.html` and a companion script
- [ ] Read `?id=<id>` from query string; reject invalid ids before fetching
- [ ] Load dashboard definition (GET `/api/dashboards/:id`) and render widgets read-only
- [ ] Load live data (GET `/api/dashboards/:id/data`) and populate charts/stats
- [ ] Public / private toggle: UI control that updates a `public` flag on the dashboard (requires backend field + endpoint)
- [ ] Share button: copy a shareable link to clipboard (or display the URL)
- [ ] "Edit" button linking back to `edit.html?id=<id>` for the owner
- [ ] Handle 404 gracefully (dashboard deleted or not owned)

## Editor (`edit.html`)
- [ ] Flip `USE_MOCK` flag to `false` in `scripts/editor/api.js` once backend is live
- [ ] Add `getDashboardData` call for live widget data (GET `/api/dashboards/:id/data`)
- [ ] Wire "Sign Out" nav button (same as other pages)
- [ ] Wire Preview link to `view.html?id=<id>` (page now needs to be created — see above)

## Shared / cross-cutting
- [ ] Load `/backend/api.js` as a `<script>` tag on every page that needs auth (`KiroApi` global)
- [ ] Centralise auth redirect: a single helper that checks for 401 and sends to `login.html`
- [ ] Nav "Sign Out" button on all pages needs wiring (currently no `click` handler in `script.js`)
- [ ] `email/confirm` landing: handle `?token=` on `login.html` or a dedicated page by calling `KiroApi.api.confirmEmail(token)`
