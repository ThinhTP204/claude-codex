import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type { Block, RunConfig, Usage } from '../shared/types.ts';
import { killTree, resolveCommand, spawnOpts } from './platform.ts';
import { noteClaudeModel } from './catalog.ts';
import { nestedRepos, workspaceFolders } from './projects.ts';
import path from 'node:path';
import { ATTACH_DIR } from './store.ts';
import fs from 'node:fs';

export interface RunEvents {
  onSession(id: string, model?: string): void;
  onDelta(text: string): void;
  onBlock(block: Block): void;
}

export interface RunResult {
  ok: boolean;
  stopped: boolean;
  usage?: Usage;
  durationMs: number;
  /** final assistant text (used as the node output in pipelines) */
  finalText: string;
  error?: string;
}

export interface RunHandle {
  promise: Promise<RunResult>;
  stop(): void;
}

const READ_TOOLS = 'Read,Grep,Glob,WebSearch,WebFetch,TodoWrite';
const WRITE_TOOLS = 'Edit,Write,NotebookEdit';

export function claudeArgs(cfg: RunConfig, resume?: string): string[] {
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', cfg.model];
  if (cfg.effort) a.push('--effort', cfg.effort);
  if (resume) a.push('--resume', resume);
  switch (cfg.permission) {
    case 'read':
      a.push('--permission-mode', 'default', '--allowedTools', READ_TOOLS, '--disallowedTools', `${WRITE_TOOLS},Bash`);
      break;
    case 'write':
      a.push('--permission-mode', 'acceptEdits', '--allowedTools', `${READ_TOOLS},${WRITE_TOOLS}`, '--disallowedTools', 'Bash');
      break;
    case 'exec':
      a.push('--permission-mode', 'acceptEdits', '--allowedTools', `${READ_TOOLS},${WRITE_TOOLS},Bash`);
      break;
    case 'full':
      a.push('--dangerously-skip-permissions');
      break;
  }
  if (cfg.fallbackModel) a.push('--fallback-model', cfg.fallbackModel);
  if (cfg.maxBudgetUsd) a.push('--max-budget-usd', String(cfg.maxBudgetUsd));
  if (cfg.systemPrompt?.trim()) a.push('--append-system-prompt', cfg.systemPrompt);
  for (const d of cfg.addDirs || []) a.push('--add-dir', d);
  if (!cfg.useMcp) a.push('--strict-mcp-config');
  return a;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** Images attached in this message (codex only sees pixels through --image). */
function attachedImages(prompt: string): string[] {
  const out: string[] = [];
  for (const line of prompt.split('\n')) {
    const p = line.replace(/^- /, '').trim();
    if (p.startsWith(ATTACH_DIR) && IMAGE_EXT.test(p) && fs.existsSync(p)) out.push(p);
  }
  return [...new Set(out)];
}

export function codexArgs(cfg: RunConfig, resume?: string, images: string[] = []): string[] {
  const a = ['exec'];
  if (resume) a.push('resume', resume);
  a.push('--json', '--skip-git-repo-check', '-m', cfg.model);
  if (cfg.effort) a.push('-c', `model_reasoning_effort="${cfg.effort}"`);
  if (cfg.fast) a.push('-c', 'service_tier="priority"');
  if (cfg.permission === 'full') {
    a.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    const sandbox = cfg.permission === 'read' ? 'read-only' : 'workspace-write';
    // `exec resume` has no -s flag, so the sandbox always goes through config
    a.push('-c', `sandbox_mode="${sandbox}"`);
  }
  if (!resume) for (const d of cfg.addDirs || []) a.push('--add-dir', d);
  // "--image=x" (one value each) so the trailing "-" is not taken as another image
  for (const img of images) a.push(`--image=${img}`);
  a.push('-'); // prompt from stdin
  return a;
}

/**
 * Google Antigravity CLI (`agy`). The prompt goes through stdin as a stream-json "user"
 * event (no command-line length limits); stdin is closed once the `result` event arrives.
 */
export function agyArgs(cfg: RunConfig, resume?: string): string[] {
  const a = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', '60m0s'];
  if (cfg.model) a.push('--model', cfg.model);
  if (cfg.effort) a.push('--effort', cfg.effort);
  if (resume) a.push('--conversation', resume);
  // headless mode can't ask for approval: writing agents run with auto-approve,
  // sandboxed unless the user picked full access
  if (cfg.permission !== 'read') a.push('--dangerously-skip-permissions');
  if (cfg.permission === 'write' || cfg.permission === 'exec') a.push('--sandbox');
  return a;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n');
  return '';
}

const clip = (s: string, n = 20000) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} ký tự nữa)` : s);

export function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const v = input.file_path ?? input.command ?? input.pattern ?? input.path ?? input.url ?? input.query ?? input.description;
  if (typeof v === 'string') return v;
  return JSON.stringify(input);
}

export function startRun(cfg: RunConfig, prompt: string, cwd: string, resume: string | undefined, ev: RunEvents): RunHandle {
  // folders in the project's workspace are reachable by the agent too
  const extra = workspaceFolders(cwd);
  // a parent folder holding several repos: Claude only reads .claude/ (skills, commands, CLAUDE.md)
  // of its cwd and parents, so hand it the repos inside too
  if (cfg.agent === 'claude') extra.push(...nestedRepos(cwd).map((r) => path.join(cwd, r)));
  // files dropped into the chat live in ATTACH_DIR: let the agent read them
  if (prompt.includes(ATTACH_DIR)) extra.push(ATTACH_DIR);
  if (extra.length) cfg = { ...cfg, addDirs: [...new Set([...(cfg.addDirs || []), ...extra])] };
  const isClaude = cfg.agent === 'claude';
  const isAgy = cfg.agent === 'antigravity';
  const bin = isClaude ? 'claude' : isAgy ? 'agy' : 'codex';
  const args = isClaude ? claudeArgs(cfg, resume) : isAgy ? agyArgs(cfg, resume) : codexArgs(cfg, resume, attachedImages(prompt));
  const fullPrompt = !isClaude && cfg.systemPrompt?.trim() ? `<instructions>\n${cfg.systemPrompt}\n</instructions>\n\n${prompt}` : prompt;

  const started = Date.now();
  let child: ChildProcess;
  let stopped = false;
  const texts: string[] = [];
  let usage: Usage | undefined;
  let error: string | undefined;
  let gotResult = false;
  let stderr = '';

  const promise = new Promise<RunResult>((resolve) => {
    const { cmd, pre } = resolveCommand(bin);
    child = spawn(cmd, [...pre, ...args], { cwd, env: process.env, ...spawnOpts, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin!.on('error', () => {});
    if (isAgy) child.stdin!.write(JSON.stringify({ event: 'user', message: { content: fullPrompt } }) + '\n');
    else child.stdin!.end(fullPrompt);
    child.stderr!.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on('error', (e) => {
      error = `Không chạy được \`${bin}\`: ${e.message}`;
    });

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      if (!line.startsWith('{')) return;
      let e: any;
      try {
        e = JSON.parse(line);
      } catch {
        return;
      }
      try {
        if (isClaude) handleClaude(e);
        else if (isAgy) handleAgy(e);
        else handleCodex(e);
      } catch (err) {
        console.error('[runner] parse error', err);
      }
    });

    child.on('close', (code) => {
      if (!stopped && !gotResult && !error) {
        error = (stderr.trim() || `\`${bin}\` thoát với mã ${code}`).slice(-1500);
      }
      if (error && !stopped) ev.onBlock({ type: 'error', id: 'err-final', text: error });
      resolve({
        ok: !error && !stopped,
        stopped,
        usage,
        durationMs: Date.now() - started,
        finalText: texts[texts.length - 1] ?? '',
        error,
      });
    });
  });

  // ---- Claude stream-json ----
  function handleClaude(e: any) {
    if (e.parent_tool_use_id) return; // sub-agent chatter
    switch (e.type) {
      case 'system':
        if (e.subtype === 'init') {
          noteClaudeModel(cfg.model, e.model);
          ev.onSession(e.session_id, e.model);
        }
        break;
      case 'stream_event': {
        const d = e.event;
        if (d?.type === 'content_block_delta' && d.delta?.type === 'text_delta') ev.onDelta(d.delta.text);
        break;
      }
      case 'assistant':
        for (const [i, c] of (e.message?.content || []).entries()) {
          const id = `${e.message.id}-${i}-${c.type}`;
          if (c.type === 'text' && c.text) {
            texts.push(c.text);
            ev.onBlock({ type: 'text', id, text: c.text });
          } else if (c.type === 'thinking' && c.thinking) {
            ev.onBlock({ type: 'thinking', id, text: c.thinking });
          } else if (c.type === 'tool_use') {
            ev.onBlock({ type: 'tool', id: c.id, name: c.name, input: summarizeToolInput(c.name, c.input || {}), status: 'running' });
          }
        }
        break;
      case 'user':
        for (const c of e.message?.content || []) {
          if (c?.type === 'tool_result') {
            ev.onBlock({
              type: 'tool',
              id: c.tool_use_id,
              name: '',
              input: '',
              output: clip(textOf(c.content)),
              status: c.is_error ? 'error' : 'done',
            });
          }
        }
        break;
      case 'result': {
        gotResult = true;
        const u = e.usage || {};
        usage = {
          inputTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
          outputTokens: u.output_tokens || 0,
          cachedTokens: u.cache_read_input_tokens || 0,
          costUsd: e.total_cost_usd,
        };
        if (e.is_error || e.subtype !== 'success') {
          error = e.result || (e.errors || []).join('\n') || e.subtype;
        } else if (e.result && !texts.includes(e.result)) {
          // local slash commands (/context, custom ones answering without a model turn) only report here
          texts.push(e.result);
          ev.onBlock({ type: 'text', id: 'result', text: e.result });
        }
        break;
      }
    }
  }

  // ---- Antigravity (agy) stream-json: init / step_update / result ----
  const agySteps = new Map<number, string>();
  function handleAgy(e: any) {
    switch (e.event) {
      case 'init':
        ev.onSession(e.conversation_id, e.init?.model || cfg.model);
        break;
      case 'step_update': {
        const u = e.step_update || {};
        const idx = Number(u.step_index ?? 0);
        const id = `agy-${idx}`;
        const tool = u.tool_info || (u.tool_name ? { name: u.tool_name } : undefined);
        if (tool || u.step_type === 'tool') {
          const params = (tool?.parameters || {}) as Record<string, unknown>;
          const name = String(tool?.name || u.tool_name || 'tool');
          const err = tool?.error?.message || tool?.error?.type;
          ev.onBlock({
            type: 'tool',
            id,
            name,
            input: summarizeToolInput(name, params),
            output: tool?.output ? clip(String(tool.output)) : err ? String(err) : undefined,
            status: u.state === 'DONE' ? (err ? 'error' : 'done') : 'running',
          });
        } else if (typeof u.text_delta === 'string' && u.text_delta) {
          const text = (agySteps.get(idx) || '') + u.text_delta;
          agySteps.set(idx, text);
          const thinking = /think|plan|reason/i.test(String(u.step_type || ''));
          ev.onBlock(thinking ? { type: 'thinking', id, text } : { type: 'text', id, text });
          if (u.state === 'DONE' && !thinking) texts.push(text);
        }
        break;
      }
      case 'result': {
        gotResult = true;
        const r = e.result || {};
        const u = r.usage || {};
        usage = {
          inputTokens: (u.input_tokens || 0) + (u.cache_read_tokens || 0),
          outputTokens: (u.output_tokens || 0) + (u.thinking_tokens || 0),
          cachedTokens: u.cache_read_tokens || 0,
        };
        if (r.status && r.status !== 'SUCCESS') error = r.error || `Antigravity: ${r.status}`;
        else if (r.response && !texts.includes(r.response)) texts.push(r.response);
        child.stdin?.end(); // one prompt per run: let agy exit
        break;
      }
    }
  }

  // ---- Codex exec --json ----
  function handleCodex(e: any) {
    switch (e.type) {
      case 'thread.started':
        ev.onSession(e.thread_id, cfg.model);
        break;
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const it = e.item || {};
        const done = e.type === 'item.completed';
        switch (it.type) {
          case 'agent_message':
            if (done) texts.push(it.text);
            ev.onBlock({ type: 'text', id: it.id, text: it.text || '' });
            break;
          case 'reasoning':
            if (it.text) ev.onBlock({ type: 'thinking', id: it.id, text: it.text });
            break;
          case 'command_execution':
            ev.onBlock({
              type: 'tool',
              id: it.id,
              name: 'Bash',
              input: String(it.command || '').replace(/^\/bin\/(ba|z)sh -lc /, ''),
              output: it.aggregated_output ? clip(it.aggregated_output) : undefined,
              status: it.status === 'in_progress' ? 'running' : it.exit_code === 0 ? 'done' : 'error',
            });
            break;
          case 'file_change':
            ev.onBlock({
              type: 'tool',
              id: it.id,
              name: 'Edit',
              input: (it.changes || []).map((c: any) => `${c.kind ?? ''} ${c.path}`.trim()).join('\n'),
              status: it.status === 'failed' ? 'error' : done ? 'done' : 'running',
            });
            break;
          case 'mcp_tool_call':
            ev.onBlock({
              type: 'tool',
              id: it.id,
              name: `${it.server}.${it.tool}`,
              input: JSON.stringify(it.arguments ?? {}),
              output: it.result ? clip(JSON.stringify(it.result)) : it.error ? String(it.error?.message ?? it.error) : undefined,
              status: it.status === 'in_progress' ? 'running' : it.status === 'failed' ? 'error' : 'done',
            });
            break;
          case 'web_search':
            ev.onBlock({ type: 'tool', id: it.id, name: 'WebSearch', input: it.query || '', status: done ? 'done' : 'running' });
            break;
          case 'todo_list':
            ev.onBlock({
              type: 'tool',
              id: it.id,
              name: 'Todo',
              input: (it.items || []).map((t: any) => `${t.completed ? '☑' : '☐'} ${t.text}`).join('\n'),
              status: 'done',
            });
            break;
          case 'error':
            ev.onBlock({ type: 'error', id: it.id, text: it.message });
            break;
        }
        break;
      }
      case 'turn.completed': {
        gotResult = true;
        const u = e.usage || {};
        usage = { inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0, cachedTokens: u.cached_input_tokens || 0 };
        break;
      }
      case 'turn.failed':
        gotResult = true;
        error = parseCodexError(e.error?.message);
        break;
      case 'error':
        error = parseCodexError(e.message);
        break;
    }
  }

  return {
    promise,
    stop() {
      stopped = true;
      killTree(child);
    },
  };
}

function parseCodexError(msg: unknown): string {
  const s = String(msg ?? 'Lỗi không rõ');
  try {
    const j = JSON.parse(s);
    return j.error?.message || j.message || s;
  } catch {
    return s;
  }
}
