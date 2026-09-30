import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, type ChildProcess } from 'node:child_process';

export const isWin = process.platform === 'win32';

const resolved = new Map<string, { cmd: string; pre: string[] }>();

/**
 * How to spawn a CLI such as `claude` / `codex`.
 * On Windows, npm installs them as `.cmd` shims that Node can't spawn without a shell
 * (and a shell would mangle our quoted arguments), so we run the shim's JS entry with
 * Node directly. Native `.exe` installs are used as is.
 */
export function resolveCommand(name: string): { cmd: string; pre: string[] } {
  if (!isWin) return { cmd: name, pre: [] };
  const hit = resolved.get(name);
  if (hit) return hit;
  let out = { cmd: name, pre: [] as string[] };
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  search: for (const dir of dirs) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const file = path.join(dir, name + ext);
      if (!fs.existsSync(file)) continue;
      if (ext === '.exe') {
        out = { cmd: file, pre: [] };
        break search;
      }
      // npm shim: ... "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
      const m = /"%~?dp0%?\\?([^"]+\.(?:js|mjs|cjs))"/i.exec(fs.readFileSync(file, 'utf8'));
      if (m) {
        out = { cmd: process.execPath, pre: [path.join(dir, m[1])] };
        break search;
      }
    }
  }
  resolved.set(name, out);
  return out;
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
