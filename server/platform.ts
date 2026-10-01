import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, type ChildProcess } from 'node:child_process';

export const isWin = process.platform === 'win32';

const resolved = new Map<string, { cmd: string; pre: string[] }>();

/** Where Windows installers put CLIs, for when the app's PATH misses them (started before the install, or from the Start menu). */
function windowsBinDirs(): string[] {
  const home = process.env.USERPROFILE || '';
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [
    path.join(home, '.local', 'bin'), // Claude Code native installer
    path.join(appData, 'npm'), // npm -g
    path.join(local, 'pnpm'),
    path.join(home, '.bun', 'bin'),
    path.join(local, 'Volta', 'bin'),
    path.join(home, 'scoop', 'shims'),
  ];
}

/**
 * How to spawn a CLI such as `claude` / `codex`.
 * On Windows, npm installs them as `.cmd` shims that Node can't spawn without a shell
 * (and a shell would mangle our quoted arguments), so we run what the shim points at:
 * a JS entry through Node (codex), or a native .exe (claude ≥ 2.1 ships bin/claude.exe).
 */
export function resolveCommand(name: string): { cmd: string; pre: string[] } {
  if (!isWin) return { cmd: name, pre: [] };
  const hit = resolved.get(name);
  if (hit) return hit;
  const dirs = [...(process.env.PATH || '').split(path.delimiter).filter(Boolean), ...windowsBinDirs()];
  for (const dir of dirs) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const file = path.join(dir, name + ext);
      if (!fs.existsSync(file)) continue;
      let out: { cmd: string; pre: string[] } | undefined;
      if (ext === '.exe') out = { cmd: file, pre: [] };
      else {
        // npm / pnpm shim: ... "%dp0%\node_modules\@openai\codex\bin\codex.js" %*   or   ...\bin\claude.exe" %*
        let text = '';
        try {
          text = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        // the program the shim runs (a JS shim mentions node.exe first: that's the runtime, not the target)
        const targets = [...text.matchAll(/"%~?dp0%?\\?([^"]+\.(?:js|mjs|cjs|exe))"/gi)].map((m) => m[1]).filter((t) => !/(^|\\)node\.exe$/i.test(t));
        const target = targets.length ? path.join(dir, targets[targets.length - 1]) : '';
        if (target && fs.existsSync(target)) out = /\.exe$/i.test(target) ? { cmd: target, pre: [] } : { cmd: process.execPath, pre: [target] };
      }
      if (out) {
        resolved.set(name, out);
        return out;
      }
    }
  }
  // not found: don't remember it, so installing the CLI while the app runs is picked up
  return { cmd: name, pre: [] };
}

/** Spawn options that behave on every OS: own process group on Unix, no console popup on Windows. */
export const spawnOpts = { detached: !isWin, windowsHide: true } as const;

/** Stop a process and everything it started. */
export function killTree(child: ChildProcess | undefined, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child?.pid) return;
  if (isWin) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/** Relative path with forward slashes (the UI and git always use "/"). */
export const toPosix = (p: string) => p.split(path.sep).join('/');
