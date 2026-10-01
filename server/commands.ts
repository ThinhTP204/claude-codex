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

/** Antigravity built-ins usable non-interactively (the rest — /model, /config, /skills… — are TUI panels). */
const AGY_BUILTINS: Record<string, string> = {
  usage: 'Hạn mức (quota) còn lại của các model',
  context: 'Ngữ cảnh đang dùng bao nhiêu token',
  diff: 'Xem thay đổi của các file đã sửa',
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

/** skills/<name>/SKILL.md under each dir (`flat`: a plain <name>.md also counts, as in Antigravity) */
function scanSkills(dirs: string[], flat = false): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const dir of dirs) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const isFlat = flat && e.name.endsWith('.md') && !e.isDirectory();
      const file = isFlat ? path.join(dir, e.name) : path.join(dir, e.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const fm = frontmatter(file);
      const name = fm.name || (isFlat ? e.name.slice(0, -3) : e.name);
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
  } else if (agent === 'antigravity') {
    // https://antigravity.google/docs/skills — every skill is also a "/name" command
    const g = path.join(home, '.gemini');
    const pluginSkills: string[] = [];
    try {
      for (const p of fs.readdirSync(path.join(g, 'antigravity-cli', 'plugins'))) pluginSkills.push(path.join(g, 'antigravity-cli', 'plugins', p, 'skills'));
    } catch {
      /* no plugins */
    }
    const skills = scanSkills(
      [path.join(project, '.agents', 'skills'), path.join(g, 'antigravity-cli', 'skills'), path.join(g, 'config', 'skills'), path.join(g, 'antigravity', 'skills'), ...pluginSkills],
      true,
    );
    items = [...skills].map(([name, description]) => ({ name, kind: 'skill' as const, description }));
    // built-ins that also answer outside the interactive TUI
    for (const [name, description] of Object.entries(AGY_BUILTINS)) if (!skills.has(name)) items.push({ name, kind: 'builtin', description });
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

/** Path of an Antigravity skill by name (project first, then user/plugin dirs), for spelling out "/name" to agy. */
export function agySkillFile(project: string, name: string): string | undefined {
  const g = path.join(os.homedir(), '.gemini');
  const dirs = [path.join(project, '.agents', 'skills'), path.join(g, 'antigravity-cli', 'skills'), path.join(g, 'config', 'skills'), path.join(g, 'antigravity', 'skills')];
  try {
    for (const p of fs.readdirSync(path.join(g, 'antigravity-cli', 'plugins'))) dirs.push(path.join(g, 'antigravity-cli', 'plugins', p, 'skills'));
  } catch {
    /* no plugins */
  }
  for (const d of dirs) {
    for (const f of [path.join(d, name, 'SKILL.md'), path.join(d, `${name}.md`)]) if (fs.existsSync(f)) return f;
    // folder named differently from the skill's `name:`
    try {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name, 'SKILL.md');
        if (e.isDirectory() && fs.existsSync(f) && frontmatter(f).name === name) return f;
      }
    } catch {
      /* missing dir */
    }
  }
  return undefined;
}

/** <dir>/<name>/SKILL.md, <dir>/<name>.md (flat), or a skill folder whose frontmatter `name:` matches. */
function skillIn(dir: string, name: string): string | undefined {
  for (const f of [path.join(dir, name, 'SKILL.md'), path.join(dir, `${name}.md`)]) if (fs.existsSync(f)) return f;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name, 'SKILL.md');
      if (e.isDirectory() && fs.existsSync(f) && frontmatter(f).name === name) return f;
    }
  } catch {
    /* missing dir */
  }
  return undefined;
}

/**
 * A skill or custom command any agent could use in this project, by name: the file holding its
 * instructions, or none for Claude plugin skills (known from the "/" menu, loaded by Claude itself).
 */
export function findSkill(project: string, name: string): { kind: 'skill' | 'command'; file?: string } | undefined {
  if (!/^[\w][\w:.-]*$/.test(name)) return undefined;
  const home = os.homedir();
  const roots = [project, ...nestedRepos(project).map((r) => path.join(project, r))];
  const skillDirs = [
    ...roots.flatMap((r) => [path.join(r, '.claude', 'skills'), path.join(r, '.agents', 'skills'), path.join(r, '.codex', 'skills')]),
    path.join(home, '.claude', 'skills'),
    path.join(home, '.codex', 'skills'),
    path.join(home, '.agents', 'skills'),
  ];
  for (const d of skillDirs) {
    const f = skillIn(d, name);
    if (f) return { kind: 'skill', file: f };
  }
  const agy = agySkillFile(project, name);
  if (agy) return { kind: 'skill', file: agy };
  // Claude custom commands: .claude/commands/a/b.md is "/a:b"
  const rel = `${name.split(':').join('/')}.md`;
  for (const d of [...roots.map((r) => path.join(r, '.claude', 'commands')), path.join(home, '.claude', 'commands')]) {
    if (fs.existsSync(path.join(d, rel))) return { kind: 'command', file: path.join(d, rel) };
  }
  const known = cache.get(`claude:${project}`)?.items.find((i) => i.name === name && i.kind !== 'builtin');
  return known ? { kind: known.kind === 'command' ? 'command' : 'skill' } : undefined;
}

/**
 * Pipeline steps wrap the task in their own prompt, so a "/skill" typed in the task is no longer at
 * the start where a CLI would treat it as a command. Take out every "/name" that is a real skill
 * here and spell it out instead, for whichever agent runs the step.
 */
export function pipelineSkills(task: string, project: string): { task: string; note: string } {
  const found = new Map<string, { kind: 'skill' | 'command'; file?: string }>();
  const look = (raw: string) => {
    const name = raw.replace(/[.:]+$/, '');
    const s = findSkill(project, name);
    if (s) found.set(name, s);
    return s && { name, s };
  };
  // leading "/a /b rest" (as typed from the "/" menu): drop them, the note below says what to use
  let text = task.trimStart();
  for (let m; (m = /^\/([\w][\w:.-]*)(?=$|\s)/.exec(text)) && look(m[1]); ) text = text.slice(m[0].length).trimStart();
  // "/name" standing alone mid-sentence (not a path like /api/users or a URL): keep it readable
  text = text.replace(/(^|\s)\/([\w][\w:.-]*?)(?=[.:]*(?:$|\s|[,;!?)]))/g, (all, pre: string, raw: string) => {
    const hit = look(raw);
    return hit ? `${pre}${hit.s.kind === 'command' ? `lệnh "/${hit.name}"` : `skill "${hit.name}"`}` : all;
  });
  if (!found.size) return { task, note: '' };
  const where = (f: string) => {
    const rel = path.relative(project, f);
    return !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : f.startsWith(os.homedir()) ? `~${f.slice(os.homedir().length)}` : f;
  };
  const lines = [...found].map(([name, s]) =>
    s.kind === 'command'
      ? `- Làm theo lệnh "/${name}"${s.file ? ` (nội dung ở ${where(s.file)})` : ''}.`
      : `- Dùng skill "${name}"${s.file ? ` (đọc hướng dẫn ở ${where(s.file)})` : ''}.`,
  );
  return { task: text.trim() || '(làm theo skill bên dưới)', note: `\n\nNgười dùng chỉ định cho việc này:\n${lines.join('\n')}` };
}
