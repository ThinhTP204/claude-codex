import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { AgentUsage, ResetCredit, UsageReport, UsageWindow } from '../shared/types.ts';
import { getHealth, run } from './catalog.ts';
import { resolveCommand } from './platform.ts';

// ---------------- Claude: `claude -p /usage` (local command, no model call, 0 tokens) ----------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Sep 30 at 2:59pm (Asia/Saigon)" or "2:59pm (Asia/Saigon)" → epoch ms in local time */
function parseClaudeReset(text: string): number | undefined {
  const m = /(?:(\w{3})\w* (\d{1,2})(?:,? (\d{4}))? at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text);
  if (!m) return;
  const now = new Date();
  let h = Number(m[4]) % 12;
  if (m[6].toLowerCase() === 'pm') h += 12;
  const month = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : now.getMonth();
  const day = m[2] ? Number(m[2]) : now.getDate();
  if (month < 0) return;
  const d = new Date(m[3] ? Number(m[3]) : now.getFullYear(), month, day, h, Number(m[5] || 0));
  // a date that already passed with no explicit year belongs to next year
  if (!m[3] && d.getTime() < now.getTime() - 86400_000) d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
}

function claudeLabel(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes('session')) return '5 giờ';
  const scope = /\(([^)]+)\)/.exec(raw)?.[1];
  if (r.includes('week')) return scope && !/all models/i.test(scope) ? `Tuần (${scope.replace(/ only/i, '')})` : 'Tuần';
  return raw;
}

async function claudeUsage(): Promise<AgentUsage> {
  const r = await run('claude', ['-p', '/usage', '--output-format', 'json', '--no-session-persistence'], 60_000, os.tmpdir());
  let text = '';
  try {
    text = JSON.parse(r.stdout).result || '';
  } catch {
    return { ok: false, error: (r.stderr || r.stdout || 'Không đọc được /usage').trim().slice(0, 300), windows: [], fetchedAt: Date.now() };
  }
  const windows: UsageWindow[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(Current [^:]+):\s*(\d+(?:\.\d+)?)% used(?:\s*·\s*resets (.+))?/i.exec(line);
    if (!m) continue;
    const resetsAt = m[3] ? parseClaudeReset(m[3]) : undefined;
    windows.push({ label: claudeLabel(m[1]), usedPercent: Number(m[2]), resetsAt, resetsText: resetsAt ? undefined : m[3]?.trim() });
  }
  const plan = /using your (\w+)/i.exec(text)?.[1];
  const details = text.includes("What's contributing") ? text.slice(text.indexOf("What's contributing")).trim() : undefined;
  if (!windows.length) return { ok: false, error: text.trim().slice(0, 300) || 'Không có dữ liệu usage', windows, fetchedAt: Date.now() };
  return { ok: true, windows, plan: plan === 'subscription' ? undefined : plan, details, fetchedAt: Date.now() };
}

// ---------------- Codex: app-server JSON-RPC ----------------

/** Start `codex app-server`, run one or more requests, then shut it down. */
async function codexRpc<T = any>(method: string, params: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const { cmd, pre } = resolveCommand('codex');
    const p = spawn(cmd, [...pre, 'app-server'], { stdio: ['pipe', 'pipe', 'ignore'], cwd: os.tmpdir(), windowsHide: true });
    const rl = readline.createInterface({ input: p.stdout });
    const send = (m: unknown) => p.stdin.write(JSON.stringify(m) + '\n');
    const done = (fn: () => void) => {
      clearTimeout(timer);
      rl.close();
      p.kill();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('Codex app-server không phản hồi'))), 30_000);
    p.on('error', (e) => done(() => reject(e)));
    rl.on('line', (line) => {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.id === 1) {
        if (m.error) return done(() => reject(new Error(m.error.message)));
        send({ method: 'initialized' });
        send({ id: 2, method, params });
      } else if (m.id === 2) {
        done(() => (m.error ? reject(new Error(m.error.message || JSON.stringify(m.error))) : resolve(m.result)));
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agentdesk', title: 'AgentDesk', version: '0.1.0' } } });
  });
}

function windowLabel(mins?: number): string {
  if (!mins) return '?';
  if (mins === 10080) return 'Tuần';
  if (mins % 1440 === 0) return `${mins / 1440} ngày`;
  if (mins % 60 === 0) return `${mins / 60} giờ`;
  return `${mins} phút`;
}

async function codexUsage(): Promise<AgentUsage> {
  try {
    const r = await codexRpc('account/rateLimits/read', {});
    const snap = r.rateLimitsByLimitId?.codex ?? r.rateLimits;
    const windows: UsageWindow[] = [];
    for (const w of [snap?.primary, snap?.secondary]) {
      if (w) windows.push({ label: windowLabel(w.windowDurationMins), usedPercent: w.usedPercent, resetsAt: w.resetsAt ? w.resetsAt * 1000 : undefined });
    }
    return {
      ok: true,
      windows,
      plan: snap?.planType,
      limitReached: !!snap?.rateLimitReachedType || r.ordinaryUsageAllowed === false,
      resetCredits: (r.rateLimitResetCredits?.credits || [])
        .filter((c: ResetCredit) => c.status === 'available' || c.status === 'redeeming')
        .map((c: ResetCredit) => ({ ...c, grantedAt: c.grantedAt * 1000, expiresAt: c.expiresAt ? c.expiresAt * 1000 : null })),
      fetchedAt: Date.now(),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, windows: [], fetchedAt: Date.now() };
  }
}

// ---------------- Antigravity: `agy -p /usage` (free, no model call) ----------------
// Output rows: "<pool>\t<window> Limit Remaining\t<pct>%\t<ISO reset time>", pct = what is LEFT.

const AGY_POOLS: [RegExp, string][] = [
  [/^gemini models$/i, 'Gemini'],
  [/^claude and gpt models$/i, 'Claude/GPT'],
];

async function agyUsage(): Promise<AgentUsage> {
  const r = await run('agy', ['-p', '/usage'], 30_000, os.tmpdir());
  const windows: UsageWindow[] = [];
  for (const raw of r.stdout.split('\n')) {
    const line = raw.trim();
    const cells = line.includes('\t') ? line.split(/\t+/) : line.split(/\s{2,}/);
    if (cells.length < 4) continue;
    const pool = AGY_POOLS.find(([re]) => re.test(cells[0].trim()))?.[1];
    const left = Number(String(cells[2]).replace('%', '').trim());
    if (!pool || !Number.isFinite(left)) continue;
    const span = /weekly/i.test(cells[1]) ? 'Tuần' : /five hour/i.test(cells[1]) ? '5 giờ' : null;
    if (!span) continue;
    const at = Date.parse(cells[3].trim());
    windows.push({ label: `${pool} · ${span}`, usedPercent: Math.max(0, Math.min(100, 100 - left)), resetsAt: Number.isFinite(at) ? at : undefined });
  }
  if (!windows.length) return { ok: false, error: (r.stderr || r.stdout).trim().slice(0, 300) || 'Không đọc được /usage của agy', windows, fetchedAt: Date.now() };
  // 5h before weekly, Gemini before Claude/GPT
  windows.sort((a, b) => a.label.localeCompare(b.label));
  return { ok: true, windows, fetchedAt: Date.now() };
}

// ---------------- cache + public API ----------------

const cache: { claude?: AgentUsage; codex?: AgentUsage; antigravity?: AgentUsage } = {};
const inflight: { claude?: Promise<AgentUsage>; codex?: Promise<AgentUsage>; antigravity?: Promise<AgentUsage> } = {};
const TTL = 60_000;

function cached(key: 'claude' | 'codex' | 'antigravity', fn: () => Promise<AgentUsage>, force: boolean): Promise<AgentUsage> {
  const hit = cache[key];
  if (!force && hit && Date.now() - hit.fetchedAt < TTL) return Promise.resolve(hit);
  inflight[key] ??= fn()
    .then((u) => {
      // keep the last good numbers if a refresh fails
      cache[key] = u.ok || !hit ? u : { ...hit, error: u.error };
      return cache[key]!;
    })
    .finally(() => (inflight[key] = undefined));
  return inflight[key]!;
}

export async function getUsage(force = false): Promise<UsageReport> {
  const agyInstalled = (await getHealth()).antigravity.installed;
  const [claude, codex, antigravity] = await Promise.all([
    cached('claude', claudeUsage, force),
    cached('codex', codexUsage, force),
    agyInstalled ? cached('antigravity', agyUsage, force) : Promise.resolve(undefined),
  ]);
  return { claude, codex, antigravity };
}

export async function consumeCodexReset(creditId?: string): Promise<{ outcome: string; codex: AgentUsage }> {
  const r = await codexRpc<{ outcome: string }>('account/rateLimitResetCredit/consume', {
    idempotencyKey: crypto.randomUUID(),
    creditId: creditId || null,
  });
  const codex = await cached('codex', codexUsage, true);
  return { outcome: r.outcome, codex };
}
