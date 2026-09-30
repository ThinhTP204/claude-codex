import { execFile } from 'node:child_process';
import type { GitBranch, GitCommit, GitInfo } from '../shared/types.ts';

// Source Control: everything goes through the git CLI in the project folder.

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

function git(root: string, args: string[], timeoutMs = 20_000): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd: root,
        timeout: timeoutMs,
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true,
        // never hang waiting for a username/password prompt nobody can answer
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' },
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? Number((err as { code?: unknown }).code) : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && !stderr ? err.message : '') });
      },
    );
  });
}

class GitError extends Error {}

async function must(root: string, args: string[], timeoutMs?: number): Promise<string> {
  const r = await git(root, args, timeoutMs);
  // some failures ("nothing to commit") are printed on stdout, not stderr
  if (r.code !== 0) throw new GitError(friendly([r.stdout, r.stderr].filter((x) => x.trim()).join('\n') || `git ${args[0]} thất bại`));
  return r.stdout;
}

/** Turn the usual git failures into something actionable. */
function friendly(msg: string): string {
  const m = msg.trim();
  if (/could not read Username|Authentication failed|terminal prompts disabled/i.test(m))
    return 'Git chưa có quyền truy cập remote. Hãy đăng nhập một lần trong Terminal (vd: `git push`, hoặc `gh auth login`) rồi thử lại.';
  if (/rejected.*\(fetch first\)|non-fast-forward|Updates were rejected/i.test(m)) return 'Remote có commit mới mà máy chưa có. Hãy Pull trước rồi Push lại.';
  if (/Please commit your changes or stash them|would be overwritten by checkout/i.test(m))
    return 'Đang có thay đổi chưa commit bị đụng khi đổi nhánh. Commit hoặc stash trước rồi đổi nhánh.';
  if (/nothing to commit/i.test(m)) return 'Không có gì để commit.';
  if (/Please tell me who you are/i.test(m))
    return 'Git chưa biết tên/email của anh. Chạy trong Terminal: git config --global user.name "Tên" và git config --global user.email "email".';
  if (/not a git repository/i.test(m)) return 'Thư mục này chưa phải git repo.';
  if (/No configured push destination|no upstream|does not appear to be a git repository/i.test(m)) return 'Repo chưa có remote (origin). Thêm remote bằng: git remote add origin <url>.';
  return m
    .split('\n')
    .filter((l) => !/^Command failed:/.test(l))
    .slice(-6)
    .join('\n');
}

const CODE: Record<string, string> = { M: 'M', T: 'M', A: 'A', D: 'D', R: 'R', C: 'A', U: 'U' };

export async function gitInfo(root: string): Promise<GitInfo> {
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree', '--show-prefix']);
  if (inside.code !== 0) return { isRepo: false, files: [], ahead: 0, behind: 0, remotes: [] };
  const prefix = inside.stdout.split('\n')[1]?.trim() || '';

  const [st, remotes, last] = await Promise.all([
    git(root, ['status', '--porcelain=v2', '--branch', '-z', '-uall', '--', '.']),
    git(root, ['remote']),
    git(root, ['log', '-1', '--format=%h%x00%s']),
  ]);

  const info: GitInfo = { isRepo: true, files: [], ahead: 0, behind: 0, remotes: remotes.stdout.split('\n').filter(Boolean) };
  const parts = st.stdout.split('\0');
  const rel = (p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : p);

  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      const head = line.slice(14);
      if (head === '(detached)') info.detached = true;
      else info.branch = head;
    } else if (line.startsWith('# branch.upstream ')) info.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        info.ahead = Number(m[1]);
        info.behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // 1 XY sub mH mI mW hH hI path   |   2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const f = line.split(' ');
      const xy = f[1];
      const path = rel(f.slice(line.startsWith('1 ') ? 8 : 9).join(' '));
      let orig: string | undefined;
      if (line.startsWith('2 ')) orig = rel(parts[++i]);
      info.files.push({ path, orig, index: xy[0] === '.' ? undefined : CODE[xy[0]] || xy[0], work: xy[1] === '.' ? undefined : CODE[xy[1]] || xy[1] });
    } else if (line.startsWith('u ')) {
      const f = line.split(' ');
      info.files.push({ path: rel(f.slice(10).join(' ')), conflict: true, work: 'U' });
    } else if (line.startsWith('? ')) {
      info.files.push({ path: rel(line.slice(2)), untracked: true, work: 'U' });
    }
  }
  if (last.code === 0 && last.stdout.trim()) {
    const [hash, subject] = last.stdout.trim().split('\0');
    info.lastCommit = { hash, subject };
  }
  return info;
}

export async function gitBranches(root: string): Promise<{ local: GitBranch[]; remote: GitBranch[] }> {
  const out = await must(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(committerdate:relative)', 'refs/heads', 'refs/remotes']);
  const local: GitBranch[] = [];
  const remote: GitBranch[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [ref, name, upstream, track, head, date] = line.split('\0');
    if (ref.endsWith('/HEAD')) continue;
    const b: GitBranch = { name, upstream: upstream || undefined, current: head === '*', gone: /gone/.test(track), date };
    const a = /ahead (\d+)/.exec(track);
    const be = /behind (\d+)/.exec(track);
    if (a) b.ahead = Number(a[1]);
    if (be) b.behind = Number(be[1]);
    (ref.startsWith('refs/heads/') ? local : remote).push(b);
  }
  return { local, remote };
}

export async function gitCheckout(root: string, opts: { branch: string; create?: boolean; from?: string }): Promise<void> {
  const name = opts.branch.trim();
  if (!name) throw new GitError('Thiếu tên nhánh');
  if (opts.create) {
    await must(root, ['check-ref-format', '--branch', name]).catch(() => {
      throw new GitError(`Tên nhánh "${name}" không hợp lệ (không dùng khoảng trắng, ~ ^ : ? * [ \\).`);
    });
    await must(root, ['switch', '-c', name, ...(opts.from ? [opts.from] : [])]);
    return;
  }
  // "origin/feature" → create a local tracking branch "feature"
  const remotes = (await git(root, ['remote'])).stdout.split('\n').filter(Boolean);
  const r = remotes.find((x) => name.startsWith(`${x}/`));
  if (r) {
    const localName = name.slice(r.length + 1);
    const exists = (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${localName}`])).code === 0;
    await must(root, exists ? ['switch', localName] : ['switch', '--track', '-c', localName, name]);
    return;
  }
  await must(root, ['switch', name]);
}

export const gitStage = (root: string, paths: string[]) => must(root, ['add', '-A', '--', ...(paths.length ? paths : ['.'])]);

export async function gitUnstage(root: string, paths: string[]): Promise<void> {
  const hasHead = (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0;
  // before the first commit there is no HEAD to restore from
  await must(root, hasHead ? ['restore', '--staged', '--', ...(paths.length ? paths : ['.'])] : ['rm', '-r', '--cached', '--quiet', '--', ...(paths.length ? paths : ['.'])]);
}

/** Throw away working-tree changes (tracked files back to the index, untracked files deleted). */
export async function gitDiscard(root: string, paths: string[]): Promise<void> {
  if (!paths.length) throw new GitError('Chưa chọn file');
  const info = await gitInfo(root);
  const untracked = paths.filter((p) => info.files.find((f) => f.path === p)?.untracked);
  const tracked = paths.filter((p) => !untracked.includes(p));
  if (tracked.length) await must(root, ['restore', '--worktree', '--', ...tracked]);
  if (untracked.length) await must(root, ['clean', '-f', '-q', '--', ...untracked]);
}

export async function gitCommit(root: string, opts: { message: string; amend?: boolean; all?: boolean }): Promise<string> {
  const msg = opts.message.trim();
  if (!msg && !opts.amend) throw new GitError('Chưa nhập commit message');
  if (opts.all) await must(root, ['add', '-A', '--', '.']);
  const args = ['commit', ...(opts.amend ? ['--amend'] : []), ...(msg ? ['-m', msg] : ['--no-edit'])];
  const out = await must(root, args, 60_000);
  return out.split('\n')[0];
}

export async function gitPush(root: string): Promise<string> {
  const info = await gitInfo(root);
  if (!info.branch) throw new GitError('Đang ở trạng thái detached HEAD, hãy đổi sang một nhánh trước khi push.');
  if (!info.remotes.length) throw new GitError('Repo chưa có remote (origin). Thêm remote bằng: git remote add origin <url>.');
  const remote = info.remotes.includes('origin') ? 'origin' : info.remotes[0];
  // first push of a new branch: publish it and remember the upstream
  const args = info.upstream ? ['push'] : ['push', '-u', remote, info.branch];
  const r = await git(root, args, 180_000);
  if (r.code !== 0) throw new GitError(friendly(r.stderr));
  return (r.stderr || r.stdout).trim().split('\n').slice(-2).join('\n');
}

export async function gitPull(root: string): Promise<string> {
  const r = await git(root, ['pull', '--no-edit'], 180_000);
  if (r.code !== 0) throw new GitError(friendly(r.stderr || r.stdout));
  return r.stdout.trim().split('\n').slice(-2).join('\n');
}

export const gitFetch = (root: string) => must(root, ['fetch', '--all', '--prune'], 180_000);

export async function gitLog(root: string, limit = 30): Promise<GitCommit[]> {
  const r = await git(root, ['log', `-${limit}`, '--format=%h%x00%s%x00%an%x00%ar%x00%D']);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subject, author, date, refs] = l.split('\0');
      return { hash, subject, author, date, refs: refs ? refs.split(', ').filter(Boolean) : [] };
    });
}

export const gitInit = (root: string) => must(root, ['init', '-b', 'main']);

/** Staged + unstaged diff text, used to draft a commit message. */
export async function gitDiffForMessage(root: string): Promise<string> {
  const staged = await git(root, ['diff', '--cached', '--stat', '--patch', '--no-color', '--', '.']);
  const text = staged.stdout.trim() ? staged.stdout : (await git(root, ['diff', '--stat', '--patch', '--no-color', '--', '.'])).stdout;
  return text.length > 40_000 ? text.slice(0, 40_000) + '\n…(đã cắt bớt)' : text;
}

export { GitError };
