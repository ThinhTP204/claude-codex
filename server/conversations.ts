import fs from 'node:fs';
import path from 'node:path';
import type { Agent, Block, Conversation, ConversationSummary, RunConfig, ServerMessage, Turn } from '../shared/types.ts';
import { CONV_DIR, dataFile, readJson, uid, writeJson } from './store.ts';
import { startRun, type RunHandle, type RunResult } from './runner.ts';
import { listNativeSessions, nativeTurns } from './sessions.ts';
import { headBranch, sessionLanes, sessionStatus } from './activity.ts';
import { sessionEvent } from './notify.ts';

export const NEW_TITLE = 'Cuộc trò chuyện mới';
const AGENT_LABEL: Record<Agent, string> = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' };

let broadcast: (msg: ServerMessage) => void = () => {};
export const setBroadcast = (fn: typeof broadcast) => (broadcast = fn);

const active = new Map<string, RunHandle>();
const saveTimers = new Map<string, NodeJS.Timeout>();

const fileOf = (id: string) => path.join(CONV_DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

// Memory: every conversation has a small index entry (what the sidebar needs); full
// conversations (all turns, tool output…) are read from disk on demand and kept in a
// small LRU cache. Conversations that are running are never evicted.

interface IndexEntry extends Omit<ConversationSummary, 'running'> {
  projectPath: string;
  /** native CLI session ids, to hide those sessions from the native list */
  sessionIds: string[];
  /** has turns or a pipeline run (empty drafts are hidden) */
  hasContent: boolean;
}

const index = new Map<string, IndexEntry>();
const cache = new Map<string, Conversation>(); // Map keeps insertion order → LRU
const MAX_CACHED = 12;

function entryOf(c: Conversation): IndexEntry {
  const { running: _r, ...s } = summary(c);
  return { ...s, projectPath: c.projectPath, sessionIds: Object.values(c.sessions).filter((x): x is string => !!x), hasContent: c.turns.length > 0 || !!c.run };
}

const pinned = (c: Conversation) => active.has(c.id) || c.run?.status === 'running' || !!c.fanouts?.some((f) => f.status === 'running');

function writeNow(c: Conversation) {
  clearTimeout(saveTimers.get(c.id));
  saveTimers.delete(c.id);
  writeJson(fileOf(c.id), c);
}

/** Mark as recently used and drop the least recently used idle conversations. */
function touch(c: Conversation): Conversation {
  cache.delete(c.id);
  cache.set(c.id, c);
  for (const [id, old] of cache) {
    if (cache.size <= MAX_CACHED) break;
    if (pinned(old)) continue;
    if (saveTimers.has(id)) writeNow(old); // never lose a pending write
    cache.delete(id);
  }
  return c;
}

/** Full conversation from the cache, or from disk. */
function loadConv(id: string): Conversation | undefined {
  const hit = cache.get(id);
  if (hit) return touch(hit);
  if (!index.has(id)) return;
  const c = readJson<Conversation | null>(fileOf(id), null);
  return c?.id ? touch(c) : undefined;
}

// Startup: build the index (and repair runs cut off by a quit) without keeping turns in memory.
for (const f of fs.readdirSync(CONV_DIR)) {
  if (!f.endsWith('.json')) continue;
  const c = readJson<Conversation | null>(path.join(CONV_DIR, f), null);
  if (!c?.id) continue;
  let dirty = false;
  for (const t of c.turns) {
    if (t.status === 'running') {
      t.status = 'stopped';
      dirty = true;
    }
  }
  if (c.run && c.run.status === 'running') {
    c.run.status = 'error';
    const cur = c.run.current && c.run.nodes[c.run.current];
    if (cur) {
      cur.status = 'error';
      cur.error = 'Bị gián đoạn do app tắt. Bấm "Chạy lại" để tiếp tục.';
    }
    dirty = true;
  }
  for (const f of c.fanouts ?? []) {
    if (f.status !== 'running') continue;
    for (const a of f.attempts) if (a.status === 'running') a.status = 'stopped';
    f.status = 'ready';
    dirty = true;
  }
  if (dirty) writeJson(fileOf(c.id), c);
  index.set(c.id, entryOf(c));
}

export function saveConv(c: Conversation, immediate = false): void {
  c.updatedAt = Date.now();
  index.set(c.id, entryOf(c));
  if (!cache.has(c.id)) touch(c);
  if (immediate) {
    writeNow(c);
    return;
  }
  clearTimeout(saveTimers.get(c.id));
  saveTimers.set(
    c.id,
    setTimeout(() => {
      saveTimers.delete(c.id);
      writeJson(fileOf(c.id), c);
    }, 400),
  );
}

export function publish(c: Conversation): void {
  broadcast({ type: 'conv', conv: c });
  broadcast({ type: 'list', projectPath: c.projectPath });
}

export function summary(c: Conversation): ConversationSummary {
  const agents = new Set<Agent>();
  const models = new Set<string>();
  for (const t of c.turns) {
    if (t.agent) agents.add(t.agent);
    if (t.model) models.add(t.model);
  }
  const lanes = sessionLanes(c, (id) => cache.get(id) ?? (index.has(id) ? loadConv(id) : undefined));
  return {
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    agents: [...agents],
    models: [...models],
    source: c.source,
    running: active.has(c.id),
    runStatus: c.run?.status,
    status: sessionStatus(c, active.has(c.id)),
    branch: c.branch,
    lanes: lanes.length ? lanes : undefined,
    autoAt: c.auto?.enabled ? c.auto.pending?.at : undefined,
  };
}

// The sidebar follows what running agents do: one row update at most every 700 ms per session.
const rowTimers = new Map<string, NodeJS.Timeout>();
function publishRow(c: Conversation): void {
  // an agent of a parallel run: its parent's row shows it
  if (c.parentId) {
    const parent = loadConv(c.parentId);
    if (parent) publishRow(parent);
    return;
  }
  if (rowTimers.has(c.id)) return;
  rowTimers.set(
    c.id,
    setTimeout(() => {
      rowTimers.delete(c.id);
      broadcast({ type: 'summary', projectPath: c.projectPath, summary: summary(c) });
    }, 700),
  );
}

export function listConvs(projectPath: string): ConversationSummary[] {
  const mine = [...index.values()].filter((e) => e.projectPath === projectPath && e.hasContent);
  const known = new Set(mine.flatMap((e) => e.sessionIds));
  const native = listNativeSessions(projectPath).filter((s) => !known.has(s.sessionId) && !hidden.has(s.sessionId));
  return [
    ...mine.map(({ projectPath: _p, sessionIds: _s, hasContent: _h, ...e }) => ({ ...e, running: active.has(e.id), status: active.has(e.id) ? 'running' : e.status }) as ConversationSummary),
    ...native.map(({ file: _f, sessionId: _s, ...rest }) => rest),
  ].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createConv(projectPath: string): Conversation {
  const c: Conversation = {
    id: uid('c_'),
    projectPath,
    title: NEW_TITLE,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessions: {},
    seen: {},
    turns: [],
    source: 'app',
  };
  saveConv(c, true);
  return c;
}

/** Open a conversation; ids like `claude:<session>` / `codex:<session>` import a native CLI session. */
export function getConv(id: string, projectPath?: string): Conversation | undefined {
  const hit = loadConv(id);
  // An imported session nobody has continued in AgentDesk: re-import if the CLI wrote to it since.
  const stale =
    hit &&
    hit.source !== 'app' &&
    hit.turns.length === hit.importedCount &&
    !active.has(id) &&
    listNativeSessions(hit.projectPath).some((s) => s.id === id && s.updatedAt > hit.updatedAt);
  if (hit && !stale) return hit;
  projectPath ??= hit?.projectPath;
  const m = /^(claude|codex):(.+)$/.exec(id);
  if (!m || !projectPath) return hit;
  const agent = m[1] as Agent;
  const turns = nativeTurns(agent, m[2], projectPath);
  if (!turns) return;
  const c: Conversation = {
    id,
    projectPath,
    title: (turns.find((t) => t.role === 'user')?.text || NEW_TITLE).slice(0, 80),
    createdAt: turns[0]?.createdAt || Date.now(),
    updatedAt: Date.now(),
    sessions: { [agent]: m[2] },
    seen: { [agent]: turns.length },
    turns,
    source: agent as 'claude' | 'codex',
    importedCount: turns.length,
  };
  const native = listNativeSessions(projectPath).find((s) => s.id === id);
  if (native) c.title = native.title;
  cache.delete(id); // replace a stale copy
  saveConv(c, true);
  return c;
}

// Native CLI sessions the user deleted in AgentDesk. We only hide them: the files under
// ~/.claude and ~/.codex belong to those CLIs (still reachable with `claude --resume`).
const HIDDEN_FILE = dataFile('hidden-sessions.json');
const hidden = new Set(readJson<string[]>(HIDDEN_FILE, []));

function hideSessions(ids: string[]): void {
  const before = hidden.size;
  for (const s of ids) if (s) hidden.add(s);
  if (hidden.size !== before) writeJson(HIDDEN_FILE, [...hidden].slice(-5000));
}

export function deleteConv(id: string): void {
  const e = index.get(id);
  // otherwise the underlying CLI session would pop back into the list as a "native" entry
  const native = /^(claude|codex|antigravity):(.+)$/.exec(id)?.[2];
  hideSessions([...(e?.sessionIds || []), ...Object.values(loadConv(id)?.sessions || {}), ...(native ? [native] : [])]);
  active.get(id)?.stop();
  clearTimeout(saveTimers.get(id));
  saveTimers.delete(id);
  cache.delete(id);
  index.delete(id);
  fs.rmSync(fileOf(id), { force: true });
  if (e) broadcast({ type: 'list', projectPath: e.projectPath });
}

export function renameConv(id: string, title: string): Conversation | undefined {
  const c = loadConv(id);
  if (!c) return;
  c.title = title.slice(0, 120);
  saveConv(c);
  publish(c);
  return c;
}

/** For diagnostics: how much is held in memory. */
export const memoryStats = () => ({ indexed: index.size, cached: cache.size, pinned: [...cache.values()].filter(pinned).length });

export const isRunning = (id: string) => active.has(id);
/** Some agent is working right now (updating would kill it). */
export const anyRunning = () => active.size > 0;

export function stopConv(id: string): void {
  active.get(id)?.stop();
}

function upsertBlock(turn: Turn, block: Block): Block {
  const i = turn.blocks.findIndex((b) => b.id === block.id);
  if (i < 0) {
    turn.blocks.push(block);
    return block;
  }
  const prev = turn.blocks[i];
  const merged = { ...prev } as Record<string, unknown>;
  for (const [k, v] of Object.entries(block)) if (v !== undefined && v !== '') merged[k] = v;
  turn.blocks[i] = merged as Block;
  return turn.blocks[i];
}

const finalText = (t: Turn) =>
  t.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n\n');

/** Everything this provider has not seen yet, rendered as a transcript it can read. */
export function buildContext(c: Conversation, agent: Agent, upto: number): string {
  const parts: string[] = [];
  for (const t of c.turns.slice(c.seen[agent] || 0, upto)) {
    if (t.role === 'user') {
      if (t.text) parts.push(`### ${t.nodeLabel ? `Pipeline → ${t.nodeLabel}` : 'Người dùng'}\n${t.text}`);
    } else {
      const text = finalText(t);
      if (!text) continue;
      const who = [AGENT_LABEL[t.agent || 'claude'], t.model, t.roleName].filter(Boolean).join(' · ');
      parts.push(`### ${who}\n${text.length > 30000 ? text.slice(0, 30000) + '\n…(đã cắt bớt)' : text}`);
    }
  }
  if (!parts.length) return '';
  return (
    '<context>\nCác tin nhắn dưới đây nằm trong cùng cuộc trò chuyện nhưng bạn chưa thấy (do agent khác xử lý). Dùng chúng làm ngữ cảnh.\n\n' +
    parts.join('\n\n') +
    '\n</context>\n\n'
  );
}

export interface TurnOptions {
  prompt: string;
  /** what to show as the user message (defaults to prompt) */
  display?: string;
  config: RunConfig;
  roleName?: string;
  roleIcon?: string;
  nodeId?: string;
  nodeLabel?: string;
}

export async function executeTurn(c: Conversation, o: TurnOptions): Promise<{ turn: Turn; result: RunResult }> {
  if (active.has(c.id)) throw new Error('Cuộc trò chuyện này đang chạy, hãy đợi hoặc bấm dừng.');
  const cfg = o.config;
  const agent = cfg.agent;

  const userTurn: Turn = {
    id: uid('t_'),
    role: 'user',
    createdAt: Date.now(),
    text: o.display ?? o.prompt,
    nodeId: o.nodeId,
    nodeLabel: o.nodeLabel,
    blocks: [],
    status: 'done',
  };
  c.turns.push(userTurn);
  c.branch = headBranch(c.projectPath) ?? c.branch;
  // title: the typed text, without the "📎 Đính kèm:" list the composer appends
  if (c.title === NEW_TITLE) c.title = (o.display ?? o.prompt).split('\n\n📎 ')[0].replace(/\s+/g, ' ').slice(0, 80) || NEW_TITLE;

  const attempt = async (): Promise<{ turn: Turn; result: RunResult }> => {
    if (!c.sessions[agent]) c.seen[agent] = 0;
    const context = buildContext(c, agent, c.turns.length - 1);
    const turn: Turn = {
      id: uid('t_'),
      role: 'assistant',
      createdAt: Date.now(),
      agent,
      model: cfg.model,
      effort: cfg.effort,
      permission: cfg.permission,
      roleName: o.roleName,
      roleIcon: o.roleIcon,
      nodeId: o.nodeId,
      nodeLabel: o.nodeLabel,
      blocks: [],
      status: 'running',
    };
    c.turns.push(turn);
    // index first: the sidebar shows this agent right away, not after its first tool call
    saveConv(c);
    publish(c);

    const handle = startRun(cfg, context + o.prompt, c.projectPath, c.sessions[agent], {
      onSession(id, model) {
        c.sessions[agent] = id;
        if (model && agent !== 'codex') turn.model = model;
      },
      onDelta(text) {
        broadcast({ type: 'turn', convId: c.id, turnId: turn.id, ev: { t: 'delta', text } });
      },
      onBlock(block) {
        const b = upsertBlock(turn, block);
        broadcast({ type: 'turn', convId: c.id, turnId: turn.id, ev: { t: 'block', block: b } });
        saveConv(c);
        publishRow(c);
      },
    });
    active.set(c.id, handle);
    let result: RunResult;
    try {
      result = await handle.promise;
    } finally {
      active.delete(c.id);
    }
    turn.status = result.stopped ? 'stopped' : result.ok ? 'done' : 'error';
    turn.usage = result.usage;
    turn.durationMs = result.durationMs;
    for (const b of turn.blocks) if (b.type === 'tool' && b.status === 'running') b.status = result.ok ? 'done' : 'error';
    return { turn, result };
  };

  let out = await attempt();
  // The stored CLI session may have been deleted outside the app: start a fresh one once.
  if (!out.result.ok && !out.result.stopped && c.sessions[agent] && /no conversation found|session.{0,40}not found|thread.{0,40}not found|no rollout found/i.test(out.result.error || '')) {
    c.turns.splice(c.turns.indexOf(out.turn), 1);
    delete c.sessions[agent];
    out = await attempt();
  }
  c.seen[agent] = c.turns.length;
  saveConv(c, true);
  publish(c);
  turnEndHook(c, out.turn, out.result);
  // pipeline steps report once the whole run stops (see pipeline.ts)
  if (!o.nodeId && !c.parentId && !out.result.stopped) {
    if (out.result.ok) sessionEvent(c, 'done', finalText(out.turn) || out.result.finalText || '');
    else sessionEvent(c, 'error', out.result.error || 'Agent dừng vì lỗi');
  }
  return out;
}

/** Called after every agent turn (the auto-continue scheduler listens). */
let turnEndHook: (c: Conversation, turn: Turn, result: RunResult) => void = () => {};
export const setTurnEndHook = (fn: typeof turnEndHook) => (turnEndHook = fn);

export { finalText };
