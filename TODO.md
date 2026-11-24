# TODO — note to later Amos

Items 1–7 from the 2026-11-23 priority list are done (commit `73ca952`). This is what's left.

## Loose ends from 1–7
- [ ] Fill in the **TODO (team)** lines in `docs/KIRO.md`: IDE vs CLI, and what each hook actually caught
- [ ] Make both demo boards (Homelab Ops, Monthly Money Report) **public** when it's time to share with judges

## Next, if there's time
- [x] **8. "Gone quiet" ghost widgets** for stale sources. Counts for Design and Innovation and gives the video a Halloween beat. *(M)*
  - [ ] Push the updated `APP1/dashboard.template.json` to the live Homelab Ops board (`update_dashboard`), or the live board won't have the 5-minute check
- [ ] **9. Zero-setup demo:** make the APP1 board public and put the links at the top of the README. APP2 is already set up in the demo account. *(S–M)*
- [x] **10. Package the MCP server as a Kiro Power.** It's the only named criterion with no evidence yet. *(M)*
  - [ ] Still to do: install `power-hibeam/` from Kiro's Powers panel (about 1 credit) and fill in the TODO (team) lines under "Powers" in `docs/KIRO.md`
- [x] **11. Import a template from the UI, plus export the layout as JSON.** Makes the skeleton story work for judges who don't have Kiro. *(M)*
- [x] **12. Personas plus a "why not Grafana/Metabase" table** in the README. Cheap, and it helps the Impact score. *(S)*
- [x] **13. Error, empty and loading states.** *(S–M)*

## Stretch
- [ ] **14. Screenshot and critique MCP tools.** Needs a headless browser in the MCP server, which is a heavy dependency. Do 8–9 first.

## Video and posts (required)
- [ ] Cold open on the restic-backup outage ("It's 3am…"). It goes down for a few minutes every hour, so time the recording to that.
- [ ] Three-act script ending by 2:50, with the `git diff --stat Web/` proof
- [ ] Blog post and social posts, written yourselves

**Suggested order:** 8, then 10 alongside the video.
