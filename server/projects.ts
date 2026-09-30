import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { watch, type FSWatcher } from 'chokidar';
import type { FsEntry } from '../shared/types.ts';
import { dataFile, readJson, realpathSafe, writeJson } from './store.ts';
import { run } from './catalog.ts';

const RECENT_FILE = dataFile('recent.json');
const ALWAYS_HIDDEN = new Set(['.git', '.DS_Store']);
const HEAVY_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'target'];

export function recentProjects(): string[] {
  return readJson<string[]>(RECENT_FILE, []).filter((p) => fs.existsSync(p));
}

export function openProject(p: string): string {
  const abs = realpathSafe(p.replace(/^~(?=$|\/)/, process.env.HOME || ''));
  if (!fs.statSync(abs).isDirectory()) throw new Error('Không phải thư mục');
  writeJson(RECENT_FILE, [abs, ...recentProjects().filter((x) => x !== abs)].slice(0, 15));
  return abs;
}

export function forgetProject(p: string): string[] {
  const list = recentProjects().filter((x) => x !== p);
  writeJson(RECENT_FILE, list);
  return list;
}

/** Native macOS folder picker */
export function pickFolder(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', 'POSIX path of (choose folder with prompt "Chọn thư mục project")'],
      { timeout: 5 * 60_000 },
      (err, stdout) => resolve(err ? null : stdout.trim().replace(/\/$/, '') || null),
    );
  });
}

/** Resolve a project-relative path and refuse anything that escapes the root. */
export function safeJoin(root: string, rel: string): string {
  const abs = path.resolve(root, rel || '.');
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Đường dẫn nằm ngoài project');
  return abs;
}

/** Repo info for a project dir; the project may be a sub-folder of a repo (or a worktree). */
const gitCache = new Map<string, { at: number; prefix: string | null }>();
async function gitPrefix(root: string): Promise<string | null> {
  const hit = gitCache.get(root);
  if (hit && Date.now() - hit.at < 30_000) return hit.prefix;
  const r = await run('git', ['-C', root, 'rev-parse', '--show-prefix'], 5000);
  const prefix = r.code === 0 ? r.stdout.trim() : null;
  gitCache.set(root, { at: Date.now(), prefix });
  return prefix;
}

async function gitIgnored(root: string, rels: string[]): Promise<Set<string>> {
  if (!rels.length || (await gitPrefix(root)) === null) return new Set();
  return new Promise((resolve) => {
    const p = spawn('git', ['check-ignore', '--stdin', '-z'], { cwd: root });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(new Set()));
    p.on('close', () => resolve(new Set(out.split('\0').filter(Boolean))));
    p.stdin.end(rels.join('\0') + '\0');
  });
}

export async function listDir(root: string, rel: string): Promise<FsEntry[]> {
  const dir = safeJoin(root, rel);
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !ALWAYS_HIDDEN.has(e.name));
  const rels = entries.map((e) => path.join(rel, e.name));
  const ignored = await gitIgnored(root, rels);
  const git = (await gitPrefix(root)) !== null;
  // Like VS Code: ignored entries stay visible (dimmed) instead of disappearing.
  return entries
    .map((e, i) => {
      let type: 'dir' | 'file' = e.isDirectory() ? 'dir' : 'file';
      if (e.isSymbolicLink()) {
        try {
          type = fs.statSync(path.join(dir, e.name)).isDirectory() ? 'dir' : 'file';
        } catch {
          /* broken link */
        }
      }
      const isIgnored = ignored.has(rels[i]) || (!git && HEAVY_DIRS.includes(e.name));
      return { name: e.name, path: rels[i], type, ...(isIgnored ? { ignored: true } : {}) };
    })
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1));
}

export function readFile(root: string, rel: string): { content: string; binary: boolean; size: number; tooLarge: boolean } {
  const abs = safeJoin(root, rel);
  const size = fs.statSync(abs).size;
  if (size > 3 * 1024 * 1024) return { content: '', binary: false, size, tooLarge: true };
  const buf = fs.readFileSync(abs);
  const binary = buf.subarray(0, 8000).includes(0);
  return { content: binary ? '' : buf.toString('utf8'), binary, size, tooLarge: false };
}

export function writeFile(root: string, rel: string, content: string): void {
  fs.writeFileSync(safeJoin(root, rel), content);
}

/** git status → { "src/a.ts": "M", "new.ts": "U", ... } */
export async function gitStatus(root: string): Promise<{ branch?: string; files: Record<string, string> }> {
  const prefix = await gitPrefix(root);
  if (prefix === null) return { files: {} };
  // paths come back relative to the repo root; `-- .` limits them to this project folder
  const r = await run('git', ['-C', root, 'status', '--porcelain=v1', '-z', '-uall', '--branch', '--', '.'], 10000);
  const files: Record<string, string> = {};
  let branch: string | undefined;
  const parts = r.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('## ')) {
      branch = line.slice(3).split('...')[0].replace(/^No commits yet on /, '');
      continue;
    }
    const xy = line.slice(0, 2);
    const file = line.slice(3);
    let code = 'M';
    if (xy === '??') code = 'U';
    else if (xy.includes('A')) code = 'A';
    else if (xy.includes('D')) code = 'D';
    else if (xy.includes('R')) {
      code = 'R';
      i++; // rename: next entry is the original path
    }
    if (file.startsWith(prefix)) files[file.slice(prefix.length)] = code;
  }
  return { branch, files };
}

export async function gitHead(root: string, rel: string): Promise<string | null> {
  if ((await gitPrefix(root)) === null) return null;
  const r = await run('git', ['-C', root, 'show', `HEAD:./${rel}`], 10000);
  return r.code === 0 ? r.stdout : null;
}

// ---- file watching: one watcher per open project, shared by every window ----
const watchers = new Map<string, { w: FSWatcher; refs: number }>();

export function watchProject(root: string, onChange: (paths: string[]) => void): () => void {
  let entry = watchers.get(root);
  if (!entry) {
    let pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const w = watch(root, {
      ignoreInitial: true,
      ignored: (p: string) => HEAVY_DIRS.some((d) => p.includes(`${path.sep}${d}${path.sep}`) || p.endsWith(`${path.sep}${d}`)),
      depth: 12,
    });
    w.on('all', (_ev, p) => {
      pending.add(path.relative(root, p));
      clearTimeout(timer);
      timer = setTimeout(() => {
        const paths = [...pending];
        pending = new Set();
        onChange(paths);
      }, 300);
    });
    w.on('error', () => {});
    entry = { w, refs: 0 };
    watchers.set(root, entry);
  }
  entry.refs++;
  return () => {
    const e = watchers.get(root);
    if (!e) return;
    if (--e.refs <= 0) {
      void e.w.close();
      watchers.delete(root);
    }
  };
}
