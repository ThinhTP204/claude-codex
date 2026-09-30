// Self-update for installs made with `git clone`: fetch, pull, npm install, build, restart.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isWin } from './platform.ts';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface UpdateCheck {
  supported: boolean;
  reason?: string;
  commit?: string;
  subject?: string;
  behind: number;
  commits: { hash: string; subject: string; date: string }[];
  checkedAt: number;
}

export interface UpdateJob {
  phase: 'idle' | 'pull' | 'install' | 'build' | 'restart' | 'done' | 'error';
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
  if (!fs.existsSync(path.join(APP_ROOT, '.git'))) return (cached = { ...base, supported: false, reason: 'Bản này không cài bằng git clone nên không tự cập nhật được.' });
  const head = await git(['log', '-1', '--format=%h%x09%s']);
  const [commit, subject] = head.out.trim().split('\t');
  const up = await git(['rev-parse', '--abbrev-ref', '@{u}']);
  if (up.code !== 0) return (cached = { ...base, supported: false, commit, subject, reason: 'Nhánh hiện tại không theo dõi nhánh nào trên GitHub.' });
  const fetched = await git(['fetch', '--quiet'], 30_000);
  if (fetched.code !== 0) return { ...base, supported: true, commit, subject, reason: `Không kết nối được GitHub: ${fetched.out.trim().slice(0, 200)}` };
  const log = await git(['log', '--format=%h%x09%s%x09%cr', 'HEAD..@{u}']);
  const commits = log.out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subj, date] = l.split('\t');
      return { hash, subject: subj, date };
    });
  return (cached = { ...base, supported: true, commit, subject, behind: commits.length, commits });
}

let job: UpdateJob = { phase: 'idle', log: '' };
export const updateStatus = () => job;

/**
 * pull → npm install (only when dependencies changed) → build into dist.next and swap it in
 * (a failed build leaves the running app untouched) → hand over to `relaunch`.
 */
export async function applyUpdate(relaunch: () => void): Promise<void> {
  if (job.phase !== 'idle' && job.phase !== 'error' && job.phase !== 'done') throw new Error('Đang cập nhật rồi.');
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
