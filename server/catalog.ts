import path from 'node:path';
import { execFile } from 'node:child_process';
import type { AgentHealth, Catalog, Health, ModelInfo } from '../shared/types.ts';
import { DATA_DIR, HOME, readJson, writeJson } from './store.ts';
import { resolveCommand } from './platform.ts';

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Aliases (opus/sonnet/haiku) always mean "the newest one this CLI supports", so their label comes
 * from what the CLI actually reported last time (see noteClaudeModel). Full ids pin a version;
 * `minCli` marks models that need a newer Claude Code than may be installed.
 */
const CLAUDE_MODELS: ModelInfo[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: CLAUDE_EFFORTS, defaultEffort: 'high', minCli: '2.1.251', description: 'Mạnh nhất · cần usage credits' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'high', minCli: '2.1.280', description: 'Mạnh, hợp plan/debug' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'medium', description: 'Cân bằng, hợp code' },
  { id: 'opus', label: 'Opus', efforts: CLAUDE_EFFORTS, defaultEffort: 'high', description: 'Bản Opus mới nhất mà CLI hỗ trợ' },
  { id: 'sonnet', label: 'Sonnet', efforts: CLAUDE_EFFORTS, defaultEffort: 'medium', description: 'Bản Sonnet mới nhất mà CLI hỗ trợ' },
  { id: 'haiku', label: 'Haiku', efforts: CLAUDE_EFFORTS, defaultEffort: 'low', description: 'Nhanh, rẻ' },
];

const RESOLVED_FILE = path.join(DATA_DIR, 'claude-models.json');
const resolved: Record<string, string> = readJson(RESOLVED_FILE, {});

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5" */
function prettyClaude(id: string): string {
  const m = /^claude-([a-z]+)-(\d+(?:-\d{1,2})?)(?:-\d{8})?$/.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace('-', '.')}` : id;
}

/** Remember which real model an alias resolved to (from the stream's init event). */
export function noteClaudeModel(alias: string, model: string | undefined): void {
  if (!model || !/^(opus|sonnet|haiku|fable)$/.test(alias) || !model.startsWith('claude-') || resolved[alias] === model) return;
  resolved[alias] = model;
  writeJson(RESOLVED_FILE, resolved);
}

function claudeModels(): ModelInfo[] {
  return CLAUDE_MODELS.map((m) => (resolved[m.id] ? { ...m, label: `${prettyClaude(resolved[m.id])} (mới nhất)` } : m));
}

const CODEX_FALLBACK: ModelInfo[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
];

interface CodexCache {
  models?: {
    slug: string;
    display_name?: string;
    description?: string;
    visibility?: string;
    default_reasoning_level?: string;
    supported_reasoning_levels?: { effort: string }[];
    service_tiers?: { id: string }[];
    priority?: number;
  }[];
}

export function getCatalog(): Catalog {
  const cache = readJson<CodexCache>(path.join(HOME, '.codex', 'models_cache.json'), {});
  const codex: ModelInfo[] = (cache.models || [])
    .filter((m) => m.visibility === 'list')
    .map((m) => ({
      id: m.slug,
      label: m.display_name || m.slug,
      efforts: (m.supported_reasoning_levels || []).map((l) => l.effort),
      defaultEffort: m.default_reasoning_level,
      fast: (m.service_tiers || []).some((t) => t.id === 'priority'),
      description: m.description,
    }));
  return { claude: claudeModels(), codex: codex.length ? codex : CODEX_FALLBACK, antigravity: [AGY_DEFAULT, ...agyModels] };
}

// ---- Antigravity (agy) ----

const AGY_EFFORTS = ['low', 'medium', 'high'];
/** "" = don't pass --model: agy uses whatever model is configured in its own settings */
const AGY_DEFAULT: ModelInfo = { id: '', label: 'Mặc định (theo agy)', efforts: AGY_EFFORTS, defaultEffort: 'medium', description: 'Model đang chọn trong cài đặt của Antigravity CLI' };
let agyModels: ModelInfo[] = [];

/** Read `agy models` once; the output is a human table, so parse it leniently. */
export async function loadAgyModels(): Promise<void> {
  const r = await run('agy', ['models'], 20_000);
  if (r.code !== 0) return;
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const line of r.stdout.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    const m = /\b((?:gemini|claude|gpt|o\d)[a-z0-9.\-]*)\b(.*)$/i.exec(line.trim());
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const rest = m[2].replace(/^[\s|:\-–]+/, '').trim();
    out.push({ id: m[1], label: m[1], efforts: AGY_EFFORTS, defaultEffort: 'medium', description: rest.slice(0, 80) || undefined });
  }
  agyModels = out;
}

export function run(bin: string, args: string[], timeoutMs = 15000, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const { cmd, pre } = resolveCommand(bin);
    execFile(cmd, [...pre, ...args], { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, cwd, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && !stdout ? String(err.message) : '') });
    });
  });
}

async function claudeHealth(): Promise<AgentHealth> {
  const v = await run('claude', ['--version']);
  if (v.code !== 0) return { installed: false, loggedIn: false, error: 'Không tìm thấy lệnh `claude`' };
  const version = v.stdout.trim().split(' ')[0];
  const a = await run('claude', ['auth', 'status']);
  try {
    const j = JSON.parse(a.stdout);
    return { installed: true, version, loggedIn: !!j.loggedIn, account: [j.email, j.subscriptionType].filter(Boolean).join(' · ') };
  } catch {
    return { installed: true, version, loggedIn: false, error: (a.stderr || a.stdout).trim().slice(0, 300) };
  }
}

async function codexHealth(): Promise<AgentHealth> {
  const v = await run('codex', ['--version']);
  if (v.code !== 0) return { installed: false, loggedIn: false, error: 'Không tìm thấy lệnh `codex`' };
  const version = v.stdout.trim().split(' ').pop();
  const a = await run('codex', ['login', 'status']);
  const text = (a.stdout + a.stderr).trim();
  const loggedIn = /logged in/i.test(text) && !/not logged in/i.test(text);
  return { installed: true, version, loggedIn, account: loggedIn ? text.replace(/^Logged in using /i, '') : undefined, error: loggedIn ? undefined : text.slice(0, 300) };
}

/** Antigravity: installed if `agy --version` works; signed in if the free `/usage` call returns quota. */
async function agyHealth(): Promise<AgentHealth> {
  const v = await run('agy', ['--version']);
  if (v.code !== 0) return { installed: false, loggedIn: false, error: 'Không tìm thấy lệnh `agy` (Antigravity CLI)' };
  const version = (v.stdout.match(/\d+\.\d+[\w.\-]*/) || [v.stdout.trim()])[0];
  const u = await run('agy', ['-p', '/usage'], 30_000);
  const ok = /remaining/i.test(u.stdout);
  return { installed: true, version, loggedIn: ok, account: ok ? 'Google' : undefined, error: ok ? undefined : (u.stderr || u.stdout).trim().slice(0, 300) || 'Chưa đăng nhập: chạy `agy` một lần trong Terminal' };
}

let healthCache: Health | undefined;

export async function getHealth(force = false): Promise<Health> {
  if (!force && healthCache && Date.now() - healthCache.checkedAt < 60_000) return healthCache;
  const [claude, codex, antigravity] = await Promise.all([claudeHealth(), codexHealth(), agyHealth()]);
  healthCache = { claude, codex, antigravity, checkedAt: Date.now() };
  if (antigravity.installed && !agyModels.length) await loadAgyModels();
  return healthCache!;
}
