import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ServerMessage, TermInfo } from '../shared/types.ts';
import { uid } from './store.ts';
import { isWin, killTree, spawnOpts } from './platform.ts';

// Interactive shells for the Terminal panel.
// macOS / Linux: a login shell in a real PTY (server/pty_host.py) — prompts, colours,
// Ctrl+C, vim, htop… all work. Windows (no Unix PTY): PowerShell over pipes, with line
// editing done by the UI ("basic" mode).

const PTY_HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pty_host.py');
const SCROLLBACK = 200_000; // chars replayed when the window reloads

let ptyOk: boolean | undefined;
function canPty(): boolean {
  // AGENTDESK_BASIC_TERM=1 forces the Windows-style line mode (for testing it on macOS/Linux)
  if (ptyOk === undefined) ptyOk = process.env.AGENTDESK_BASIC_TERM !== '1' && !isWin && spawnSync('python3', ['-c', 'import pty, termios'], { windowsHide: true }).status === 0;
  return ptyOk;
}

interface Term extends TermInfo {
  child?: ChildProcess;
  buffer: string;
  /** basic PowerShell: print a prompt after each command (off while cmd/python… owns stdin) */
  prompt?: boolean;
}

const terms = new Map<string, Term>();
let broadcast: (m: ServerMessage) => void = () => {};
export const setTermBroadcast = (fn: typeof broadcast) => (broadcast = fn);

const info = ({ child: _c, buffer: _b, prompt: _p, ...t }: Term): TermInfo => t;

// "-Command -" never prints a prompt: ask PowerShell for one after every command, like a console would
const PS_PROMPT = 'Write-Host -NoNewline ("PS " + $PWD.Path + "> ")\n';
const INTERACTIVE = /^(cmd(\.exe)?|python\d*(\.exe)?|py|node|pwsh|powershell(\.exe)?|ssh\b.*|wsl|bash|mysql\b.*|psql\b.*|irb|sqlite3\b.*|mongosh\b.*)$/i;

function emit(t: Term, data: string) {
  t.buffer = (t.buffer + data).slice(-SCROLLBACK);
  broadcast({ type: 'term:data', id: t.id, data });
}

function startShell(t: Term, cols: number, rows: number) {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'AgentDesk' };
  let child: ChildProcess;
  if (t.pty) {
    child = spawn('python3', [PTY_HELPER, String(cols || 80), String(rows || 24)], { cwd: t.projectPath, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env });
  } else if (isWin) {
    // "-Command -" runs each line read from stdin; UTF-8 so Vietnamese output survives
    child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '-'], { cwd: t.projectPath, stdio: ['pipe', 'pipe', 'pipe'], env, ...spawnOpts });
    child.stdin!.write('[Console]::OutputEncoding = [Text.Encoding]::UTF8\n');
    t.prompt = true;
    child.stdin!.write(PS_PROMPT);
  } else {
    child = spawn(process.env.SHELL || '/bin/sh', ['-i'], { cwd: t.projectPath, stdio: ['pipe', 'pipe', 'pipe'], env, ...spawnOpts });
  }
  t.child = child;
  t.alive = true;
  t.exitCode = undefined;
  const onData = (d: Buffer) => emit(t, d.toString('utf8'));
  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  child.on('error', (e) => emit(t, `\r\n[AgentDesk] Không mở được terminal: ${e.message}\r\n`));
  child.on('exit', (code) => {
    if (t.child !== child) return; // replaced by an interrupt/restart
    t.alive = false;
    t.exitCode = code ?? undefined;
    broadcast({ type: 'term:exit', id: t.id, code: code ?? undefined });
  });
}

export function createTerm(projectPath: string, cols: number, rows: number): TermInfo {
  const n = [...terms.values()].filter((t) => t.projectPath === projectPath).length + 1;
  const pty = canPty();
  const name = pty ? path.basename(process.env.SHELL || 'zsh') : isWin ? 'powershell' : 'sh';
  const t: Term = { id: uid('term_'), projectPath, title: `${name} ${n}`, alive: true, pty, createdAt: Date.now(), buffer: '' };
  terms.set(t.id, t);
  if (!pty) emit(t, `\x1b[2m[Chế độ cơ bản: ${isWin ? 'Windows không có PTY' : 'thiếu python3'}. Gõ lệnh rồi Enter; Ctrl+C khởi động lại shell.]\x1b[0m\r\n`);
  startShell(t, cols, rows);
  return info(t);
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
  if (t?.alive && t.pty && cols > 0 && rows > 0) (t.child?.stdio[3] as NodeJS.WritableStream | undefined)?.write(`${cols} ${rows}\n`);
}

export function killTerm(id: string): void {
  const t = terms.get(id);
  if (!t) return;
  if (t.alive) {
    if (t.pty) t.child?.kill('SIGTERM'); // pty_host.py hangs up the shell's whole process group
    else killTree(t.child);
  }
  terms.delete(id);
  broadcast({ type: 'term:closed', id });
}

// Closing AgentDesk closes every shell (and whatever dev server runs in it).
process.on('exit', () => {
  for (const t of terms.values()) {
    if (!t.alive) continue;
    if (t.pty) t.child?.kill('SIGTERM');
    else killTree(t.child);
  }
});
