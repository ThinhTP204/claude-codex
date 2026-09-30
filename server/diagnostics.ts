// "Problems" like VS Code: run the checkers a project already uses and collect their findings.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { CheckResult, CheckTool, Diagnostic } from '../shared/diagnostics.ts';
import { nestedRepos } from './projects.ts';
import { isWin, toPosix } from './platform.ts';

const exists = (...p: string[]) => fs.existsSync(path.join(...p));

function run(cmd: string, args: string[], cwd: string, timeout = 180_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) =>
    execFile(cmd, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } }, (e, out, err) =>
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: String(out), err: String(err || (e && !out ? e.message : '')) }),
    ),
  );
}

type Raw = Omit<Diagnostic, 'file'> & { abs: string };
const node = process.execPath;
// run the checkers' JS entry points with our own Node: same on every OS, no .cmd shims
const bin = (dir: string, ...p: string[]) => path.join(dir, 'node_modules', ...p);

const TS_LINE = /^(.+?)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/;
const GH_LINE = /^::(error|warning|notice) (?:title=([^,]*),)?file=(.*?),line=(\d+)(?:,endLine=(\d+))?(?:,col=(\d+))?(?:,endColumn=(\d+))?::(.*)$/;

const CHECKERS: { name: string; perFile: boolean; detect: (dir: string) => boolean; exec: (dir: string, files?: string[]) => Promise<{ list: Raw[]; error?: string }> }[] = [
  {
    name: 'TypeScript',
    perFile: false, // types depend on the whole program
    detect: (d) => exists(d, 'tsconfig.json') && exists(bin(d, 'typescript', 'bin', 'tsc')),
    async exec(d) {
      const r = await run(node, [bin(d, 'typescript', 'bin', 'tsc'), '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], d);
      const list: Raw[] = [];
      for (const line of r.out.split('\n')) {
        const m = TS_LINE.exec(line.trim());
        if (m) list.push({ abs: path.resolve(d, m[1]), line: +m[2], col: +m[3], severity: m[4] === 'error' ? 'error' : 'warning', message: m[6], source: 'ts', code: m[5] });
        else if (list.length && /^\s{2,}/.test(line)) list[list.length - 1].message += `\n${line.trim()}`; // continuation lines
      }
      return { list, error: !list.length && r.code !== 0 ? (r.err || r.out).trim().slice(0, 400) : undefined };
    },
  },
  {
    name: 'ESLint',
    perFile: true,
    detect: (d) =>
      exists(bin(d, 'eslint', 'bin', 'eslint.js')) &&
      (fs.readdirSync(d).some((f) => /^(\.eslintrc(\..+)?|eslint\.config\.(js|mjs|cjs|ts|mts|cts))$/.test(f)) || /"eslintConfig"/.test(safeRead(path.join(d, 'package.json')))),
    async exec(d, files) {
      const r = await run(node, [bin(d, 'eslint', 'bin', 'eslint.js'), '-f', 'json', '--no-error-on-unmatched-pattern', ...(files?.length ? files : ['.'])], d);
      try {
        const json = JSON.parse(r.out.slice(r.out.indexOf('[')));
        const list: Raw[] = [];
        for (const f of json)
          for (const m of f.messages || [])
            list.push({ abs: f.filePath, line: m.line || 1, col: m.column || 1, endLine: m.endLine, endCol: m.endColumn, severity: m.severity === 2 ? 'error' : 'warning', message: m.message, source: 'eslint', code: m.ruleId || undefined });
        return { list };
      } catch {
        return { list: [], error: (r.err || r.out).trim().slice(0, 400) || 'Không đọc được kết quả ESLint' };
      }
    },
  },
  {
    name: 'Biome',
    perFile: true,
    detect: (d) => (exists(d, 'biome.json') || exists(d, 'biome.jsonc')) && exists(bin(d, '@biomejs', 'biome', 'bin', 'biome')),
    async exec(d, files) {
      const r = await run(node, [bin(d, '@biomejs', 'biome', 'bin', 'biome'), 'lint', '--reporter=github', '--max-diagnostics=none', '--no-errors-on-unmatched', ...(files?.length ? files : ['.'])], d);
      const list: Raw[] = [];
      for (const line of r.out.split('\n')) {
        const m = GH_LINE.exec(line.trim());
        if (!m) continue;
        list.push({
          abs: path.resolve(d, m[3]),
          line: +m[4],
          col: +(m[6] || 1),
          endLine: m[5] ? +m[5] : undefined,
          endCol: m[7] ? +m[7] : undefined,
          severity: m[1] === 'error' ? 'error' : m[1] === 'warning' ? 'warning' : 'info',
          message: m[8].replace(/%0A/g, '\n').replace(/%25/g, '%'),
          source: 'biome',
          code: m[2]?.replace(/^lint\//, ''),
        });
      }
      return { list, error: !list.length && r.code !== 0 && !/No files were processed|Checked \d+ file/.test(r.err + r.out) ? (r.err || r.out).trim().slice(0, 400) : undefined };
    },
  },
  {
    name: 'Ruff',
    perFile: true,
    detect: (d) => (exists(d, 'pyproject.toml') || exists(d, 'ruff.toml') || exists(d, '.ruff.toml')) && !!ruffBin(d),
    async exec(d, files) {
      const r = await run(ruffBin(d)!, ['check', '--output-format', 'json', '--no-fix', ...(files?.length ? files : ['.'])], d);
      try {
        const json = JSON.parse(r.out);
        return {
          list: json.map((m: any) => ({ abs: m.filename, line: m.location?.row || 1, col: m.location?.column || 1, endLine: m.end_location?.row, endCol: m.end_location?.column, severity: 'warning', message: m.message, source: 'ruff', code: m.code })),
        };
      } catch {
        return { list: [], error: (r.err || r.out).trim().slice(0, 400) };
      }
    },
  },
];

function safeRead(f: string): string {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
}

/** ruff from the project's virtualenv, else from PATH */
function ruffBin(d: string): string | undefined {
  for (const v of ['.venv', 'venv']) {
    const p = path.join(d, v, isWin ? 'Scripts' : 'bin', isWin ? 'ruff.exe' : 'ruff');
    if (fs.existsSync(p)) return p;
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, isWin ? 'ruff.exe' : 'ruff');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/** Which checkers each folder (project + nested repos) uses: shown before anything runs. */
export function detectCheckers(project: string): { dir: string; tools: string[] }[] {
  return ['', ...nestedRepos(project)]
    .map((rel) => ({ dir: rel, tools: CHECKERS.filter((c) => c.detect(rel ? path.join(project, rel) : project)).map((c) => c.name) }))
    .filter((x) => x.tools.length);
}

let busy: Promise<CheckResult> | undefined;

/**
 * Run the checkers. With `files` (project-relative) only the per-file ones run on those files
 * (after a save); without, everything runs on the whole project and nested repos.
 */
export async function runChecks(project: string, files?: string[]): Promise<CheckResult> {
  if (!files && busy) return busy; // a full run is already going: share it
  const job = (async () => {
    const tools: CheckTool[] = [];
    const diagnostics: Diagnostic[] = [];
    for (const rel of ['', ...nestedRepos(project)]) {
      const dir = rel ? path.join(project, rel) : project;
      // files of this folder, relative to it (and not inside a deeper nested repo)
      const mine = files
        ?.filter((f) => (rel ? f.startsWith(rel + '/') : true))
        .filter((f) => !nestedRepos(project).some((n) => n !== rel && n.length > rel.length && f.startsWith(n + '/')))
        .map((f) => (rel ? f.slice(rel.length + 1) : f));
      if (files && !mine?.length) continue;
      for (const c of CHECKERS) {
        if (files && !c.perFile) continue;
        if (!c.detect(dir)) continue;
        const t0 = Date.now();
        const before = diagnostics.length;
        const r = await c.exec(dir, mine).catch((e) => ({ list: [] as Raw[], error: String((e as Error).message) }));
        for (const d of r.list) {
          const relFile = toPosix(path.relative(project, d.abs));
          if (relFile.startsWith('..')) continue;
          // tool/build folders (.agents skills, .next, .claude…) aren't the user's code
          if (relFile.split('/').slice(0, -1).some((seg) => seg.startsWith('.'))) continue;
          const { abs: _a, ...rest } = d;
          diagnostics.push({ ...rest, file: relFile });
        }
        tools.push({ name: c.name, dir: rel, ok: !r.error, count: diagnostics.length - before, ms: Date.now() - t0, error: r.error });
      }
    }
    return { diagnostics, tools, files, at: Date.now() };
  })();
  if (!files) {
    busy = job;
    job.finally(() => (busy = undefined));
  }
  return job;
}
