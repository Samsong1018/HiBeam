// screenshot_dashboard: the parts that run without a browser or a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ScreenshotBoard } from '../mcp/screenshot.mjs';

test('refuses a malformed dashboard id before starting a browser', async () => {
  for (const id of ['', '../etc/passwd', 'a b', 'x'.repeat(65), 'dash?x=1']) {
    await assert.rejects(ScreenshotBoard({ baseUrl: 'http://localhost:1', cookie: null, id }), /not a valid dashboard id/);
  }
});

test('the viewer marks the board rendered on every outcome the tool waits for', () => {
  const src = fs.readFileSync(new URL('../Web/frontend/scripts/view/main.js', import.meta.url), 'utf8');
  assert.match(src, /dataset\.boardRendered = 'true'/);
  assert.match(src, /Promise\.allSettled\(firstRenders\)\.then\(markRendered\)/); // widgets
  assert.match(src, /showEmpty\(isOwner, editHref\);\s*markRendered\(\);/); // empty board
  assert.match(src, /board\(null\);\s*markRendered\(\);/); // fatal state
});

test('the MCP server registers screenshot_dashboard', () => {
  const src = fs.readFileSync(new URL('../mcp/hibeam-server.mjs', import.meta.url), 'utf8');
  assert.match(src, /'screenshot_dashboard'/);
  assert.match(src, /type: 'image', data: png\.toString\('base64'\), mimeType: 'image\/png'/);
});
