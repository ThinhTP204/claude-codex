import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { lineEditor } from './lineEditor.ts';
import { wsSend } from './api.ts';

// xterm.js instances live outside React so switching tabs or re-rendering never
// loses scrollback. React only decides which one is attached to the panel.

interface Entry {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
}

const entries = new Map<string, Entry>();
let linkHandler: (url: string) => void = (url) => window.open(url, '_blank');
export const setLinkHandler = (fn: (url: string) => void) => (linkHandler = fn);

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

export function ensureTerm(id: string, initial = '', pty = true): Entry {
  let e = entries.get(id);
  if (e) return e;
  const term = new Terminal({
    fontFamily: "'SF Mono', Menlo, Monaco, monospace",
    fontSize: 12.5,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    // basic mode (Windows) sends bare "\n" line endings
    convertEol: !pty,
    theme: theme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_ev, uri) => linkHandler(uri)));
  const host = document.createElement('div');
  host.style.height = '100%';
  host.style.width = '100%';
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
  e = { term, fit, host };
  entries.set(id, e);
  return e;
}

export function writeTerm(id: string, data: string): void {
  entries.get(id)?.term.write(data);
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

/** Selected text, or the last `lines` lines of output. */
export function termText(id: string, lines = 60): string {
  const e = entries.get(id);
  if (!e) return '';
  const sel = e.term.getSelection();
  if (sel.trim()) return sel;
  const buf = e.term.buffer.active;
  const out: string[] = [];
  for (let i = Math.max(0, buf.length - lines - 200); i < buf.length; i++) {
    const line = buf.getLine(i)?.translateToString(true) ?? '';
    if (/^%\s*$/.test(line)) continue; // zsh's "missing newline" marker
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  while (out.length && !out[0].trim()) out.shift();
  return out.slice(-lines).join('\n');
}

export function clearTerm(id: string): void {
  entries.get(id)?.term.clear();
}

export function retheme(): void {
  const t = theme();
  for (const e of entries.values()) e.term.options.theme = t;
}

