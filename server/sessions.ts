import fs from 'node:fs';
import path from 'node:path';
import type { Agent, Block, ConversationSummary, Turn } from '../shared/types.ts';
import { HOME, realpathSafe } from './store.ts';
import { summarizeToolInput } from './runner.ts';

const CLAUDE_PROJECTS = path.join(HOME, '.claude', 'projects');
const CODEX_SESSIONS = path.join(HOME, '.codex', 'sessions');
const CODEX_INDEX = path.join(HOME, '.codex', 'session_index.jsonl');

export interface NativeSession extends ConversationSummary {
  sessionId: string;
  file: string;
}

function readHead(file: string, bytes: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readTail(file: string, bytes: number): string {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function jsonLines(text: string): any[] {
  const out: any[] = [];
  for (const l of text.split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      /* partial line at a chunk boundary */
    }
  }
  return out;
}

const cleanText = (t: string) => t.replace(/<(ide_[a-z_]+|system-reminder|context|instructions)>[\s\S]*?<\/\1>/g, '').trim();

const isNoise = (t: string) => /^\s*<(command-|local-command|system-reminder|environment_context|user_instructions|permissions)/.test(t) || t.startsWith('Caveat:');

function claudeUserText(e: any): string | undefined {
  if (e.type !== 'user' || e.isSidechain || e.isMeta || e.isCompactSummary) return;
  const c = e.message?.content;
  let t = '';
  if (typeof c === 'string') t = c;
  else if (Array.isArray(c)) {
    if (c.some((x: any) => x?.type === 'tool_result')) return;
    t = c.filter((x: any) => x?.type === 'text').map((x: any) => x.text).join('\n');
  }
  t = cleanText(t);
  if (!t || isNoise(t)) return;
  return t;
}

// ---------------- Claude ----------------

export const claudeProjectDir = (projectPath: string) => path.join(CLAUDE_PROJECTS, projectPath.replace(/[^a-zA-Z0-9]/g, '-'));

const claudeMetaCache = new Map<string, { mtime: number; meta: NativeSession | null }>();

function claudeMeta(file: string): NativeSession | null {
  const st = fs.statSync(file);
  const hit = claudeMetaCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.meta;
  let title = '';
  let firstUser = '';
  let model = '';
  for (const e of jsonLines(readHead(file, 256 * 1024))) {
    if (!firstUser) firstUser = claudeUserText(e) ?? '';
    if (e.type === 'assistant' && e.message?.model && !model) model = e.message.model;
  }
  for (const e of jsonLines(readTail(file, 128 * 1024))) {
    if (e.type === 'custom-title' && e.customTitle) title = e.customTitle;
    else if (e.type === 'ai-title' && e.aiTitle && !title.startsWith('!')) title = e.aiTitle;
    else if (e.type === 'summary' && e.summary && !title) title = e.summary;
    if (e.type === 'assistant' && e.message?.model && e.message.model !== '<synthetic>') model = e.message.model;
  }
  const sessionId = path.basename(file, '.jsonl');
  const meta: NativeSession | null = firstUser
    ? {
        id: `claude:${sessionId}`,
        sessionId,
        file,
        title: (title || firstUser).slice(0, 120),
        updatedAt: st.mtimeMs,
        agents: ['claude'],
        models: model ? [model] : [],
        source: 'claude',
      }
    : null;
  claudeMetaCache.set(file, { mtime: st.mtimeMs, meta });
  return meta;
}

export function listClaudeSessions(projectPath: string): NativeSession[] {
  const dir = claudeProjectDir(projectPath);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const out: NativeSession[] = [];
  for (const f of files) {
    try {
      const m = claudeMeta(path.join(dir, f));
      if (m) out.push(m);
    } catch {
      /* unreadable file */
    }
  }
  return out;
}

export function loadClaudeTurns(file: string): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | undefined;
  const tools = new Map<string, Extract<Block, { type: 'tool' }>>();
  for (const e of jsonLines(fs.readFileSync(file, 'utf8'))) {
    if (e.isSidechain) continue;
    const ts = Date.parse(e.timestamp) || 0;
    const userText = claudeUserText(e);
    if (userText) {
      cur = undefined;
      turns.push({ id: e.uuid, role: 'user', createdAt: ts, text: userText, blocks: [], status: 'done' });
      continue;
    }
    if (e.type === 'user' && Array.isArray(e.message?.content)) {
      for (const c of e.message.content) {
        if (c?.type !== 'tool_result') continue;
        const t = tools.get(c.tool_use_id);
        if (!t) continue;
        const out = typeof c.content === 'string' ? c.content : (c.content || []).map((x: any) => x.text ?? '').join('\n');
        t.output = out.slice(0, 20000);
        t.status = c.is_error ? 'error' : 'done';
      }
      continue;
    }
    if (e.type !== 'assistant') continue;
    const m = e.message || {};
    if (m.model === '<synthetic>') continue;
    if (!cur) {
      cur = { id: e.uuid, role: 'assistant', createdAt: ts, agent: 'claude', model: m.model, effort: e.effort, blocks: [], status: 'done' };
      turns.push(cur);
    }
    for (const [i, c] of (m.content || []).entries()) {
      const id = `${m.id}-${i}-${c.type}`;
      if (c.type === 'text' && c.text) cur.blocks.push({ type: 'text', id, text: c.text });
      else if (c.type === 'thinking' && c.thinking) cur.blocks.push({ type: 'thinking', id, text: c.thinking });
      else if (c.type === 'tool_use') {
        const b: Extract<Block, { type: 'tool' }> = { type: 'tool', id: c.id, name: c.name, input: summarizeToolInput(c.name, c.input || {}), status: 'done' };
        tools.set(c.id, b);
        cur.blocks.push(b);
      }
    }
  }
  return turns;
}

// ---------------- Codex ----------------

const codexMetaCache = new Map<string, { mtime: number; cwd: string; id: string; model: string; firstUser: string }>();

function codexIndex(): Map<string, string> {
  const m = new Map<string, string>();
  try {
    for (const e of jsonLines(fs.readFileSync(CODEX_INDEX, 'utf8'))) if (e.id && e.thread_name) m.set(e.id, e.thread_name);
  } catch {
    /* no index */
  }
  return m;
}

function codexUserText(e: any): string | undefined {
  const p = e.payload || {};
  let t: string | undefined;
  if (e.type === 'event_msg' && p.type === 'user_message') t = p.message;
  else if (e.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'UserMessage') {
    t = (p.item.content || []).map((c: any) => c.text ?? '').join('\n');
  }
  t = t ? cleanText(t) : t;
  if (!t || isNoise(t)) return;
  return t;
}

function codexMeta(file: string) {
  const st = fs.statSync(file);
  const hit = codexMetaCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  let cwd = '';
  let id = '';
  let model = '';
  let firstUser = '';
  for (const e of jsonLines(readHead(file, 512 * 1024))) {
    if (e.type === 'session_meta') {
      cwd = e.payload?.cwd || '';
      id = e.payload?.id || e.payload?.session_id || '';
    }
    if (e.type === 'turn_context' && e.payload?.model && !model) model = e.payload.model;
    if (!firstUser) firstUser = codexUserText(e) ?? '';
  }
  const meta = { mtime: st.mtimeMs, cwd: cwd ? realpathSafe(cwd) : '', id, model, firstUser };
  codexMetaCache.set(file, meta);
  return meta;
}

function walkCodex(): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(CODEX_SESSIONS, 0);
  return out;
}

export function listCodexSessions(projectPath: string): NativeSession[] {
  const root = realpathSafe(projectPath);
  const names = codexIndex();
  const out: NativeSession[] = [];
  for (const file of walkCodex()) {
    try {
      const m = codexMeta(file);
      if (m.cwd !== root || !m.id || !m.firstUser) continue;
      out.push({
        id: `codex:${m.id}`,
        sessionId: m.id,
        file,
        title: (names.get(m.id) || m.firstUser).slice(0, 120),
        updatedAt: m.mtime,
        agents: ['codex'],
        models: m.model ? [m.model] : [],
        source: 'codex',
      });
    } catch {
      /* unreadable */
    }
  }
  return out;
}

export function findCodexFile(sessionId: string): string | undefined {
  for (const [file, m] of codexMetaCache) if (m.id === sessionId) return file;
  return walkCodex().find((f) => f.includes(sessionId));
}

export function loadCodexTurns(file: string): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | undefined;
  let model = '';
  let effort = '';
  const tools = new Map<string, Extract<Block, { type: 'tool' }>>();
  let n = 0;
  for (const e of jsonLines(fs.readFileSync(file, 'utf8'))) {
    const ts = Date.parse(e.timestamp) || 0;
    const p = e.payload || {};
    if (e.type === 'turn_context') {
      model = p.model || model;
      effort = p.effort || p.reasoning_effort || effort;
      continue;
    }
    const userText = codexUserText(e);
    if (userText) {
      cur = undefined;
      turns.push({ id: `u${n++}`, role: 'user', createdAt: ts, text: userText, blocks: [], status: 'done' });
      continue;
    }
    if (e.type !== 'response_item') continue;
    const ensure = () => {
      if (!cur) {
        cur = { id: `a${n++}`, role: 'assistant', createdAt: ts, agent: 'codex', model, effort: effort || undefined, blocks: [], status: 'done' };
        turns.push(cur);
      }
      return cur;
    };
    if (p.type === 'message' && p.role === 'assistant') {
      const text = (p.content || []).map((c: any) => c.text ?? '').join('\n').trim();
      if (text) ensure().blocks.push({ type: 'text', id: `b${n++}`, text });
    } else if (p.type === 'reasoning') {
      const text = (p.summary || []).map((s: any) => s.text ?? '').join('\n').trim();
      if (text) ensure().blocks.push({ type: 'thinking', id: `b${n++}`, text });
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      let input = p.input ?? p.arguments ?? '';
      let name = p.name || 'tool';
      try {
        const a = JSON.parse(p.arguments);
        input = Array.isArray(a.command) ? a.command.join(' ') : a.cmd ?? a.command ?? p.arguments;
      } catch {
        /* raw string input */
      }
      if (name === 'exec_command' || name === 'shell') name = 'Bash';
      if (name === 'apply_patch') {
        name = 'Edit';
        input = [...String(input).matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map((m) => m[1]).join('\n') || String(input).slice(0, 500);
      }
      const b: Extract<Block, { type: 'tool' }> = { type: 'tool', id: p.call_id || `b${n++}`, name, input: String(input).replace(/^\/bin\/(ba|z)sh -lc /, ''), status: 'done' };
      tools.set(b.id, b);
      ensure().blocks.push(b);
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const t = tools.get(p.call_id);
      if (t) {
        const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output);
        t.output = out.replace(/^Chunk ID:[\s\S]*?\nOutput:\n/, '').slice(0, 20000);
        if (/Process exited with code [1-9]/.test(out)) t.status = 'error';
      }
    }
  }
  return turns;
}

export function listNativeSessions(projectPath: string): NativeSession[] {
  return [...listClaudeSessions(projectPath), ...listCodexSessions(projectPath)];
}

export function nativeTurns(agent: Agent, sessionId: string, projectPath: string): Turn[] | undefined {
  if (agent === 'claude') {
    const file = path.join(claudeProjectDir(projectPath), `${sessionId}.jsonl`);
    return fs.existsSync(file) ? loadClaudeTurns(file) : undefined;
  }
  const file = findCodexFile(sessionId);
  return file ? loadCodexTurns(file) : undefined;
}
