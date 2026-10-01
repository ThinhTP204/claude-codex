import { Terminal, type IDecoration, type IMarker } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { lineEditor } from './lineEditor.ts';
import { wsSend } from './api.ts';

// xterm.js instances live outside React so switching tabs or re-rendering never
// loses scrollback. React only decides which ones are attached to the panel.

/** One command run in a shell with integration (OSC 633 marks from server/shell/). */
export interface TermCommand {
  /** where its prompt starts */
  prompt: IMarker;
  /** first output line (after the command line) */
  output?: IMarker;
  /** where the next prompt starts = end of the output */
  end?: IMarker;
  command: string;
  exitCode?: number;
  deco?: IDecoration;
}

interface Entry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  host: HTMLDivElement;
  commands: TermCommand[];
  /** the command at the prompt now (between "A" and "D") */
  pending?: TermCommand;
  cwd?: string;
  running?: string;
}

const entries = new Map<string, Entry>();

// hooks into the store (set once by store.ts)
export interface TermHooks {
  link: (url: string) => void;
  file: (ref: string) => void;
  /** a command started (name) or finished (undefined) */
  running: (id: string, command: string | undefined) => void;
  /** click on a command's circle in the gutter */
  commandMenu: (id: string, index: number, x: number, y: number) => void;
  keys: (id: string, action: 'find' | 'split' | 'new') => void;
}
let hooks: TermHooks = { link: (url) => window.open(url, '_blank'), file: () => {}, running: () => {}, commandMenu: () => {}, keys: () => {} };
export const setTermHooks = (h: Partial<TermHooks>) => (hooks = { ...hooks, ...h });

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function theme() {
  return {
    background: cssVar('--term-bg'),
    foreground: cssVar('--fg'),
    cursor: cssVar('--accent'),
    cursorAccent: cssVar('--term-bg'),
    selectionBackground: 'rgba(217,119,87,0.3)',
    black: cssVar('--ansi-black'),
    red: cssVar('--ansi-red'),
    green: cssVar('--ansi-green'),
    yellow: cssVar('--ansi-yellow'),
    blue: cssVar('--ansi-blue'),
    magenta: cssVar('--ansi-magenta'),
    cyan: cssVar('--ansi-cyan'),
    white: cssVar('--ansi-white'),
    brightBlack: cssVar('--ansi-bright-black'),
    brightRed: cssVar('--ansi-bright-red'),
    brightGreen: cssVar('--ansi-bright-green'),
    brightYellow: cssVar('--ansi-bright-yellow'),
    brightBlue: cssVar('--ansi-bright-blue'),
    brightMagenta: cssVar('--ansi-bright-magenta'),
    brightCyan: cssVar('--ansi-bright-cyan'),
    brightWhite: cssVar('--ansi-bright-white'),
  };
}

/** The circle left of a prompt, like VS Code: hollow = not run yet, filled = done, red = failed. */
function decorate(id: string, e: Entry, c: TermCommand) {
  const deco = e.term.registerDecoration({ marker: c.prompt, width: 1, height: 1 });
  if (!deco) return;
  c.deco = deco;
  deco.onRender((el) => {
    el.classList.add('term-cmd-mark');
    el.classList.toggle('ok', c.exitCode === 0);
    el.classList.toggle('err', c.exitCode !== undefined && c.exitCode !== 0);
    el.classList.toggle('idle', c.exitCode === undefined);
    // the gutter left of column 0 (the terminal has padding there)
    el.style.left = '-13px';
    el.title = c.command ? `${c.command}${c.exitCode !== undefined ? ` · mã thoát ${c.exitCode}` : ''}` : '';
    el.onclick = (ev) => {
      ev.stopPropagation();
      const i = e.commands.indexOf(c);
      if (i >= 0 && c.command) hooks.commandMenu(id, i, ev.clientX, ev.clientY);
    };
  });
}

function onShellMark(id: string, e: Entry, data: string): boolean {
  const [kind, ...rest] = data.split(';');
  const arg = rest.join(';');
  const t = e.term;
  if (kind === 'A') {
    const prompt = t.registerMarker(0);
    if (!prompt) return true;
    // this prompt ends the previous command's output
    const prev = e.commands[e.commands.length - 1];
    if (prev && !prev.end) prev.end = prompt;
    else e.pending?.deco?.dispose(); // Enter on an empty line: drop its circle
    e.pending = { prompt, command: '' };
    decorate(id, e, e.pending);
  } else if (kind === 'E' && e.pending) e.pending.command = arg.trim();
  else if (kind === 'C' && e.pending) {
    e.pending.output = t.registerMarker(0);
    if (e.pending.command) {
      e.running = e.pending.command;
      hooks.running(id, e.running);
    }
  } else if (kind === 'D' && e.pending) {
    const c = e.pending;
    c.exitCode = Number(arg) || 0;
    // PowerShell reports the command only once it is done (no "C"): output starts under its prompt
    if (!c.output && c.command) {
      const buf = t.buffer.active;
      c.output = t.registerMarker(c.prompt.line + 1 - (buf.baseY + buf.cursorY));
    }
    if (c.command) {
      e.commands.push(c);
      if (e.commands.length > 500) e.commands.shift()?.deco?.dispose();
    }
    c.deco?.dispose();
    decorate(id, e, c);
    e.pending = undefined;
    if (e.running) {
      e.running = undefined;
      hooks.running(id, undefined);
    }
  } else if (kind === 'P' && arg.startsWith('Cwd=')) e.cwd = arg.slice(4);
  return true;
}

// "src/a.ts:12:5", "./x/y.py:3", "/abs/file.go" — opened in the editor on click
const FILE_RE = /(?:^|[\s'"`(\[])((?:\.{1,2}\/|\/|~\/)?(?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z][\w]{0,9}(?::\d+(?::\d+)?)?)(?=$|[\s'"`)\],;])/g;

function fileLinks(id: string, term: Terminal) {
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? '';
      const links = [];
      for (const m of line.matchAll(FILE_RE)) {
        const text = m[1];
        // skip URLs (handled by the web links addon) and bare domains like example.com
        if (/^\w+:\/\//.test(text) || line.slice(Math.max(0, m.index! - 8), m.index! + 1).includes('://')) continue;
        if (!text.includes('/') && !/\.(ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|kt|rb|php|css|scss|html|vue|svelte|yml|yaml|toml|sh|c|cc|cpp|h|hpp|cs|swift|sql|txt|lock|env)(?::\d+)?/.test(text)) continue;
        const start = m.index! + m[0].indexOf(text);
        links.push({
          range: { start: { x: start + 1, y }, end: { x: start + text.length, y } },
          text,
          decorations: { underline: true, pointerCursor: true },
          activate: () => {
            const cwd = entries.get(id)?.cwd;
            hooks.file(cwd && !/^[/~]/.test(text) ? `${cwd}/${text.replace(/^\.\//, '')}` : text);
          },
        });
      }
      callback(links);
    },
  });
}

export function ensureTerm(id: string, initial = '', pty = true): Entry {
  let e = entries.get(id);
  if (e) return e;
  const term = new Terminal({
    fontFamily: "'SF Mono', Menlo, Monaco, monospace",
    fontSize: 12.5,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    // basic mode (Windows) sends bare "\n" line endings
    convertEol: !pty,
    theme: theme(),
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon((_ev, uri) => hooks.link(uri)));
  const host = document.createElement('div');
  host.className = 'term-host';
  host.style.height = '100%';
  host.style.width = '100%';
  e = { term, fit, search, host, commands: [] };
  const entry = e;
  term.parser.registerOscHandler(633, (data) => onShellMark(id, entry, data));
  fileLinks(id, term);
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true;
    const mod = isMac ? ev.metaKey : ev.ctrlKey && ev.shiftKey;
    if (mod && ev.key.toLowerCase() === 'f') return hooks.keys(id, 'find'), false;
    if (isMac && ev.metaKey && ev.key.toLowerCase() === 'k') return term.clear(), false;
    if ((isMac ? ev.metaKey : ev.ctrlKey && ev.shiftKey) && ev.key === '\\') return hooks.keys(id, 'split'), false;
    if (ev.ctrlKey && ev.shiftKey && (ev.key === '`' || ev.key === '~')) return hooks.keys(id, 'new'), false;
    if ((isMac ? ev.metaKey : ev.ctrlKey) && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) return jumpCommand(id, ev.key === 'ArrowUp' ? -1 : 1), false;
    // Ctrl+Shift+C / V on Windows & Linux, like other terminals (Ctrl+C stays an interrupt)
    if (!isMac && ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'c') return void copySelection(id), false;
    if (!isMac && ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'v') return void pasteInto(id), false;
    return true;
  });
  term.open(host);
  if (initial) term.write(initial);
  if (pty) {
    term.onData((data) => wsSend({ type: 'term:input', id, data }));
  } else {
    // No PTY on the other end (Windows): edit the line here like a shell would, send it on Enter.
    const edit = lineEditor(
      (out) => term.write(out),
      (data) => wsSend({ type: 'term:input', id, data }),
    );
    term.onData(edit);
  }
  term.onResize(({ cols, rows }) => wsSend({ type: 'term:resize', id, cols, rows }));
  entries.set(id, e);
  return e;
}

export function writeTerm(id: string, data: string): void {
  entries.get(id)?.term.write(data);
}

/** Type text into the shell as if the user did (e.g. "run again"). */
export function sendToShell(id: string, text: string): void {
  wsSend({ type: 'term:input', id, data: text });
}

export function disposeTerm(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  e.term.dispose();
  e.host.remove();
  entries.delete(id);
}

export function fitTerm(id: string): void {
  const e = entries.get(id);
  if (!e || !e.host.isConnected || !e.host.clientWidth) return;
  try {
    e.fit.fit();
  } catch {
    /* not visible yet */
  }
}

export function focusTerm(id: string): void {
  entries.get(id)?.term.focus();
}

export const termHost = (id: string) => entries.get(id)?.host;
export const termCommands = (id: string) => entries.get(id)?.commands ?? [];
export const hasShellIntegration = (id: string) => !!entries.get(id)?.commands.length || !!entries.get(id)?.pending;

/** Lines [from, to) of the buffer as text. */
function lines(e: Entry, from: number, to: number): string {
  const buf = e.term.buffer.active;
  const out: string[] = [];
  for (let i = Math.max(0, from); i < Math.min(to, buf.length); i++) {
    const l = buf.getLine(i);
    const text = l?.translateToString(true) ?? '';
    // a long line the terminal wrapped onto several rows is one line of output
    if (l?.isWrapped && out.length) out[out.length - 1] += text;
    else out.push(text);
  }
  const clean = out.map((l) => l.trimEnd()).filter((l) => !/^%$/.test(l)); // zsh's "missing newline" marker
  while (clean.length && !clean[clean.length - 1].trim()) clean.pop();
  return clean.join('\n');
}

/** Output printed by a command (between its command line and the next prompt). */
export function commandOutput(id: string, index: number): string {
  const e = entries.get(id);
  const c = e?.commands[index];
  if (!e || !c?.output || c.output.isDisposed) return '';
  const end = c.end && !c.end.isDisposed ? c.end.line : e.term.buffer.active.length;
  return lines(e, c.output.line, end);
}

/** Scroll to the previous / next command's prompt (⌘↑ / ⌘↓). */
export function jumpCommand(id: string, dir: -1 | 1): void {
  const e = entries.get(id);
  if (!e) return;
  const top = e.term.buffer.active.viewportY;
  const rows = e.commands.map((c) => c.prompt.line).filter((l) => l >= 0);
  const target = dir < 0 ? rows.filter((l) => l < top).pop() : rows.find((l) => l > top);
  if (target !== undefined) e.term.scrollToLine(target);
  else if (dir > 0) e.term.scrollToBottom();
}

export function findInTerm(id: string, query: string, dir: 1 | -1, opts: { caseSensitive?: boolean; regex?: boolean } = {}): boolean {
  const e = entries.get(id);
  if (!e || !query) return false;
  const o = { ...opts, decorations: { matchOverviewRuler: '#d97757', activeMatchColorOverviewRuler: '#ffb08f', matchBackground: '#d9775744', activeMatchBackground: '#d97757aa' } };
  return dir > 0 ? e.search.findNext(query, o) : e.search.findPrevious(query, o);
}

export function clearFind(id: string): void {
  entries.get(id)?.search.clearDecorations();
}

export function copySelection(id: string): Promise<boolean> {
  const sel = entries.get(id)?.term.getSelection();
  if (!sel) return Promise.resolve(false);
  return navigator.clipboard.writeText(sel).then(
    () => true,
    () => false,
  );
}

export async function pasteInto(id: string): Promise<void> {
  const text = await navigator.clipboard.readText().catch(() => '');
  if (text) entries.get(id)?.term.paste(text);
}

export function selectAll(id: string): void {
  entries.get(id)?.term.selectAll();
}

/** Selected text, or the last `lines` lines of output. */
export function termText(id: string, count = 60): string {
  const e = entries.get(id);
  if (!e) return '';
  const sel = e.term.getSelection();
  if (sel.trim()) return sel;
  const buf = e.term.buffer.active;
  const out = lines(e, Math.max(0, buf.length - count * 3 - 200), buf.length).split('\n');
  while (out.length && !out[0].trim()) out.shift();
  return out.slice(-count).join('\n');
}

export function clearTerm(id: string): void {
  entries.get(id)?.term.clear();
}

export function retheme(): void {
  const t = theme();
  for (const e of entries.values()) e.term.options.theme = t;
}
