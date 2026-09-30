// Self-update for installs made with `git clone`: fetch, pull, npm install, build, restart.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isWin } from './platform.ts';
import { DATA_DIR } from './store.ts';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface UpdateCheck {
  supported: boolean;
  reason?: string;
  commit?: string;
  subject?: string;
  /** package.json version and date of the running commit, for humans */
  version?: string;
  date?: string;
  /** installed from a .dmg / setup.exe: updates come from GitHub Releases, not git */
  packaged?: boolean;
  /** packaged: the release page to download from */
  downloadUrl?: string;
  /** packaged: the app-code archive the in-place updater installs */
  payloadUrl?: string;
  latest?: string;
  behind: number;
  commits: { hash: string; subject: string; date: string }[];
  checkedAt: number;
}

export interface UpdateJob {
  phase: 'idle' | 'pull' | 'install' | 'build' | 'download' | 'extract' | 'restart' | 'done' | 'error';
  log: string;
  error?: string;
}

function sh(cmd: string, args: string[], onData?: (s: string) => void, timeoutMs = 10 * 60_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    // npm is npm.cmd on Windows and needs a shell; our arguments are fixed so quoting is safe
    const child = spawn(cmd, args, { cwd: APP_ROOT, shell: isWin && cmd === 'npm', windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } });
    let out = '';
    const take = (d: Buffer) => {
      const s = d.toString();
      out += s;
      onData?.(s);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(t);
      resolve({ code: -1, out: out + String(e.message) });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, out });
    });
  });
}

const git = (args: string[], timeout = 30_000) => sh('git', args, undefined, timeout);

let cached: UpdateCheck | undefined;

/** Is there a newer version on the tracked branch? (network: `git fetch`, cached 10 min) */
export async function checkUpdate(force = false): Promise<UpdateCheck> {
  if (!force && cached && Date.now() - cached.checkedAt < 10 * 60_000) return cached;
  const base = { behind: 0, commits: [], checkedAt: Date.now() };
  if (!fs.existsSync(path.join(APP_ROOT, '.git'))) return (cached = await checkRelease(base));
  const head = await git(['log', '-1', '--format=%h%x09%s%x09%cI']);
  const [commit, subject, date] = head.out.trim().split('\t');
  let version: string | undefined;
  try {
    version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    /* no version */
  }
  const up = await git(['rev-parse', '--abbrev-ref', '@{u}']);
  if (up.code !== 0) return (cached = { ...base, supported: false, commit, subject, version, date, reason: 'Nhánh hiện tại không theo dõi nhánh nào trên GitHub.' });
  const fetched = await git(['fetch', '--quiet'], 30_000);
  if (fetched.code !== 0) return { ...base, supported: true, commit, subject, version, date, reason: `Không kết nối được GitHub: ${fetched.out.trim().slice(0, 200)}` };
  const log = await git(['log', '--format=%h%x09%s%x09%cr', 'HEAD..@{u}']);
  const commits = log.out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subj, date] = l.split('\t');
      return { hash, subject: subj, date };
    });
  return (cached = { ...base, supported: true, commit, subject, version, date, behind: commits.length, commits });
}

const REPO = 'ThinhTP204/claude-codex';

/** "0.10.2" > "0.9.0" */
function newer(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x) || 0);
  const pb = b.split('.').map((x) => parseInt(x) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/** Packaged app (.dmg / setup.exe): compare with the latest GitHub release. */
async function checkRelease(base: { behind: number; commits: UpdateCheck['commits']; checkedAt: number }): Promise<UpdateCheck> {
  let version = '0.0.0';
  try {
    version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    /* unknown */
  }
  const info = { ...base, supported: true, packaged: true, version };
  try {
    // AGENTDESK_RELEASES_API: point at another "latest release" JSON (used to test the updater)
    const r = await fetch(process.env.AGENTDESK_RELEASES_API || `https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { ...info, reason: r.status === 404 ? undefined : `GitHub trả lỗi ${r.status}` };
    const rel = (await r.json()) as { tag_name: string; name?: string; html_url: string; published_at?: string; body?: string; assets?: { name: string; browser_download_url: string }[] };
    const latest = rel.tag_name.replace(/^v/, '');
    if (!newer(latest, version)) return info;
    // release notes: one change per "- " line
    const notes = (rel.body || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[-*] /.test(l))
      .map((l, i) => ({ hash: String(i), subject: l.slice(2), date: '' }));
    return {
      ...info,
      behind: Math.max(1, notes.length),
      commits: notes.length ? notes : [{ hash: rel.tag_name, subject: rel.name || `Phiên bản ${latest}`, date: '' }],
      downloadUrl: rel.html_url,
      payloadUrl: rel.assets?.find((a) => /^AgentDesk-app(-[\d.]+)?\.tar\.gz$/.test(a.name))?.browser_download_url,
      latest,
      subject: `Có bản ${latest}`,
    };
  } catch (e) {
    return { ...info, reason: `Không kết nối được GitHub: ${(e as Error).message}` };
  }
}

let job: UpdateJob = { phase: 'idle', log: '' };

/**
 * Packaged app: download the app-code archive of the latest release into ~/.agentdesk/app/<version>/
 * and point "current" at it. The installed .app / .exe is never modified (signature and Gatekeeper
 * approval stay valid); bin/agentdesk.js picks the newer copy on the next start.
 */
async function applyPayload(relaunch: () => void): Promise<void> {
  const info = await checkUpdate(true);
  if (!info.payloadUrl || !info.latest) throw new Error('Bản mới chưa có gói cập nhật nhanh, hãy tải bộ cài đầy đủ.');
  job = { phase: 'download', log: '' };
  const log = (s: string) => (job.log = (job.log + s).slice(-20_000));
  const fail = (msg: string) => {
    job.phase = 'error';
    job.error = msg;
  };
  void (async () => {
    const base = path.join(DATA_DIR, 'app');
    const dest = path.join(base, info.latest!);
    const tmp = `${dest}.part`;
    const archive = path.join(base, `AgentDesk-app-${info.latest}.tar.gz`);
    fs.mkdirSync(base, { recursive: true });
    log(`Tải ${info.payloadUrl}\n`);
    const r = await fetch(info.payloadUrl!, { redirect: 'follow', signal: AbortSignal.timeout(120_000) }).catch((e) => e as Error);
    if (r instanceof Error || !r.ok) return fail(`Không tải được bản cập nhật: ${r instanceof Error ? r.message : `HTTP ${r.status}`}`);
    fs.writeFileSync(archive, Buffer.from(await r.arrayBuffer()));
    log(`Đã tải ${(fs.statSync(archive).size / 1e6).toFixed(1)} MB\n`);
    job.phase = 'extract';
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    // tar ships with macOS, Linux and Windows 10+
    const x = await sh('tar', ['-xzf', archive, '-C', tmp], log, 60_000);
    fs.rmSync(archive, { force: true });
    if (x.code !== 0 || !fs.existsSync(path.join(tmp, 'bin', 'agentdesk.js')) || !fs.existsSync(path.join(tmp, 'dist', 'index.html')))
      return fail('Gói cập nhật bị lỗi, app vẫn giữ bản cũ.');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    fs.writeFileSync(path.join(base, 'current'), info.latest!);
    // keep only the version just installed (the running one is still loaded in memory)
    for (const d of fs.readdirSync(base)) if (d !== info.latest && d !== 'current') fs.rmSync(path.join(base, d), { recursive: true, force: true });
    job.phase = 'restart';
    log(`Đã cài bản ${info.latest}. Đang khởi động lại…\n`);
    cached = undefined;
    setTimeout(relaunch, 400);
  })().catch((e) => fail(String((e as Error).message || e)));
}
export const updateStatus = () => job;

/**
 * pull → npm install (only when dependencies changed) → build into dist.next and swap it in
 * (a failed build leaves the running app untouched) → hand over to `relaunch`.
 */
export async function applyUpdate(relaunch: () => void): Promise<void> {
  if (job.phase !== 'idle' && job.phase !== 'error' && job.phase !== 'done') throw new Error('Đang cập nhật rồi.');
  if (!fs.existsSync(path.join(APP_ROOT, '.git'))) return applyPayload(relaunch);
  job = { phase: 'pull', log: '' };
  const log = (s: string) => {
    job.log = (job.log + s).slice(-20_000);
  };
  const fail = (msg: string) => {
    job.phase = 'error';
    job.error = msg;
  };
  void (async () => {
    const before = (await git(['rev-parse', 'HEAD'])).out.trim();
    log('$ git pull --ff-only\n');
    const pull = await sh('git', ['pull', '--ff-only'], log, 120_000);
    if (pull.code !== 0)
      return fail(
        /local changes|would be overwritten|diverged|not possible to fast-forward/i.test(pull.out)
          ? 'Máy này có sửa đổi riêng trong thư mục AgentDesk nên không pull được. Chạy `git status` trong thư mục đó để xem, hoặc `git stash` rồi thử lại.'
          : `git pull lỗi: ${pull.out.trim().slice(-300)}`,
      );
    const changed = (await git(['diff', '--name-only', before, 'HEAD'])).out;
    if (/^package(-lock)?\.json$/m.test(changed) || !fs.existsSync(path.join(APP_ROOT, 'node_modules'))) {
      job.phase = 'install';
      log('\n$ npm install\n');
      const inst = await sh('npm', ['install', '--no-audit', '--no-fund'], log);
      if (inst.code !== 0) return fail('npm install lỗi, xem log bên dưới.');
    }
    job.phase = 'build';
    const next = path.join(APP_ROOT, 'dist.next');
    log('\n$ vite build\n');
    const vite = path.join(APP_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const build = await sh(process.execPath, [vite, 'build', '--outDir', next, '--emptyOutDir'], log);
    if (build.code !== 0 || !fs.existsSync(path.join(next, 'index.html'))) return fail('Build giao diện lỗi, app vẫn chạy bản cũ. Xem log bên dưới.');
    const dist = path.join(APP_ROOT, 'dist');
    fs.rmSync(dist, { recursive: true, force: true });
    fs.renameSync(next, dist);
    job.phase = 'restart';
    log('\nĐang khởi động lại…\n');
    cached = undefined;
    setTimeout(relaunch, 400); // let the UI read the "restart" phase first
  })().catch((e) => fail(String((e as Error).message || e)));
}
