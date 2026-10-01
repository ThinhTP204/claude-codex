import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import type { FsEntry } from '../shared/types.ts';
import { dataFile, readJson, realpathSafe, writeJson } from './store.ts';
import { run } from './catalog.ts';
import { isWin, toPosix } from './platform.ts';

const RECENT_FILE = dataFile('recent.json');
const ALWAYS_HIDDEN = new Set(['.git', '.DS_Store']);
const HEAVY_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'target'];

export function recentProjects(): string[] {
  return readJson<string[]>(RECENT_FILE, []).filter((p) => fs.existsSync(p));
}

/** "~/x" or a symlinked path → the real absolute directory (throws if it isn't one). */
function realDir(p: string): string {
  const abs = realpathSafe(p.replace(/^~(?=$|\/)/, process.env.HOME || ''));
  if (!fs.statSync(abs).isDirectory()) throw new Error('Không phải thư mục');
  return abs;
}

export function openProject(p: string): string {
  const abs = realDir(p);
  writeJson(RECENT_FILE, [abs, ...recentProjects().filter((x) => x !== abs)].slice(0, 15));
  return abs;
}

// ---- multi-root workspace: extra folders shown next to a project (like VS Code) ----
const WORKSPACE_FILE = dataFile('workspaces.json');

/** Extra folders added to `project`'s workspace (missing ones are skipped). */
export function workspaceFolders(project: string): string[] {
  const all = readJson<Record<string, string[]>>(WORKSPACE_FILE, {});
  return (all[project] || []).filter((p) => p !== project && fs.existsSync(p));
}

export function setWorkspaceFolders(project: string, folders: string[]): string[] {
  const clean = [...new Set(folders.map(realDir))].filter((f) => f !== project);
  const all = readJson<Record<string, string[]>>(WORKSPACE_FILE, {});
  if (clean.length) all[project] = clean;
  else delete all[project];
  writeJson(WORKSPACE_FILE, all);
  return clean;
}

export function forgetProject(p: string): string[] {
  const list = recentProjects().filter((x) => x !== p);
  writeJson(RECENT_FILE, list);
  return list;
}

// Windows: a hidden, always-on-top owner window so the dialog opens in front of the
// Edge app window instead of behind it; UTF-8 output so Vietnamese paths survive.
const WIN_PICKER = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Chọn thư mục project'
$d.ShowNewFolderButton = $true
$r = $d.ShowDialog($owner)
$owner.Close()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
`;

/** Native folder picker for the current OS. `path: null` without `error` = the user cancelled. */
export function pickFolder(): Promise<{ path: string | null; error?: string }> {
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'osascript';
    args = ['-e', 'POSIX path of (choose folder with prompt "Chọn thư mục project")'];
  } else if (isWin) {
    // -EncodedCommand (UTF-16LE base64) sidesteps every quoting/encoding problem of -Command
    cmd = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_PICKER, 'utf16le').toString('base64')];
  } else {
    cmd = 'zenity';
    args = ['--file-selection', '--directory', '--title=Chọn thư mục project'];
  }
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10 * 60_000, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = String(stdout).trim();
      if (out) {
        // keep drive roots like "C:\" intact, drop other trailing slashes
        return resolve({ path: /^[A-Za-z]:[\\/]$/.test(out) ? out : out.replace(/[\\/]+$/, '') });
      }
      if (!err) return resolve({ path: null }); // cancelled
      const msg = `${stderr || ''} ${err.message}`;
      // osascript: -128 = user cancelled; zenity: exit 1 = cancelled
      if (/-128|User canceled/i.test(msg) || (cmd === 'zenity' && Number((err as { code?: unknown }).code) === 1)) {
        return resolve({ path: null });
      }
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      resolve({
        path: null,
        error: missing ? `Không tìm thấy \`${cmd}\` để mở hộp thoại chọn thư mục` : String(stderr || err.message).trim().slice(0, 300),
      });
    });
  });
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string; git: boolean }[];
  /** quick jumps: home, Desktop, Documents… and drive letters on Windows */
  places: { name: string; path: string }[];
}

/** In-app folder browser (works on every OS, no native dialog needed). */
export function browseDirs(dir?: string, showHidden = false): BrowseResult {
  const home = os.homedir();
  const abs = path.resolve((dir || home).replace(/^~(?=$|[\\/])/, home));
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const dirs = entries
    .filter((e) => {
      if (!(e.isDirectory() || e.isSymbolicLink())) return false;
      if (!showHidden && e.name.startsWith('.')) return false;
      if (isWin && /^(\$Recycle\.Bin|System Volume Information|\$WinREAgent|Config\.Msi)$/i.test(e.name)) return false;
      try {
        return fs.statSync(path.join(abs, e.name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((e) => {
      const full = path.join(abs, e.name);
      return { name: e.name, path: full, git: fs.existsSync(path.join(full, '.git')) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const parent = path.dirname(abs) === abs ? null : path.dirname(abs);
  const places = [
    { name: 'Home', path: home },
    ...['Desktop', 'Documents', 'Downloads', 'code', 'Projects', 'source/repos']
      .map((n) => ({ name: n.split('/').pop()!, path: path.join(home, n) }))
      .filter((p) => fs.existsSync(p.path)),
  ];
  if (isWin) {
    for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') if (fs.existsSync(`${l}:\\`)) places.push({ name: `${l}:`, path: `${l}:\\` });
  } else {
    places.push({ name: '/', path: '/' });
  }
  return { path: abs, parent, dirs, places };
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

// ---- repos nested inside the project (a parent folder holding several repos, like VS Code) ----
const nestedCache = new Map<string, { at: number; repos: string[] }>();

function isWorktree(gitFile: string): boolean {
  try {
    return /[\\/]worktrees[\\/]/.test(fs.readFileSync(gitFile, 'utf8'));
  } catch {
    return false;
  }
}

/** Project-relative paths of git repos inside `root` (up to 3 levels deep, not inside each other). */
export function nestedRepos(root: string): string[] {
  const hit = nestedCache.get(root);
  if (hit && Date.now() - hit.at < 30_000) return hit.repos;
  const repos: string[] = [];
  const walk = (rel: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    const git = entries.find((e) => e.name === '.git');
    if (rel && git) {
      // a linked worktree (.git is a file "gitdir: …/.git/worktrees/x") is a checkout of another repo, not a repo of its own
      if (!(git.isFile() && isWorktree(path.join(root, rel, '.git')))) repos.push(rel);
      return; // a repo's own sub-repos are its business (submodules)
    }
    if (depth >= 3) return;
    for (const e of entries) {
      // hidden folders (.kilo, .claude, .cursor worktrees…) are tool state, like VS Code we don't scan them
      if (!e.isDirectory() || e.name.startsWith('.') || HEAVY_DIRS.includes(e.name)) continue;
      walk(rel ? `${rel}/${e.name}` : e.name, depth + 1);
    }
  };
  walk('', 0);
  nestedCache.set(root, { at: Date.now(), repos });
  return repos;
}

/** The repo that owns `rel`: the deepest nested repo containing it, else the project itself. */
export function repoOf(root: string, rel: string): { dir: string; prefix: string } {
  const r = nestedRepos(root)
    .filter((x) => rel === x || rel.startsWith(x + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return r ? { dir: path.join(root, r), prefix: r + '/' } : { dir: root, prefix: '' };
}

async function gitIgnored(root: string, rels: string[]): Promise<Set<string>> {
  if (!rels.length) return new Set();
  // entries of one directory all belong to the same repo
  const dirRel = rels[0].includes('/') ? rels[0].slice(0, rels[0].lastIndexOf('/')) : '';
  const { dir, prefix } = repoOf(root, dirRel);
  if ((await gitPrefix(dir)) === null) return new Set();
  const inRepo = rels.filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length));
  if (!inRepo.length) return new Set();
  return new Promise((resolve) => {
    const p = spawn('git', ['check-ignore', '--stdin', '-z'], { cwd: dir });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(new Set()));
    p.on('close', () => resolve(new Set(out.split('\0').filter(Boolean).map((x) => prefix + x))));
    p.stdin.end(inRepo.join('\0') + '\0');
  });
}

export async function listDir(root: string, rel: string): Promise<FsEntry[]> {
  const dir = safeJoin(root, rel);
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !ALWAYS_HIDDEN.has(e.name));
  const rels = entries.map((e) => (rel ? `${rel}/${e.name}` : e.name));
  const ignored = await gitIgnored(root, rels);
  const git = (await gitPrefix(repoOf(root, rel).dir)) !== null;
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

// ---- resolving file references written by agents ----

let fileListCache: { root: string; at: number; files: string[] } | undefined;

/** Every file of the project (tracked + untracked, minus .gitignore'd); cached a few seconds. */
async function projectFiles(root: string): Promise<string[]> {
  if (fileListCache?.root === root && Date.now() - fileListCache.at < 10_000) return fileListCache.files;
  let files: string[] = [];
  const nested = nestedRepos(root);
  const lsFiles = async (dir: string, prefix: string) => {
    const r = await run('git', ['-C', dir, 'ls-files', '-co', '--exclude-standard', '-z'], 15_000);
    // an untracked nested repo shows up as "sub/": its own listing covers it
    return r.stdout.split('\0').filter((f) => f && !f.endsWith('/')).map((f) => prefix + f);
  };
  if ((await gitPrefix(root)) !== null) {
    files = await lsFiles(root, '');
  } else {
    const walk = (dir: string) => {
      if (files.length > 30_000) return;
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (ALWAYS_HIDDEN.has(e.name) || HEAVY_DIRS.includes(e.name) || e.name.startsWith('.pyenv')) continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (nested.includes(rel)) continue; // listed through git below (respects .gitignore)
        if (e.isDirectory()) walk(rel);
        else files.push(rel);
      }
    };
    walk('');
  }
  for (const r of nested) files.push(...(await lsFiles(path.join(root, r), r + '/')));
  fileListCache = { root, at: Date.now(), files };
  return files;
}

/**
 * Turn "src/a.tsx:12", "/abs/path/a.tsx#L12", "file:///…", "./a.tsx" or just "a.tsx"
 * into a project-relative path (+ line). Bare names are looked up among the project files.
 */
export async function resolveFileRef(root: string, ref: string): Promise<{ path?: string; line?: number; candidates?: string[] }> {
  let p = decodeURIComponent(ref.trim()).replace(/^file:\/\//, '').replace(/^`|`$/g, '');
  let line: number | undefined;
  const hash = /#L(\d+)(?:-L?\d+)?$/.exec(p);
  if (hash) {
    line = Number(hash[1]);
    p = p.slice(0, hash.index);
  }
  const colon = /:(\d+)(?::\d+)?$/.exec(p);
  if (colon && !/^[A-Za-z]:$/.test(p.slice(0, colon.index))) {
    line ??= Number(colon[1]);
    p = p.slice(0, colon.index);
  }
  p = p.replace(/^\.\//, '').replace(/\\/g, '/');
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
  if (abs === root || abs.startsWith(root + path.sep)) {
    try {
      if (fs.statSync(abs).isFile()) return { path: toPosix(path.relative(root, abs)), line };
    } catch {
      /* not a direct hit, search below */
    }
  }
  // "components/x.tsx" or "x.tsx": find files ending with it
  const tail = p.replace(/^\/+/, '');
  if (!tail || tail.endsWith('/')) return {};
  const files = await projectFiles(root);
  const hits = files.filter((f) => f === tail || f.endsWith('/' + tail));
  if (hits.length === 1) return { path: hits[0], line };
  if (hits.length > 1) {
    hits.sort((a, b) => a.length - b.length);
    return { path: hits[0], line, candidates: hits.slice(0, 8) };
  }
  return {};
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
  const own = await ownStatus(root);
  // repos inside the project: their changes show in the same tree, under their folder
  for (const r of nestedRepos(root)) {
    const sub = await ownStatus(path.join(root, r));
    for (const [f, code] of Object.entries(sub.files)) own.files[`${r}/${f}`] = code;
  }
  return own;
}

/** Every repo in the project (itself if it is one, plus nested ones) with branch and change count. */
export async function projectRepos(root: string): Promise<{ path: string; rel: string; branch?: string; changes: number }[]> {
  const list = [...((await gitPrefix(root)) !== null ? [''] : []), ...nestedRepos(root)];
  return Promise.all(
    list.map(async (rel) => {
      const dir = rel ? path.join(root, rel) : root;
      const st = await ownStatus(dir);
      return { path: dir, rel, branch: st.branch, changes: Object.keys(st.files).filter((f) => !f.endsWith('/')).length };
    }),
  );
}

const statusCache = new Map<string, { at: number; p: Promise<{ branch?: string; files: Record<string, string> }> }>();

/** Forget cached statuses (after commit/stage/checkout… the next read must be fresh). */
export function clearStatusCache(): void {
  statusCache.clear();
}

/** `git status` of one repo; calls within a second share one git process (the UI asks for repos + status together). */
function ownStatus(root: string): Promise<{ branch?: string; files: Record<string, string> }> {
  const hit = statusCache.get(root);
  if (hit && Date.now() - hit.at < 1000) return hit.p.then((r) => ({ branch: r.branch, files: { ...r.files } }));
  const p = readStatus(root);
  statusCache.set(root, { at: Date.now(), p });
  if (statusCache.size > 50) statusCache.delete(statusCache.keys().next().value!);
  return p.then((r) => ({ branch: r.branch, files: { ...r.files } }));
}

async function readStatus(root: string): Promise<{ branch?: string; files: Record<string, string> }> {
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
    // "sub/" = an untracked nested repo; its files are reported by that repo
    if (file.startsWith(prefix) && !file.endsWith('/')) files[file.slice(prefix.length)] = code;
  }
  return { branch, files };
}

export async function gitHead(root: string, rel: string): Promise<string | null> {
  const { dir, prefix } = repoOf(root, rel);
  if ((await gitPrefix(dir)) === null) return null;
  const r = await run('git', ['-C', dir, 'show', `HEAD:./${rel.slice(prefix.length)}`], 10000);
  return r.code === 0 ? r.stdout : null;
}

// ---- file watching: one watcher per open project, shared by every window ----
const watchers = new Map<string, { w: fs.FSWatcher; refs: number }>();
// python virtualenvs (".pyenv-x", "site-packages") churn thousands of files nobody edits by hand
const isHeavy = (seg: string) => HEAVY_DIRS.includes(seg) || seg.startsWith('.pyenv') || seg === 'site-packages' || seg.endsWith('.egg-info');

/**
 * Node's recursive fs.watch: FSEvents on macOS and ReadDirectoryChangesW on Windows need a single
 * handle for the whole tree (chokidar opened one per file and ran out of descriptors on big repos).
 */
export function watchProject(root: string, onChange: (paths: string[]) => void): () => void {
  let entry = watchers.get(root);
  if (!entry) {
    let pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    let w: fs.FSWatcher;
    try {
      w = fs.watch(root, { recursive: true }, (_ev, file) => {
        if (!file) return;
        const rel = toPosix(String(file));
        if (rel.split('/').some(isHeavy) || rel.endsWith('.DS_Store')) return;
        pending.add(rel);
        clearTimeout(timer);
        timer = setTimeout(() => {
          const paths = [...pending];
          pending = new Set();
          onChange(paths);
        }, 300);
      });
    } catch {
      return () => {};
    }
    w.on('error', () => {});
    entry = { w, refs: 0 };
    watchers.set(root, entry);
  }
  entry.refs++;
  return () => {
    const e = watchers.get(root);
    if (!e) return;
    if (--e.refs <= 0) {
      e.w.close();
      watchers.delete(root);
    }
  };
}

// ---- quick open (⌘P): every file of the project ----
const MAX_FILES = 50_000;

/** Project-relative paths of all files: git's view (tracked + untracked, minus ignored) for repos, a walk elsewhere. */
export async function listAllFiles(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const out: string[] = [];
  const nested = nestedRepos(root);
  const repos = [...((await gitPrefix(root)) !== null ? [''] : []), ...nested];
  for (const rel of repos) {
    const r = await run('git', ['-C', rel ? path.join(root, rel) : root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], 20000);
    if (r.code !== 0) continue;
    for (const f of r.stdout.split('\0')) if (f) out.push(rel ? `${toPosix(rel)}/${f}` : f);
  }
  if (!repos.includes('')) {
    // a plain folder (maybe holding repos): walk what is outside those repos
    const skip = new Set(nested.map(toPosix));
    const walk = (rel: string, depth: number) => {
      if (out.length >= MAX_FILES || depth > 10) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!e.name.startsWith('.') && !HEAVY_DIRS.includes(e.name) && !skip.has(p)) walk(p, depth + 1);
        } else if (e.isFile() && !ALWAYS_HIDDEN.has(e.name)) out.push(p);
      }
    };
    walk('', 0);
  }
  const files = [...new Set(out)];
  return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES };
}
