// PreToolUse guard for Kiro agents working in this repo.
// Kiro pipes a JSON description of the pending tool call on stdin.
// Exit 2 blocks the call (stderr is shown to the agent); exit 0 lets it run.
//
// This is a guardrail against accidents, not a security boundary: if the
// payload can't be parsed it lets the call through.

const SHELL_RULES = [
  { re: /\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/, why: 'force-pushing rewrites shared history on main' },
  { re: /\bgit\s+reset\s+--hard\b/, why: 'git reset --hard throws away uncommitted work' },
  { re: /\bgit\s+clean\s+-[a-z]*f/, why: 'git clean -f deletes untracked files' },
  { re: /\brm\s+-[a-z]*r[a-z]*\s+(\/(\s|$|\*)|~|\.{1,2}(\/\*?)?(\s|$)|\*)/, why: 'recursive delete of a broad path' },
  { re: /\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b/i, why: 'destructive SQL against the shared team database' },
  { re: /\bDELETE\s+FROM\s+[\w.`]+\s*(;|"|'|$)/im, why: 'DELETE without a WHERE clause' },
  { re: /\bcat\b[^\n|]*(^|[\s/])\.env\b(?!\.example)/, why: 'printing .env would put the DB tunnel credentials into the chat log' },
];

const ENV_FILE = /(^|[\\/])\.env$/;

function collect(node, out = { tool: '', commands: [], paths: [] }, key = '') {
  if (typeof node === 'string') {
    if (/tool.?name|^tool$/i.test(key) && !out.tool) out.tool = node;
    else if (/^(command|cmd|script)$/i.test(key)) out.commands.push(node);
    else if (/path|file|target/i.test(key)) out.paths.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((v) => collect(v, out, key));
  } else if (node && typeof node === 'object') {
    Object.entries(node).forEach(([k, v]) => collect(v, out, k));
  }
  return out;
}

function block(reason) {
  process.stderr.write(`Blocked by .kiro/hooks/guard-tool-use: ${reason}. Ask the user to run this themselves if it's really intended.\n`);
  process.exit(2);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }
  const { tool, commands, paths } = collect(payload);

  for (const command of commands) {
    const hit = SHELL_RULES.find((rule) => rule.re.test(command));
    if (hit) block(`\`${command.slice(0, 120)}\` (${hit.why})`);
  }

  const writesFiles = /write|replace|append|edit|delete|create/i.test(tool);
  const envPath = paths.find((p) => ENV_FILE.test(p.trim()));
  if (envPath && (writesFiles || !tool)) block(`changing ${envPath} (holds real credentials; edit .env.example instead)`);

  process.exit(0);
});
