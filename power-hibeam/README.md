# HiBeam Kiro power

This folder packages HiBeam's MCP server and the know-how for using it as a [Kiro power](https://kiro.dev/docs/powers/). It uses the Agent Plugins layout that Kiro recommends for new powers:

| File | What it is |
|---|---|
| `plugin.json` | The manifest: name, description, and the keywords that activate the power ("dashboard", "status page", "kpi", ...) |
| `mcp.json` | Starts the `hibeam` MCP server over stdio |
| `server.mjs` | A small entry point that runs the real server, [`mcp/hibeam-server.mjs`](../mcp/hibeam-server.mjs), in place |
| `skills/hibeam-boards/SKILL.md` | The build → look → fix loop, the rules that keep the numbers right, and the widget settings worth knowing |

The workspace setup in `.kiro/` (`settings/mcp.json` plus the `#mcp` steering doc) only works inside this repo. The power carries the same tools and guidance into any Kiro workspace. Because the activation keywords decide when it loads, it doesn't take up context until someone asks for a board.

## Install

1. Clone the repo and run `npm install` at its root. The server uses the repo's dependencies and its dashboard generator. For `screenshot_dashboard`, also run `npx playwright install --only-shell chromium` once.
2. Copy `mcp/.env.example` to `mcp/.env` and fill in a HiBeam account (a dedicated one is best). Start HiBeam with `npm run serve`.
3. In Kiro, open the **Powers** panel and choose **Add Custom Power** → **Import power from a folder**. Pick this `power-hibeam/` folder, then **Install**.
4. Ask for something it covers, like "make me a status page from my metrics source", and Kiro activates the power.

If you also have the workspace server from `.kiro/settings/mcp.json` turned on, switch one of them off so the tools don't show up twice.

If Kiro copies the power folder somewhere else when it installs it, `server.mjs` can't find `../mcp/hibeam-server.mjs`. It says so on stderr. Set `HIBEAM_SERVER` to the absolute path of `mcp/hibeam-server.mjs` in your clone.

## Checked so far

- `node power-hibeam/server.mjs` answers the MCP `initialize` handshake and lists all 18 tools.
- **Not checked yet:** loading it through Kiro's Powers panel. That costs about one credit.
