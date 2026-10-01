// "Chạy song song": the same task for 2–5 agents at once, each in its own git worktree, then the user
// compares the results and applies the one they like to the project (the others are thrown away).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Agent, Conversation, Fanout, FanoutAttempt, FanoutFile, RunConfig, Turn } from '../shared/types.ts';
import { run } from './catalog.ts';
import { DATA_DIR, uid } from './store.ts';
import { NEW_TITLE, buildContext, createConv, deleteConv, executeTurn, finalText, getConv, isRunning, publish, saveConv, stopConv } from './conversations.ts';
import { sessionEvent } from './notify.ts';

const WT_DIR = path.join(DATA_DIR, 'worktrees');
const AGENT_LABEL: Record<Agent, string> = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' };

async function git(dir: string, args: string[], timeout = 60_000): Promise<string> {
  const r = await run('git', ['-C', dir, ...args], timeout);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join('\n') || `git ${args[0]} lỗi`);
  return r.stdout;
}

export const runningFanout = (c: Conversation) => c.fanouts?.find((f) => f.status === 'running');

const fanoutOf = (c: Conversation, id: string) => {
  const f = c.fanouts?.find((x) => x.id === id);
  if (!f) throw new Error('Không tìm thấy lần chạy song song này.');
  return f;
};
const attemptOf = (f: Fanout, id: string) => {
  const a = f.attempts.find((x) => x.id === id);
  if (!a) throw new Error('Không tìm thấy bản này.');
  return a;
};
/** Top of the attempt's worktree (the agent works in `a.path`, which may be a sub-folder). */
const wtRoot = (f: Fanout, a: FanoutAttempt) => (f.prefix ? a.path.slice(0, a.path.length - f.prefix.length - 1) : a.path);

/** What a fresh worktree lacks but the agent needs to build and test: installed packages, local env files. */
function shareLocalFiles(project: string, cwd: string): void {
  const link = path.join(cwd, 'node_modules');
  const deps = path.join(project, 'node_modules');
  try {
    if (fs.existsSync(deps) && !fs.existsSync(link)) fs.symlinkSync(deps, link, 'junction');
  } catch {
    /* the agent can still install them */
  }
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const src = path.join(project, name);
    const dst = path.join(cwd, name);
    try {
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    } catch {
      /* optional */
    }
  }
}

const NOTE =
  '\n\n<agentdesk>Bạn đang làm trong một bản sao riêng của project (git worktree). Vài agent khác làm cùng việc này song song, người dùng sẽ so sánh rồi chọn một bản. Cứ sửa file trực tiếp; đừng commit, đừng đổi nhánh. Cuối cùng tóm tắt ngắn bạn đã làm gì.</agentdesk>';

export async function startFanout(c: Conversation, task: string, configs: RunConfig[]): Promise<Fanout> {
  if (configs.length < 2 || configs.length > 5) throw new Error('Chọn từ 2 đến 5 agent để chạy song song.');
  if (!task.trim()) throw new Error('Chưa nhập task.');
  if (isRunning(c.id) || c.run?.status === 'running' || runningFanout(c)) throw new Error('Đang có tác vụ chạy trong cuộc trò chuyện này.');

  const top = await run('git', ['-C', c.projectPath, 'rev-parse', '--show-toplevel', '--show-prefix'], 10_000);
  if (top.code !== 0) throw new Error('Project chưa dùng git. Chạy song song cần git để mỗi agent có một bản sao riêng (worktree).');
  const [repoOut, prefixOut = ''] = top.stdout.split('\n');
  const repo = path.resolve(repoOut.trim());
  const prefix = prefixOut.trim().replace(/\/$/, '');
  const head = await run('git', ['-C', repo, 'rev-parse', '--verify', 'HEAD'], 10_000);
  if (head.code !== 0) throw new Error('Repo chưa có commit nào. Commit một lần rồi chạy song song.');
  // uncommitted changes to tracked files travel along (a snapshot commit, the project is untouched)
  const snap = (await run('git', ['-C', repo, 'stash', 'create', 'AgentDesk: điểm xuất phát chạy song song'], 30_000)).stdout.trim();
  const base = snap || head.stdout.trim();
  const baseBranch = (await run('git', ['-C', repo, 'branch', '--show-current'], 10_000)).stdout.trim() || undefined;

  const id = uid('f_');
  const f: Fanout = { id, turnId: '', task, base, baseBranch, repo, prefix, startedAt: Date.now(), status: 'running', attempts: [] };
  try {
    for (const [i, cfg] of configs.entries()) {
      const n = i + 1;
      const wt = path.join(WT_DIR, `${id}-${n}`);
      const branch = `agentdesk/${id.slice(2)}-${n}-${cfg.agent}`;
      await git(repo, ['worktree', 'add', '--quiet', '-b', branch, wt, base], 180_000);
      const cwd = prefix ? path.join(wt, prefix) : wt;
      shareLocalFiles(c.projectPath, cwd);
      const child = createConv(cwd);
      child.parentId = c.id;
      child.title = `${task.replace(/\s+/g, ' ').slice(0, 60)} · ${AGENT_LABEL[cfg.agent]}`;
      saveConv(child, true);
      f.attempts.push({ id: `${id}-${n}`, config: cfg, convId: child.id, path: cwd, branch, status: 'running', startedAt: Date.now() });
    }
  } catch (e) {
    await cleanup(f);
    throw new Error(`Không tạo được worktree: ${(e as Error).message}`);
  }

  // the parent's earlier messages are context for every attempt
  const context = buildContext({ ...c, seen: {} }, configs[0].agent, c.turns.length);
  const user: Turn = { id: uid('t_'), role: 'user', createdAt: Date.now(), text: task, blocks: [], status: 'done' };
  c.turns.push(user);
  f.turnId = user.id;
  if (c.title === NEW_TITLE) c.title = task.split('\n\n📎 ')[0].replace(/\s+/g, ' ').slice(0, 80) || NEW_TITLE;
  (c.fanouts ??= []).push(f);
  saveConv(c, true);
  publish(c);
  for (const a of f.attempts) void runAttempt(c, f, a, context + task + NOTE);
  return f;
}

async function runAttempt(c: Conversation, f: Fanout, a: FanoutAttempt, prompt: string): Promise<void> {
  const child = getConv(a.convId);
  try {
    if (!child) throw new Error('Mất cuộc trò chuyện của bản này.');
    const { turn, result } = await executeTurn(child, { prompt, display: f.task, config: a.config });
    a.status = result.stopped ? 'stopped' : result.ok ? 'done' : 'error';
    a.error = result.ok ? undefined : result.error;
    a.answer = finalText(turn) || result.finalText;
    a.usage = result.usage;
    a.durationMs = result.durationMs;
  } catch (e) {
    a.status = 'error';
    a.error = (e as Error).message;
  }
  try {
    const files = await changedFiles(f, a);
    a.stat = { files: files.length, additions: files.reduce((n, x) => n + x.additions, 0), deletions: files.reduce((n, x) => n + x.deletions, 0) };
  } catch {
    /* worktree gone (discarded meanwhile) */
  }
  if (f.status === 'running' && f.attempts.every((x) => x.status !== 'running')) {
    f.status = 'ready';
    const ok = f.attempts.filter((x) => x.status === 'done').length;
    sessionEvent(c, 'awaiting', `${ok}/${f.attempts.length} agent đã làm xong. Mở để so sánh và chọn một bản.`);
  }
  saveConv(c, true);
  publish(c);
}

/** Everything the attempt changed (new files included), compared with the starting point. */
export async function changedFiles(f: Fanout, a: FanoutAttempt): Promise<FanoutFile[]> {
  const root = wtRoot(f, a);
  await git(root, ['add', '-A', '--', '.', ':(exclude,glob)**/node_modules', ':(exclude,glob)**/.env*']);
  const nums = await git(root, ['diff', '--cached', '--numstat', '-M', '-z', f.base]);
  const names = await git(root, ['diff', '--cached', '--name-status', '-M', '-z', f.base]);
  const status = new Map<string, string>();
  const n = names.split('\0');
  for (let i = 0; i < n.length - 1; ) {
    const code = n[i];
    if (code.startsWith('R') || code.startsWith('C')) {
      status.set(n[i + 2], 'R');
      i += 3;
    } else {
      status.set(n[i + 1], code[0]);
      i += 2;
    }
  }
  const out: FanoutFile[] = [];
  const parts = nums.split('\0');
  for (let i = 0; i < parts.length - 1; ) {
    const [add, del, file] = parts[i].split('\t');
    let p = file;
    i++;
    if (!p) {
      // rename: "add\tdel\t" then old path, new path
      p = parts[i + 1];
      i += 2;
    }
    out.push({ path: p, status: status.get(p) ?? 'M', additions: Number(add) || 0, deletions: Number(del) || 0 });
  }
  return out;
}

export async function fileVersions(f: Fanout, a: FanoutAttempt, file: string): Promise<{ before: string; after: string }> {
  if (file.split(/[\\/]/).includes('..')) throw new Error('Đường dẫn không hợp lệ');
  const before = await run('git', ['-C', f.repo, 'show', `${f.base}:${file}`], 15_000);
  let after = '';
  try {
    after = fs.readFileSync(path.join(wtRoot(f, a), file), 'utf8');
  } catch {
    /* deleted */
  }
  return { before: before.code === 0 ? before.stdout : '', after };
}

/** Apply the chosen attempt's changes to the project (as uncommitted changes) and drop every worktree. */
export async function chooseAttempt(c: Conversation, fid: string, aid: string): Promise<void> {
  const f = fanoutOf(c, fid);
  if (f.status !== 'ready') throw new Error(f.status === 'running' ? 'Các agent chưa chạy xong. Đợi xong hoặc bấm dừng.' : 'Lần chạy này đã kết thúc.');
  const a = attemptOf(f, aid);
  const root = wtRoot(f, a);
  await changedFiles(f, a); // stages everything
  const patch = await git(root, ['diff', '--cached', '--binary', '-M', f.base]);
  if (!patch.trim()) throw new Error('Bản này không thay đổi file nào.');
  const tmp = path.join(os.tmpdir(), `agentdesk-${a.id}.patch`);
  fs.writeFileSync(tmp, patch);
  try {
    // straight onto the working tree; if the project moved on since, let git merge (conflict markers)
    let r = await run('git', ['-C', f.repo, 'apply', '--whitespace=nowarn', tmp], 60_000);
    if (r.code !== 0) r = await run('git', ['-C', f.repo, 'apply', '--3way', '--whitespace=nowarn', tmp], 60_000);
    if (r.code !== 0) throw new Error(`Không áp dụng được thay đổi vào project:\n${(r.stderr || r.stdout).trim().split('\n').slice(0, 5).join('\n')}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  // the chosen agent's answer joins the conversation, so the chat can go on from there
  const child = getConv(a.convId);
  const label = `${AGENT_LABEL[a.config.agent]}${a.config.model ? ` · ${a.config.model}` : ''}`;
  for (const t of child?.turns.filter((x) => x.role === 'assistant') ?? []) c.turns.push({ ...t, id: uid('t_'), roleName: `Bản được chọn (${label})` });
  f.chosen = a.id;
  f.status = 'merged';
  await cleanup(f);
  saveConv(c, true);
  publish(c);
}

export async function discardFanout(c: Conversation, fid: string): Promise<void> {
  const f = fanoutOf(c, fid);
  f.status = 'discarded';
  await cleanup(f);
  saveConv(c, true);
  publish(c);
}

export function stopFanout(c: Conversation, fid?: string): void {
  const f = fid ? fanoutOf(c, fid) : runningFanout(c);
  for (const a of f?.attempts ?? []) if (a.status === 'running') stopConv(a.convId);
}

async function cleanup(f: Fanout): Promise<void> {
  for (const a of f.attempts) {
    stopConv(a.convId);
    // let the stopped turn finish saving before its conversation is deleted
    for (let i = 0; i < 50 && isRunning(a.convId); i++) await new Promise((r) => setTimeout(r, 100));
    const root = wtRoot(f, a);
    await run('git', ['-C', f.repo, 'worktree', 'remove', '--force', root], 60_000);
    await run('git', ['-C', f.repo, 'branch', '-D', a.branch], 15_000);
    fs.rmSync(root, { recursive: true, force: true });
    deleteConv(a.convId);
  }
  await run('git', ['-C', f.repo, 'worktree', 'prune'], 15_000);
}
