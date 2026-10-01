#!/usr/bin/env node
// Windows checks that can't run on a Mac (GitHub Actions: .github/workflows/windows-smoke.yml):
// the ConPTY terminal (PowerShell + cmd, clear, exit codes, resize, Ports) and starting the
// npm-installed `claude` / `codex` CLIs. Exits non-zero on the first failure.
import { createTerm, killTerm, listPorts, listProfiles, listTerms, resizeTerm, writeTerm } from '../server/terminals.ts';
import { run } from '../server/catalog.ts';
import { resolveCommand } from '../server/platform.ts';

const project = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const buffer = (id) => listTerms(project).find((t) => t.id === id)?.buffer ?? '';
const plain = (s) => s.replace(/\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
let failed = 0;
function check(ok, what, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : `\n    ${detail.slice(-1500).replace(/\n/g, '\n    ')}`}`);
  if (!ok) failed++;
}
async function waitFor(id, test, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test(buffer(id))) return true;
    await sleep(250);
  }
  return false;
}

// --- terminal ---
const profiles = listProfiles(project);
console.log('shells:', profiles.shells.map((s) => `${s.name} (${s.path})`).join(', '));
check(profiles.shells.some((s) => s.name === 'PowerShell'), 'PowerShell is offered');

const ps = createTerm(project, { cols: 120, rows: 30 });
check(ps.pty, 'PowerShell runs in a ConPTY (not basic mode)', JSON.stringify(ps));
check(await waitFor(ps.id, (b) => b.includes('633;A')), 'PowerShell prompt carries shell-integration marks', buffer(ps.id));
writeTerm(ps.id, 'echo hello-agentdesk\r');
// typed once by the user, printed once by echo
check(await waitFor(ps.id, (b) => plain(b).split('hello-agentdesk').length > 2), 'echo prints output', buffer(ps.id));
check(await waitFor(ps.id, (b) => b.includes('633;E;echo hello-agentdesk') && b.includes('633;D;0')), 'success is marked (D;0)', buffer(ps.id));
writeTerm(ps.id, 'cmd /c exit 3\r');
check(await waitFor(ps.id, (b) => b.includes('633;D;3')), 'a failing command is marked with its exit code (D;3)', buffer(ps.id));
resizeTerm(ps.id, 90, 20);
writeTerm(ps.id, '$Host.UI.RawUI.WindowSize.Width\r');
check(await waitFor(ps.id, (b) => /\r\n90\r\n/.test(plain(b))), 'resize reaches the shell (width 90)', buffer(ps.id));
writeTerm(ps.id, 'cls\r');
check(await waitFor(ps.id, (b) => /\x1b\[(2J|H)/.test(b.split('cls').pop() || '')), 'cls clears the screen', buffer(ps.id).slice(-400));

const cmd = profiles.shells.find((s) => s.name === 'Command Prompt');
if (cmd) {
  const c = createTerm(project, { cols: 100, rows: 30, shell: cmd.path });
  writeTerm(c.id, 'echo from-cmd\r');
  check(await waitFor(c.id, (b) => plain(b).includes('from-cmd')), 'Command Prompt works', buffer(c.id));
  writeTerm(c.id, 'python -m http.server 8799\r');
  let port;
  for (let i = 0; i < 40 && !port; i++) {
    await sleep(500);
    port = (await listPorts(project)).find((p) => p.port === 8799);
  }
  check(!!port && port.termId === c.id, 'Ports finds the server started in the terminal', JSON.stringify(await listPorts(project)));
  killTerm(c.id);
}
killTerm(ps.id);

// --- CLIs installed with npm (claude ships bin/claude.exe, codex bin/codex.js) ---
for (const [name, expect] of [
  ['claude', /Claude Code/i],
  ['codex', /codex/i],
]) {
  const how = resolveCommand(name);
  const v = await run(name, ['--version'], 60000);
  check(v.code === 0 && expect.test(v.stdout + v.stderr), `${name} --version runs (${how.cmd} ${how.pre.join(' ')})`, `${v.code} ${v.stdout} ${v.stderr}`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
