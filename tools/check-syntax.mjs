// Syntax-checks every tracked .js / .mjs file with `node --check`.
// Catches the class of bug where one bad quote stops a whole page's script
// from running (it happened to home.html once). Run: npm run check
import { execFileSync, spawnSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '*.js', '*.mjs'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.startsWith('node_modules/'));

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${file}\n${result.stderr.trim()}`);
}

if (failures.length) {
  process.stderr.write(`Syntax errors in ${failures.length} file(s):\n\n${failures.join('\n\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Syntax OK (${files.length} files)\n`);
