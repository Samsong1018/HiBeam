# Deploying to hibeam.somab.dev

The live site deploys itself from the **`prod`** branch. You don't need server access.

## Shipping a change

1. Get your change onto `main` as usual and make sure `npm test` passes.
2. Merge `main` into `prod` and push:
   ```
   git checkout prod && git pull
   git merge main
   git push origin prod
   git checkout main
   ```
   or open a PR from `main` into `prod`.
3. Within about 2 minutes the server picks it up. It installs dependencies, runs the full test suite,
   and switches over. The whole thing takes 1–2 minutes.

## What happens if something is wrong

- **Tests fail on the server:** nothing changes. The live site stays on the last good commit and
  Amos gets an alert. That commit won't be retried. Fix it and push a new commit to `prod`.
- **The app doesn't come up after the switch:** the server rolls back to the previous release on its
  own and Amos gets an alert.

## Things that are NOT automatic

- **Database changes.** New files in `Web/backend/db/migrations/` are not run on deploy. Tell Amos
  before you merge one into `prod`. If code that needs a new column goes out first, it breaks.
- **Environment variables.** The live `.env` lives on the server, outside the repo. If you add a
  required variable, tell Amos, or the server will refuse to start and get rolled back.
- **New dependencies** are fine. They're installed from `package-lock.json` on every deploy, so commit
  the lockfile.

## Notes

- Tests on the server run in a locked-down sandbox. If a test passes for you but fails there, it's
  usually something touching the OS (network interfaces, files outside the project, `/tmp`).
- Deploys build from `git archive`, so anything in `.gitignore` (like `.env`) is never shipped.

## Email

Password-reset and email-change mail, plus the security notices (password changed, and email
changed, sent to the old address), go out through Resend from `hibeam@somab.dev` (somab.dev is
already verified there). The server needs `RESEND_API_KEY` and `APP_BASE_URL=https://hibeam.somab.dev`
in its env. Without the key, the app still runs and writes the links to the server log instead.
Locally you can leave `RESEND_API_KEY` empty and copy the link from your terminal.

## One-click demo

The **Open the demo** button on the login page only appears when the server has
`DEMO_SEED_USER` set to an existing account's username. Each click copies that account's
**public** boards, and the sources they read, into a new throwaway account. To change what judges
see, change which boards on the showcase account are public. Demo accounts are deleted 24 hours
after they're made, by the same hourly prune that clears old sessions. No migration is needed.

Only use a showcase account whose data is fine for anyone to see: a demo visitor can preview the
full rows of every copied source, not just the columns a public board shows. Ours holds the APP1
agent in demo mode and the made-up APP2 workbook, so nothing real is exposed. The visitor never
sees source URLs or tokens.
