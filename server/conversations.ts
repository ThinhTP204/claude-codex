import fs from 'node:fs';
import path from 'node:path';
import type { Agent, Block, Conversation, ConversationSummary, RunConfig, ServerMessage, Turn } from '../shared/types.ts';
import { CONV_DIR, readJson, uid, writeJson } from './store.ts';
import { startRun, type RunHandle, type RunResult } from './runner.ts';
import { listNativeSessions, nativeTurns } from './sessions.ts';

export const NEW_TITLE = 'Cuộc trò chuyện mới';
const AGENT_LABEL: Record<Agent, string> = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' };

let broadcast: (msg: ServerMessage) => void = () => {};
export const setBroadcast = (fn: typeof broadcast) => (broadcast = fn);

const convs = new Map<string, Conversation>();
const active = new Map<string, RunHandle>();
const saveTimers = new Map<string, NodeJS.Timeout>();

const fileOf = (id: string) => path.join(CONV_DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

// Load everything once at startup; conversations are small JSON files.
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
  convs.set(c.id, c);
  if (dirty) writeJson(fileOf(c.id), c);
}

export function saveConv(c: Conversation, immediate = false): void {
  c.updatedAt = Date.now();
  clearTimeout(saveTimers.get(c.id));
  if (immediate) {
    writeJson(fileOf(c.id), c);
    return;
  }
  saveTimers.set(
    c.id,
    setTimeout(() => writeJson(fileOf(c.id), c), 400),
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
  return {
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    agents: [...agents],
    models: [...models],
    source: c.source,
    running: active.has(c.id),
    runStatus: c.run?.status,
  };
}

export function listConvs(projectPath: string): ConversationSummary[] {
  const mine = [...convs.values()].filter((c) => c.projectPath === projectPath && (c.turns.length > 0 || c.run));
  const known = new Set<string>();
  for (const c of mine) for (const s of Object.values(c.sessions)) if (s) known.add(s);
  const native = listNativeSessions(projectPath).filter((s) => !known.has(s.sessionId));
  return [...mine.map(summary), ...native.map(({ file: _f, sessionId: _s, ...rest }) => rest)].sort((a, b) => b.updatedAt - a.updatedAt);
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
  convs.set(c.id, c);
  saveConv(c, true);
  return c;
}

/** Open a conversation; ids like `claude:<session>` / `codex:<session>` import a native CLI session. */
export function getConv(id: string, projectPath?: string): Conversation | undefined {
  const hit = convs.get(id);
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
  convs.set(id, c);
  saveConv(c, true);
  return c;
}

export function deleteConv(id: string): void {
  const c = convs.get(id);
  active.get(id)?.stop();
  convs.delete(id);
  fs.rmSync(fileOf(id), { force: true });
  if (c) broadcast({ type: 'list', projectPath: c.projectPath });
}

export function renameConv(id: string, title: string): Conversation | undefined {
  const c = convs.get(id);
  if (!c) return;
  c.title = title.slice(0, 120);
  saveConv(c);
  publish(c);
  return c;
}

export const isRunning = (id: string) => active.has(id);

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
function buildContext(c: Conversation, agent: Agent, upto: number): string {
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
  if (c.title === NEW_TITLE) c.title = (o.display ?? o.prompt).replace(/\s+/g, ' ').slice(0, 80);

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
  return out;
}

export { finalText };
