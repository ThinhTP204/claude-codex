// What a session is doing, for the sidebar: status, git branch, and one "lane" per agent at work
// (the chat's running turn or each pipeline step) with its current activity.
import fs from 'node:fs';
import path from 'node:path';
import type { Agent, Block, Conversation, ConversationSummary, SessionLane, SessionStatus, Turn } from '../shared/types.ts';
import { getRoles } from './roles.ts';

/** Branch checked out in `dir` (read from .git/HEAD, no git process: called on every turn). */
export function headBranch(dir: string): string | undefined {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const dotgit = path.join(d, '.git');
    let gitDir: string | undefined;
    try {
      const st = fs.statSync(dotgit);
      if (st.isDirectory()) gitDir = dotgit;
      else {
        // worktrees and submodules: ".git" is a file pointing at the real git dir
        const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, 'utf8'));
        if (m) gitDir = path.resolve(d, m[1].trim());
      }
    } catch {
      /* not here */
    }
    if (gitDir) {
      try {
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        return ref ? ref[1] : head.slice(0, 7);
      } catch {
        return;
      }
    }
    if (path.dirname(d) === d) return;
  }
}

const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const short = (s: string, n = 48) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};

/** "Đang sửa Sidebar.tsx", "Đang chạy npm test"… from a tool block. */
export function toolActivity(b: Extract<Block, { type: 'tool' }>): string {
  const name = b.name;
  const arg = b.input || '';
  if (/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch|edit|write|replace)$/i.test(name)) {
    // Codex patches list several files on separate lines
    const files = arg.split('\n').filter(Boolean);
    return files.length > 1 ? `Đang sửa ${files.length} file` : `Đang sửa ${base(files[0] || 'file')}`;
  }
  if (/^(Read|read_file|view)$/i.test(name)) return `Đang đọc ${base(arg)}`;
  if (/^(Bash|shell|exec|run_shell_command|command)$/i.test(name)) return `Đang chạy ${short(arg, 40)}`;
  if (/^(Grep|Glob|search|grep|find|list_files|LS)$/i.test(name)) return arg ? `Đang tìm ${short(arg, 32)}` : 'Đang tìm trong code';
  if (/^WebSearch$/i.test(name)) return arg ? `Đang tra web: ${short(arg, 32)}` : 'Đang tra web';
  if (/^WebFetch$/i.test(name)) return `Đang đọc ${arg.replace(/^https?:\/\/([^/]+).*$/, '$1')}`;
  if (/^(Task|Agent)$/i.test(name)) return arg ? `Giao cho agent phụ: ${short(arg, 32)}` : 'Giao việc cho agent phụ';
  if (/^(Todo|TodoWrite)$/i.test(name)) return 'Đang lên danh sách việc';
  if (/^Skill$/i.test(name)) return `Đang dùng skill ${short(arg, 32)}`;
  if (name.includes('.') || name.startsWith('mcp__')) return `Đang dùng ${name.replace(/^mcp__/, '').split(/__|\./)[0]}`;
  return name ? `Đang dùng ${name}` : 'Đang làm việc';
}

export function turnActivity(t: Turn): string {
  for (let i = t.blocks.length - 1; i >= 0; i--) {
    const b = t.blocks[i];
    if (b.type === 'tool') return b.status === 'running' ? toolActivity(b) : 'Đang xem kết quả';
    if (b.type === 'thinking') return 'Đang suy nghĩ';
    if (b.type === 'text') return 'Đang trả lời';
  }
  return 'Đang khởi động';
}

export function sessionStatus(c: Conversation, running: boolean): SessionStatus | undefined {
  const fan = c.fanouts?.at(-1);
  if (running || c.run?.status === 'running' || fan?.status === 'running') return 'running';
  // parallel agents done: the user has to pick one
  if (fan?.status === 'ready') return 'awaiting';
  if (c.run?.status === 'awaiting') return 'awaiting';
  const last = c.turns.findLast((t) => t.role === 'assistant');
  // the last thing that ran was the pipeline: its outcome is the session's
  if (c.run && (!last || last.nodeId)) return c.run.status as SessionStatus;
  if (!last) return;
  if (last.status === 'error') return 'error';
  if (last.status === 'stopped') return 'stopped';
  return 'done';
}

/** Start of a turn's last text, as one plain line. */
function excerpt(t: Turn | undefined, n = 140): string | undefined {
  const b = t?.blocks.findLast((x) => x.type === 'text') as { text: string } | undefined;
  if (!b) return;
  const plain = b.text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>|]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain ? (plain.length > n ? plain.slice(0, n - 1) + '…' : plain) : undefined;
}

const ended = (t: Turn | undefined) => (t && t.status !== 'running' ? t.createdAt + (t.durationMs ?? 0) : undefined);

export function sessionLanes(c: Conversation, resolve: (id: string) => Conversation | undefined = () => undefined): SessionLane[] {
  const fan = c.fanouts?.at(-1);
  if (fan && (fan.status === 'running' || fan.status === 'ready')) {
    return fan.attempts.map((a) => {
      const turn = a.status === 'running' ? resolve(a.convId)?.turns.findLast((t) => t.role === 'assistant' && t.status === 'running') : undefined;
      const stat = a.stat ? `${a.stat.files} file · +${a.stat.additions} −${a.stat.deletions}` : undefined;
      return {
        id: a.id,
        kind: 'agent' as const,
        agent: a.config.agent,
        model: a.config.model,
        status: a.status,
        activity: turn ? turnActivity(turn) : undefined,
        text: a.status === 'running' ? undefined : [stat, a.error || a.answer?.replace(/\s+/g, ' ').slice(0, 120)].filter(Boolean).join(' · '),
        startedAt: a.status === 'running' ? a.startedAt : undefined,
        durationMs: a.durationMs,
        endedAt: a.durationMs ? a.startedAt + a.durationMs : undefined,
      };
    });
  }
  const run = c.run;
  const lastByNode = new Map<string, Turn>();
  for (const t of c.turns) if (t.role === 'assistant' && t.nodeId) lastByNode.set(t.nodeId, t);
  if (run && (run.status === 'running' || run.status === 'awaiting' || c.turns.findLast((t) => t.role === 'assistant')?.nodeId)) {
    return run.pipeline.nodes
      .filter((n) => n.type === 'agent')
      .map((n) => {
        const st = run.nodes[n.id];
        const turn = lastByNode.get(n.id);
        const status = st?.status ?? 'idle';
        return {
          id: n.id,
          kind: 'step' as const,
          agent: (turn?.agent ?? n.data.config?.agent ?? 'claude') as Agent,
          model: turn?.model ?? n.data.config?.model,
          label: n.data.label,
          status,
          activity: status === 'running' && turn?.status === 'running' ? turnActivity(turn) : status === 'awaiting' ? 'Chờ bạn duyệt' : undefined,
          text: status === 'running' ? undefined : st?.error || excerpt(turn),
          startedAt: status === 'running' ? turn?.createdAt : undefined,
          durationMs: status === 'running' ? undefined : st?.durationMs,
          endedAt: status === 'running' ? undefined : ended(turn),
        };
      });
  }
  // a chat: the latest answer of each agent/model that took part, newest first
  const seen = new Set<string>();
  const lanes: SessionLane[] = [];
  for (let i = c.turns.length - 1; i >= 0 && lanes.length < 4; i--) {
    const t = c.turns[i];
    if (t.role !== 'assistant' || t.nodeId) continue;
    const key = `${t.agent}:${t.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const running = t.status === 'running';
    const err = t.blocks.findLast((b) => b.type === 'error') as { text: string } | undefined;
    lanes.push({
      id: t.id,
      kind: 'agent',
      agent: t.agent ?? 'claude',
      model: t.model,
      status: t.status,
      activity: running ? turnActivity(t) : undefined,
      text: running ? undefined : t.status === 'error' ? err?.text.replace(/\s+/g, ' ').slice(0, 140) || excerpt(t) : excerpt(t),
      startedAt: running ? t.createdAt : undefined,
      durationMs: t.durationMs,
      endedAt: ended(t),
    });
  }
  return lanes;
}

/** The kind of work a session is doing: pipeline step (n of m), parallel run, or the chat's role. */
export function sessionStage(c: Conversation): ConversationSummary['stage'] {
  const fan = c.fanouts?.at(-1);
  if (fan && (fan.status === 'running' || fan.status === 'ready')) return { name: 'Chạy song song', icon: '⑂' };
  const last = c.turns.findLast((t) => t.role === 'assistant');
  const run = c.run;
  if (run && (run.status === 'running' || run.status === 'awaiting' || last?.nodeId)) {
    const steps = run.pipeline.nodes.filter((n) => n.type === 'agent');
    const id = run.current ?? last?.nodeId;
    const i = steps.findIndex((n) => n.id === id);
    const node = steps[i] ?? steps.at(-1);
    if (!node) return;
    const role = getRoles().find((r) => r.id === node.data.roleId);
    return { name: node.data.label, icon: role?.icon, step: i >= 0 ? i + 1 : steps.length, steps: steps.length };
  }
  if (last?.roleName) return { name: last.roleName, icon: last.roleIcon };
}
