import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type { Block, RunConfig, Usage } from '../shared/types.ts';

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

export function codexArgs(cfg: RunConfig, resume?: string): string[] {
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
  a.push('-'); // prompt from stdin
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
  const isClaude = cfg.agent === 'claude';
  const bin = isClaude ? 'claude' : 'codex';
  const args = isClaude ? claudeArgs(cfg, resume) : codexArgs(cfg, resume);
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
    child = spawn(bin, args, { cwd, env: process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin!.on('error', () => {});
    child.stdin!.end(fullPrompt);
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
        if (e.subtype === 'init') ev.onSession(e.session_id, e.model);
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
          texts.push(e.result);
        }
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
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch {
        child?.kill('SIGTERM');
      }
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
