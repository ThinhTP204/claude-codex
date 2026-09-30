import path from 'node:path';
import { execFile } from 'node:child_process';
import type { AgentHealth, Catalog, Health, ModelInfo } from '../shared/types.ts';
import { HOME, readJson } from './store.ts';

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const CLAUDE_MODELS: ModelInfo[] = [
  { id: 'opus', label: 'Opus 5', efforts: CLAUDE_EFFORTS, defaultEffort: 'high', description: 'Mạnh nhất, hợp plan/debug' },
  { id: 'sonnet', label: 'Sonnet 5', efforts: CLAUDE_EFFORTS, defaultEffort: 'medium', description: 'Cân bằng, hợp code' },
  { id: 'haiku', label: 'Haiku 4.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'low', description: 'Nhanh, rẻ' },
];

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
  return { claude: CLAUDE_MODELS, codex: codex.length ? codex : CODEX_FALLBACK };
}

export function run(bin: string, args: string[], timeoutMs = 15000, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, cwd }, (err, stdout, stderr) => {
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

let healthCache: Health | undefined;

export async function getHealth(force = false): Promise<Health> {
  if (!force && healthCache && Date.now() - healthCache.checkedAt < 60_000) return healthCache;
  const [claude, codex] = await Promise.all([claudeHealth(), codexHealth()]);
  healthCache = { claude, codex, checkedAt: Date.now() };
  return healthCache;
}
