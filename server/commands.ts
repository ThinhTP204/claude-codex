// Slash commands and skills available to an agent in a project, for the composer's "/" menu.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveCommand, spawnOpts, killTree } from './platform.ts';
import { nestedRepos } from './projects.ts';

export interface SlashItem {
  name: string;
  kind: 'command' | 'skill' | 'builtin';
  description?: string;
}

/** Built-ins that work headless (others like /model, /skills only exist in the interactive TUI). */
const CLAUDE_BUILTINS: Record<string, string> = {
  compact: 'Tóm tắt cuộc trò chuyện để giải phóng ngữ cảnh',
  context: 'Xem ngữ cảnh đang dùng bao nhiêu token',
  cost: 'Chi phí của session này',
};

/** name + description from a markdown file's frontmatter */
function frontmatter(file: string): { name?: string; description?: string } {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const m = /^---\s*\n([\s\S]*?)\n---/.exec(head);
    if (!m) return {};
    const lines = m[1].split('\n');
    const get = (k: string) => {
      const i = lines.findIndex((l) => l.startsWith(`${k}:`));
      if (i < 0) return undefined;
      const v = lines[i].slice(k.length + 1).trim();
      // YAML block scalars ("description: >-" followed by indented lines)
      if (/^[>|][+-]?$/.test(v) || !v) {
        const body: string[] = [];
        for (const l of lines.slice(i + 1)) {
          if (!/^\s/.test(l)) break;
          body.push(l.trim());
        }
        return body.join(' ').trim() || undefined;
      }
      return v.replace(/^["']|["']$/g, '');
    };
    return { name: get('name'), description: get('description') };
  } catch {
    return {};
  }
}

/** skills/<name>/SKILL.md under each dir */
function scanSkills(dirs: string[]): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const dir of dirs) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const file = path.join(dir, e.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const fm = frontmatter(file);
      const name = fm.name || e.name;
      if (!out.has(name)) out.set(name, fm.description);
    }
  }
  return out;
}

/** commands/**\/*.md → "name" or "folder:name" (Claude's namespacing) */
function scanCommands(dirs: string[]): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const walk = (base: string, rel: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(base, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(base, r);
      else if (e.name.endsWith('.md')) {
        const name = r.slice(0, -3).split('/').join(':');
        if (!out.has(name)) out.set(name, frontmatter(path.join(base, r)).description);
      }
    }
  };
  for (const d of dirs) walk(d, '');
  return out;
}

/**
 * Ask Claude itself: its init event lists every slash command and skill it would accept here
 * (project, user, plugins). `/context` is answered locally (no model call, $0) and not saved.
 */
function claudeInit(cwd: string, addDirs: string[]): Promise<{ slash: string[]; skills: string[] } | undefined> {
  return new Promise((resolve) => {
    const { cmd, pre } = resolveCommand('claude');
    const child = spawn(cmd, [...pre, '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--strict-mcp-config', '--model', 'haiku', ...addDirs.flatMap((d) => ['--add-dir', d])], { cwd, ...spawnOpts, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const done = (v?: { slash: string[]; skills: string[] }) => {
      clearTimeout(t);
      killTree(child);
      resolve(v);
    };
    const t = setTimeout(() => done(), 20_000);
    child.on('error', () => done());
    child.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        if (!line.includes('"subtype":"init"')) continue;
        try {
          const j = JSON.parse(line);
          return done({ slash: j.slash_commands || [], skills: j.skills || [] });
        } catch {
          /* partial line */
        }
      }
    });
    child.stdin.end('/context');
  });
}

const cache = new Map<string, { at: number; items: SlashItem[] }>();

export async function listSlash(project: string, agent: string): Promise<SlashItem[]> {
  const key = `${agent}:${project}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.items;
  const home = os.homedir();
  let items: SlashItem[] = [];
  if (agent === 'claude') {
    // repos inside a parent folder are passed to Claude with --add-dir (see runner), so their skills count
    const roots = [project, ...nestedRepos(project).map((r) => path.join(project, r))];
    const cmds = scanCommands([...roots.map((r) => path.join(r, '.claude', 'commands')), path.join(home, '.claude', 'commands')]);
    const skills = scanSkills([...roots.map((r) => path.join(r, '.claude', 'skills')), path.join(home, '.claude', 'skills')]);
    const init = await claudeInit(project, roots.slice(1));
    const names = new Set([...(init?.slash || []), ...cmds.keys(), ...skills.keys()]);
    for (const name of names) {
      if (skills.has(name) || init?.skills.includes(name)) items.push({ name, kind: 'skill', description: skills.get(name) });
      else if (cmds.has(name)) items.push({ name, kind: 'command', description: cmds.get(name) });
      else if (CLAUDE_BUILTINS[name]) items.push({ name, kind: 'builtin', description: CLAUDE_BUILTINS[name] });
      else if (init?.slash.includes(name) && !/^(model|skills|help|clear|config|login|logout|resume|exit|theme|vim|terminal-setup|ide|permissions|agents|hooks|mcp|memory|doctor|status|upgrade|bug|release-notes|init|add-dir|export|statusline|output-style|privacy-settings|todos|rewind|usage|plugin|install-github-app|pr-comments|security-review|review|heapdump|insights|feedback|keybindings|fast|effort|btw|voice|mobile|stickers|remote-control|extra-usage|passes|sandbox|tasks)$/.test(name))
        items.push({ name, kind: 'command' });
    }
  } else if (agent === 'codex') {
    // Codex picks skills up by name: "$name" (or "/name") in the prompt
    const skills = scanSkills([
      path.join(project, '.codex', 'skills'),
      path.join(project, '.agents', 'skills'),
      path.join(home, '.codex', 'skills'),
      path.join(home, '.agents', 'skills'),
    ]);
    items = [...skills].map(([name, description]) => ({ name, kind: 'skill' as const, description }));
  }
  items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'skill' ? -1 : b.kind === 'skill' ? 1 : a.kind === 'command' ? -1 : 1));
  cache.set(key, { at: Date.now(), items });
  return items;
}
