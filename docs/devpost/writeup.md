## Inspiration
The age old IT problem. HR asks for a dashboard pulling from 30 different sources, none of which are remotely in the same place. Or it's your own finances and you wish your Excel sheet could just update itself. Whatever it is, everyone's thought "I wish I could have a dashboard for this right now," and that's the problem HiBeam looks to solve.

## What it does
HiBeam lets you build a dashboard by dragging widgets onto a grid and hooking them up to your data. It can read from REST APIs, JSON, MySQL, Prometheus, scraped web pages, server logs, Google Sheets CSV links, and Excel or CSV uploads. Everything gets fetched server-side, so your credentials never reach the browser. Besides the usual line, bar and pie charts there's gauges, sparklines on KPIs, and an uptime strip for status pages.

You don't have to build it yourself either. Generate reads your data and lays out a first draft for you, and the built in MCP server lets you make a whole dashboard from a single prompt to Kiro or other models. The agent connects the sources and builds the board, then it screenshots the result and fixes whatever reads badly.

You can share boards with a public link or export them as a PNG, PDF, or a JSON layout someone else can import. If a source stops reporting the widget fades out into a little ghost, so a dead server actually looks dead.

We built two apps on top of it without changing the core code, a live homelab status page and a monthly budget report from one spreadsheet. Kiro built both boards, one prompt each.

## How we built it
Express backend with MySQL and a plain html/css/js frontend, no build step. `Web/` is the skeleton and the two apps live in `APP1/` and `APP2/`. Nothing in `Web/` knows the apps exist, if an app needed something new it went into the skeleton as a general option and the app turned it on from its template.

## How we used Kiro
The full version with commit hashes is in `docs/KIRO.md`. Short version:

**IDE and CLI.** We started in Kiro CLI, the first thing we committed for Kiro was steering "for kiro-cli" before there was any backend code (Nov 13). After that most of the work moved to the IDE, mostly for specs and hooks. [TODO: one or two sentences on how the CLI and IDE actually felt different to use]

**Specs.** Three of them: auth (18 requirements, 22 correctness properties), the dashboard generator (11 properties), and APP2's monthly import (5 properties). Kiro built the auth backend task by task from its spec and ran each property test as part of the task, the results are saved in `tasks.meta.json`. [TODO: how this compared to vibe coding for you, e.g. what went wrong before specs]

**Property-based testing.** None of us had done it before. Every property in a spec's `design.md` maps to one `fast-check` test file. One of them found an input that crashed our error handler instead of returning a 500, which the normal unit tests missed. We also made a `pbt-writer` agent so new property tests come out in the same style.

**Hooks.** Almost every hook exists because something broke first:
- A stray quote took down the whole home page and no test loaded that file, so now `syntax-check-on-save` runs `node --check` on every script when a `.js` file is saved.
- The editor read a dashboard without unwrapping `definition`, every saved board opened empty, and autosave overwrote the real one. Now `api-contract-sync` runs an agent whenever a route file is saved and checks every frontend caller still matches.
- `guard-tool-use` blocks force-pushes to main, broad `rm -rf`, destructive SQL and reading `.env`, since we had agents working against one shared database.
- `spec-consistency` checks design and tasks still cover the requirements when requirements change, `verify-after-task` runs the full suite after each spec task, and `session-context` gives every session the branch and recent commits.

**Steering.** Our first steering was 4 short docs that all loaded every time, and one pointed at paths that didn't exist. We rebuilt it with inclusion modes. Product, tech and structure are always on. Backend, frontend and testing only load when you're in those files (`fileMatch`). Security and MCP are manual (`#security`, `#mcp`). The backend doc pulls in `schema.sql` with `#[[file:]]` so Kiro always has the real tables. Biggest difference was tech.md, Kiro stopped reaching for frameworks we weren't using.

**Custom agents.** `security-reviewer` (owner scoping, SSRF, read-only SQL), `frontend-reviewer` (the bugs that actually hit us, plus accessibility), `pbt-writer`, and `submission-checker`, which audits the repo against these rules.

**MCP.** This is the part we're happiest with. We wrote an MCP server for HiBeam itself with 18 tools, so Kiro can connect sources, preview the real rows, generate a draft, build or edit boards on a real account, and screenshot them. Both app boards were built that way, one prompt each. When we built them Kiro couldn't see the rendered board, so the last step was us giving it a screenshot and it fixed what read badly with `update_dashboard`. Now `screenshot_dashboard` opens the board in headless Chromium, lets our normal client code draw it, and hands Kiro the image, so it checks its own work. Without MCP Kiro would be guessing at field names, with it it reads the actual data.

**Powers.** We packaged that MCP server as a Kiro power (`power-hibeam/`) with activation keywords and a skill holding the build, look, fix loop. Inside our repo `.kiro/settings/mcp.json` already does this, the power is how it gets into any other workspace.

**Other tools.** Near the end our Kiro credits ran low, so we finished the last features with Claude Code running inside the Kiro IDE. Kiro built the core (the auth backend, the generator, and both app boards through MCP), and `docs/KIRO.md` lists exactly what came from where. Because Claude was editing inside the Kiro IDE our hooks kept firing on everything it saved, so the guardrails we built for Kiro ended up checking a second agent too.

## Challenges we ran into
The worst one was the editor loading dashboards wrong, so every saved board opened empty and then autosave wrote over the real one. A single stray quote also took down the whole home page, and no test caught it because nothing loaded that file. We also found out our secret scanning workflow had bad indentation, so it wasn't scanning anything.

Near the end we ran low on Kiro credits, so a lot of the last features got built with Claude Code inside the Kiro IDE instead. Our Kiro hooks still ran on everything Claude saved, so the same guardrails kept checking its work.

## Accomplishments that we're proud of
This was all of our first hackathon so I think we're all proud to have just worked together and completed something for this challenge. We're also pretty happy that Kiro can build a full board from one prompt.

## What we learned
None of us had done property-based testing before. One of those tests found an input that crashed our error handler, which our normal tests missed. We also learned it's worth setting up steering early, Kiro stopped reaching for frameworks we weren't using once we did.

## What's next for HiBeam
We want to publish the HiBeam power so anyone can install it from Kiro.
