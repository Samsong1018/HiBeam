#!/usr/bin/env node
// ============================================================
// Entry point for the HiBeam Kiro power.
// The real server is mcp/hibeam-server.mjs in this repo. It imports the
// dashboard generator from Web/, so the power runs it in place instead of
// shipping a copy that could drift.
//
// Installed from this repo's folder, ../mcp/hibeam-server.mjs is found on
// its own. If Kiro copied the power somewhere else, set HIBEAM_SERVER to
// the absolute path of mcp/hibeam-server.mjs in your clone.
//
// Credentials come from mcp/.env next to the real server (or HIBEAM_*
// environment variables), exactly as with .kiro/settings/mcp.json.
// ============================================================

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.env.HIBEAM_SERVER || path.join(here, '..', 'mcp', 'hibeam-server.mjs');

if (!fs.existsSync(target)) {
  // stderr only: stdout is the MCP stream
  process.stderr.write(
    `[hibeam-power] Can't find the HiBeam MCP server at ${target}.\n`
    + '               Set HIBEAM_SERVER to the absolute path of mcp/hibeam-server.mjs in your clone.\n',
  );
  process.exit(1);
}

await import(pathToFileURL(target).href);
