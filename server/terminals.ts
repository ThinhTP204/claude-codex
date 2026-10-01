import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ServerMessage, TermInfo, TermPort, TermProfiles } from '../shared/types.ts';
import { DATA_DIR, uid } from './store.ts';
import { isWin, killTree, spawnOpts } from './platform.ts';

// Interactive shells for the Terminal panel, always in a real pseudo terminal when the OS allows:
// prompts, colours, Tab completion, Ctrl+C, clear, vim, htop… all work.
//   macOS / Linux: a login shell under server/pty_host.py (Python's pty module)
//   Windows 10 1809+: ConPTY via server/conpty_host.cs, compiled on first use
// Otherwise (old Windows, no compiler, no python3): "basic" mode, the shell over plain pipes with
// line editing done by the UI.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PTY_HELPER = path.join(HERE, 'pty_host.py');
const CONPTY_SRC = path.join(HERE, 'conpty_host.cs');
// OSC 633 prompt/command marks (see server/shell/): command decorations, jump between commands
const ZSH_INTEGRATION = path.join(HERE, 'shell', 'zsh');
const BASH_INTEGRATION = path.join(HERE, 'shell', 'bash.sh');
const PWSH_INTEGRATION = path.join(HERE, 'shell', 'pwsh.ps1');
const SCROLLBACK = 200_000; // chars replayed when the window reloads

/** The ConPTY relay, built with the C# compiler that ships with Windows (.NET Framework 4). */
let conptyExe: string | null | undefined;
function conptyHost(): string | null {
  if (conptyExe !== undefined) return conptyExe;
  conptyExe = null;
  const build = Number(os.release().split('.')[2] || 0);
  if (!isWin || build < 17763 || !fs.existsSync(CONPTY_SRC)) return null;
  const exe = path.join(DATA_DIR, 'bin', 'conpty_host.exe');
  try {
    if (fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= fs.statSync(CONPTY_SRC).mtimeMs) return (conptyExe = exe);
    const win = process.env.WINDIR || 'C:\\Windows';
    const csc = ['Framework64', 'Framework'].map((f) => path.join(win, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find((f) => fs.existsSync(f));
    if (!csc) return null;
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    const r = spawnSync(csc, ['/nologo', '/target:exe', '/optimize', `/out:${exe}`, CONPTY_SRC], { windowsHide: true, encoding: 'utf8', timeout: 60_000 });
    if (r.status === 0 && fs.existsSync(exe)) conptyExe = exe;
    else console.error('[terminal] could not build conpty_host:', (r.stdout || '') + (r.stderr || ''));
  } catch (e) {
    console.error('[terminal] conpty_host:', (e as Error).message);
  }
  return conptyExe;
}

let ptyOk: boolean | undefined;
function canPty(): boolean {
  // AGENTDESK_BASIC_TERM=1 forces the line mode (to test it anywhere)
  if (ptyOk === undefined)
    ptyOk = process.env.AGENTDESK_BASIC_TERM !== '1' && (isWin ? !!conptyHost() : spawnSync('python3', ['-c', 'import pty, termios'], { windowsHide: true }).status === 0);
  return ptyOk;
}

/** Windows shells a ConPTY can host, by path. */
function windowsShells(): TermProfiles['shells'] {
  const sys = path.join(process.env.WINDIR || 'C:\\Windows', 'System32');
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const onPath = (exe: string) => (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, exe)).find((f) => fs.existsSync(f));
  const list: [string, string | undefined][] = [
    ['PowerShell', path.join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe')],
    ['PowerShell 7', onPath('pwsh.exe') || [path.join(pf, 'PowerShell', '7', 'pwsh.exe')].find((f) => fs.existsSync(f))],
    ['Command Prompt', path.join(sys, 'cmd.exe')],
    ['Git Bash', [path.join(pf, 'Git', 'bin', 'bash.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')].find((f) => fs.existsSync(f))],
    ['WSL', path.join(sys, 'wsl.exe')],
  ];
  return list.filter((x): x is [string, string] => !!x[1] && fs.existsSync(x[1])).map(([name, p], i) => ({ name, path: p, default: i === 0 }));
}

/** Command line for a Windows shell inside ConPTY, with prompt marks where the shell supports them. */
function windowsCommandLine(shell: string): string {
  const base = path.basename(shell).toLowerCase();
  const q = (s: string) => `"${s}"`;
  if (base === 'powershell.exe' || base === 'pwsh.exe') {
    let script = '';
    try {
      script = fs.readFileSync(PWSH_INTEGRATION, 'utf8');
    } catch {
      /* no integration */
    }
    // -EncodedCommand: no script file, so the execution policy doesn't get in the way
    return script ? `${q(shell)} -NoLogo -NoExit -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}` : `${q(shell)} -NoLogo`;
  }
  if (base === 'bash.exe' && !shell.toLowerCase().includes('system32') && fs.existsSync(BASH_INTEGRATION)) return `${q(shell)} --init-file ${q(BASH_INTEGRATION.replace(/\\/g, '/'))} -i`;
  return q(shell);
}

interface Term extends TermInfo {
  child?: ChildProcess;
  /** shell program (pty mode) */
  shellPath?: string;
  /** typed into the shell once it starts (e.g. "npm run dev" from the scripts menu) */
  command?: string;
  buffer: string;
  /** basic PowerShell: print a prompt after each command (off while cmd/python… owns stdin) */
  prompt?: boolean;
}

const terms = new Map<string, Term>();
let broadcast: (m: ServerMessage) => void = () => {};
export const setTermBroadcast = (fn: typeof broadcast) => (broadcast = fn);

const info = ({ child: _c, buffer: _b, prompt: _p, shellPath: _s, command: _m, ...t }: Term): TermInfo => t;

// "-Command -" never prints a prompt: ask PowerShell for one after every command, like a console would
const PS_PROMPT = 'Write-Host -NoNewline ("PS " + $PWD.Path + "> ")\n';
const INTERACTIVE = /^(cmd(\.exe)?|python\d*(\.exe)?|py|node|pwsh|powershell(\.exe)?|ssh\b.*|wsl|bash|mysql\b.*|psql\b.*|irb|sqlite3\b.*|mongosh\b.*)$/i;

function emit(t: Term, data: string) {
  t.buffer = (t.buffer + data).slice(-SCROLLBACK);
  broadcast({ type: 'term:data', id: t.id, data });
}

function startShell(t: Term, cols: number, rows: number) {
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'AgentDesk' };
  let child: ChildProcess;
  if (t.pty && isWin) {
    const shell = t.shellPath || windowsShells()[0]?.path || 'powershell.exe';
    child = spawn(conptyHost()!, [String(cols || 80), String(rows || 24), windowsCommandLine(shell)], { cwd: t.cwd || t.projectPath, stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
  } else if (t.pty) {
    const shell = t.shellPath || process.env.SHELL || '/bin/zsh';
    const base = path.basename(shell);
    let argv = [shell, '-l'];
    if (base === 'zsh' && fs.existsSync(path.join(ZSH_INTEGRATION, '.zshenv'))) {
      env.AGENTDESK_USER_ZDOTDIR = process.env.ZDOTDIR || process.env.HOME || '';
      env.ZDOTDIR = ZSH_INTEGRATION;
    } else if (base === 'bash' && fs.existsSync(BASH_INTEGRATION)) argv = [shell, '--init-file', BASH_INTEGRATION, '-i'];
    env.SHELL = shell;
    child = spawn('python3', [PTY_HELPER, String(cols || 80), String(rows || 24), ...argv], { cwd: t.cwd || t.projectPath, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env });
  } else if (isWin) {
    // "-Command -" runs each line read from stdin; UTF-8 so Vietnamese output survives
    child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '-'], { cwd: t.cwd || t.projectPath, stdio: ['pipe', 'pipe', 'pipe'], env, ...spawnOpts });
    child.stdin!.write('[Console]::OutputEncoding = [Text.Encoding]::UTF8\n');
    t.prompt = true;
    child.stdin!.write(PS_PROMPT);
  } else {
    child = spawn(process.env.SHELL || '/bin/sh', ['-i'], { cwd: t.cwd || t.projectPath, stdio: ['pipe', 'pipe', 'pipe'], env, ...spawnOpts });
  }
  t.child = child;
  t.alive = true;
  t.exitCode = undefined;
  const onData = (d: Buffer) => emit(t, d.toString('utf8'));
  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  child.on('error', (e) => emit(t, `\r\n[AgentDesk] Không mở được terminal: ${e.message}\r\n`));
  if (t.command) {
    // typed once the shell is listening, like a user would
    const cmd = t.command;
    t.command = undefined;
    setTimeout(() => t.child === child && writeTerm(t.id, `${cmd}${t.pty ? '\r' : '\n'}`), t.pty ? 400 : 100);
  }
  child.on('exit', (code) => {
    if (t.child !== child) return; // replaced by an interrupt/restart
    t.alive = false;
    t.exitCode = code ?? undefined;
    broadcast({ type: 'term:exit', id: t.id, code: code ?? undefined });
  });
}

export interface NewTerm {
  cols: number;
  rows: number;
  /** shell program from listProfiles() (pty mode); default: the login shell */
  shell?: string;
  /** split: open next to this group's terminals */
  group?: string;
  /** start in this folder (absolute, inside the project) */
  cwd?: string;
  /** run this right away, e.g. "npm run dev" */
  command?: string;
  title?: string;
}

export function createTerm(projectPath: string, o: NewTerm): TermInfo {
  const n = [...terms.values()].filter((t) => t.projectPath === projectPath).length + 1;
  const pty = canPty();
  const shellPath = pty && o.shell && listProfiles(projectPath).shells.some((s) => s.path === o.shell) ? o.shell : undefined;
  const name = pty ? path.basename(shellPath || (isWin ? windowsShells()[0]?.path || 'powershell' : process.env.SHELL || 'zsh')).replace(/\.exe$/i, '').toLowerCase() : isWin ? 'powershell' : 'sh';
  const cwd = o.cwd && path.resolve(o.cwd).startsWith(path.resolve(projectPath)) && fs.existsSync(o.cwd) ? o.cwd : undefined;
  const id = uid('term_');
  const t: Term = { id, projectPath, title: o.title || `${name} ${n}`, alive: true, pty, createdAt: Date.now(), buffer: '', group: o.group && terms.has(o.group) ? terms.get(o.group)!.group : id, shellPath, command: o.command, cwd };
  terms.set(t.id, t);
  if (!pty) emit(t, `\x1b[2m[Chế độ cơ bản: ${isWin ? 'Windows này không có ConPTY (cần Windows 10 1809 trở lên)' : 'thiếu python3'}. Gõ lệnh rồi Enter; Ctrl+C khởi động lại shell.]\x1b[0m\r\n`);
  startShell(t, o.cols, o.rows);
  return info(t);
}

export function renameTerm(id: string, title: string): TermInfo | undefined {
  const t = terms.get(id);
  if (!t || !title.trim()) return;
  t.title = title.trim().slice(0, 60);
  broadcast({ type: 'term:info', term: info(t) });
  return info(t);
}

/** Shells to pick from (+ menu) and the project's package.json scripts. */
export function listProfiles(projectPath: string): TermProfiles {
  const shells: TermProfiles['shells'] = [];
  if (isWin && canPty()) shells.push(...windowsShells());
  else if (isWin || !canPty()) shells.push({ name: isWin ? 'PowerShell' : 'sh', path: '' });
  else {
    let listed: string[] = [];
    try {
      listed = fs.readFileSync('/etc/shells', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/'));
    } catch {
      /* no /etc/shells */
    }
    const login = process.env.SHELL;
    for (const p of [login, ...listed, '/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/opt/homebrew/bin/bash'].filter((x): x is string => !!x)) {
      if (shells.some((s) => s.path === p) || !fs.existsSync(p)) continue;
      const base = path.basename(p);
      if (!/^(zsh|bash|fish|sh|dash|ksh|tcsh|nu|pwsh)$/.test(base)) continue;
      const same = shells.filter((s) => s.name.split(' ')[0] === base).length;
      shells.push({ name: same ? `${base} (${p})` : base, path: p, default: p === login });
    }
  }
  let scripts: TermProfiles['scripts'] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
    const has = (f: string) => fs.existsSync(path.join(projectPath, f));
    const pm = has('bun.lockb') || has('bun.lock') ? 'bun' : has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
    scripts = Object.entries((pkg.scripts || {}) as Record<string, string>).map(([name, cmd]) => ({ name, cmd, run: pm === 'npm' ? `npm run ${name}` : `${pm} ${name}` }));
  } catch {
    /* no package.json */
  }
  return { shells, scripts };
}

function sh(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 8000, maxBuffer: 8 << 20, windowsHide: true }, (_e, out) => resolve(String(out || ''))));
}

/** TCP ports listened on by anything started from this project's terminals (dev servers…). */
export async function listPorts(projectPath: string): Promise<TermPort[]> {
  const mine = [...terms.values()].filter((t) => t.projectPath === projectPath && t.alive && t.child?.pid);
  if (!mine.length) return [];
  // parent → children, to find every process below each terminal
  const kids = new Map<number, number[]>();
  const names = new Map<number, string>();
  if (isWin) {
    const out = await sh('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }']);
    for (const l of out.split(/\r?\n/)) {
      const m = /^(\d+) (\d+) (.*)$/.exec(l.trim());
      if (m) (kids.get(+m[2]) || kids.set(+m[2], []).get(+m[2])!).push(+m[1]), names.set(+m[1], m[3]);
    }
  } else {
    const out = await sh('ps', ['-A', '-o', 'pid=,ppid=,comm=']);
    for (const l of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
      if (m) (kids.get(+m[2]) || kids.set(+m[2], []).get(+m[2])!).push(+m[1]), names.set(+m[1], path.basename(m[3].trim()));
    }
  }
  const owner = new Map<number, Term>();
  for (const t of mine) {
    const stack = [t.child!.pid!];
    while (stack.length) {
      const p = stack.pop()!;
      if (owner.has(p)) continue;
      owner.set(p, t);
      stack.push(...(kids.get(p) || []));
    }
  }
  const found: TermPort[] = [];
  const add = (port: number, pid: number, host: string) => {
    const t = owner.get(pid);
    if (!t || found.some((f) => f.port === port)) return;
    found.push({ port, pid, process: names.get(pid) || String(pid), termId: t.id, termTitle: t.title, host });
  };
  if (isWin) {
    const out = await sh('powershell.exe', ['-NoProfile', '-Command', 'Get-NetTCPConnection -State Listen | ForEach-Object { "$($_.LocalPort) $($_.OwningProcess) $($_.LocalAddress)" }']);
    for (const l of out.split(/\r?\n/)) {
      const m = /^(\d+) (\d+) (\S+)/.exec(l.trim());
      if (m) add(+m[1], +m[2], m[3]);
    }
  } else {
    const out = await sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']);
    let pid = 0;
    for (const l of out.split('\n')) {
      if (l.startsWith('p')) pid = +l.slice(1);
      else if (l.startsWith('n')) {
        const m = /^(.*):(\d+)$/.exec(l.slice(1));
        if (m) add(+m[2], pid, m[1]);
      }
    }
  }
  return found.sort((a, b) => a.port - b.port);
}

/** Stop the process listening on a port (only one started from our terminals). */
export async function stopPort(projectPath: string, pid: number): Promise<void> {
  const port = (await listPorts(projectPath)).find((p) => p.pid === pid);
  if (!port) throw new Error('Không tìm thấy process này trong các terminal của project');
  try {
    process.kill(pid, isWin ? undefined : 'SIGINT');
  } catch (e) {
    throw new Error(`Không dừng được process ${pid}: ${(e as Error).message}`);
  }
}

export function listTerms(projectPath: string): (TermInfo & { buffer: string })[] {
  return [...terms.values()].filter((t) => t.projectPath === projectPath).map((t) => ({ ...info(t), buffer: t.buffer }));
}

export function writeTerm(id: string, data: string): void {
  const t = terms.get(id);
  if (!t?.alive || !t.child) return;
  if (!t.pty && data === '\x03') return interruptTerm(t);
  if (!t.pty && isWin && t.prompt && data.endsWith('\n')) {
    const line = data.slice(0, -1);
    // an interactive program (cmd, python, node…) is about to own stdin: stop adding PowerShell to it
    if (INTERACTIVE.test(line.trim())) t.prompt = false;
    // same line, so the prompt prints once the command is done and a program reading stdin
    // never receives it; skip lines that continue on the next one or end in a comment
    else if (!/[{(|`,]\s*$|#/.test(line)) return void t.child.stdin!.write(`${line.trim() ? `${line}; ` : ''}${PS_PROMPT}`);
  }
  t.child.stdin!.write(data);
}

/** Basic mode has no PTY to deliver Ctrl+C, so stop the whole tree and start a fresh shell. */
function interruptTerm(t: Term) {
  const old = t.child;
  t.child = undefined;
  killTree(old, 'SIGINT');
  emit(t, '^C\r\n\x1b[2m[Đã dừng lệnh, mở lại shell]\x1b[0m\r\n');
  startShell(t, 80, 24);
}

export function resizeTerm(id: string, cols: number, rows: number): void {
  const t = terms.get(id);
  if (!t?.alive || !t.pty || !(cols > 0 && rows > 0)) return;
  // conpty_host takes it in-band on stdin, pty_host.py on its control pipe (fd 3)
  if (isWin) t.child?.stdin?.write(`\x1b]7799;${cols};${rows}\x07`);
  else (t.child?.stdio[3] as NodeJS.WritableStream | undefined)?.write(`${cols} ${rows}\n`);
}

export function killTerm(id: string): void {
  const t = terms.get(id);
  if (!t) return;
  if (t.alive) {
    if (t.pty && !isWin) t.child?.kill('SIGTERM'); // pty_host.py hangs up the shell's whole process group
    else killTree(t.child);
  }
  terms.delete(id);
  broadcast({ type: 'term:closed', id });
}

// Closing AgentDesk closes every shell (and whatever dev server runs in it).
process.on('exit', () => {
  for (const t of terms.values()) {
    if (!t.alive) continue;
    if (t.pty && !isWin) t.child?.kill('SIGTERM');
    else killTree(t.child);
  }
});
