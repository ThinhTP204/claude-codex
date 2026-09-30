import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Command, Sparkles } from 'lucide-react';
import type { Agent } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import { cx, Spinner } from './ui.tsx';

export interface SlashItem {
  name: string;
  kind: 'command' | 'skill' | 'builtin';
  description?: string;
}

const cache = new Map<string, Promise<SlashItem[]>>();
const load = (project: string, agent: Agent) => {
  const key = `${agent}:${project}`;
  if (!cache.has(key)) cache.set(key, api<SlashItem[]>('GET', `/commands${qs({ project, agent })}`).catch(() => (cache.delete(key), [])));
  return cache.get(key)!;
};

/** "/que" typed at the very start of the composer (no space yet) → "que" */
export const slashQuery = (text: string) => /^[/$]([\w:.-]*)$/.exec(text)?.[1];

const KIND = {
  skill: { icon: Sparkles, label: 'skill', cls: 'text-accent' },
  command: { icon: Command, label: 'lệnh', cls: 'text-info' },
  builtin: { icon: BookOpen, label: 'có sẵn', cls: 'text-muted' },
};

/**
 * The "/" menu above the composer: project/user commands and skills of the selected agent.
 * Keyboard is driven by the composer through `handleKey`.
 */
export function useSlashMenu(text: string, project: string | undefined, agent: Agent, apply: (value: string) => void) {
  const query = slashQuery(text);
  const [items, setItems] = useState<SlashItem[]>();
  const [index, setIndex] = useState(0);
  const [closedFor, setClosedFor] = useState<string>();
  const open = query !== undefined && !!project && closedFor !== text;

  useEffect(() => {
    if (!open || !project) return;
    let alive = true;
    setItems(undefined);
    void load(project, agent).then((l) => alive && setItems(l));
    return () => {
      alive = false;
    };
  }, [open, project, agent]);

  const shown = useMemo(() => {
    if (!items || query === undefined) return [];
    const q = query.toLowerCase();
    const starts = items.filter((i) => i.name.toLowerCase().startsWith(q));
    const contains = items.filter((i) => !i.name.toLowerCase().startsWith(q) && i.name.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 50);
  }, [items, query]);

  useEffect(() => setIndex(0), [query]);

  // Codex's own syntax for skills is "$name"; Claude takes "/name"
  const pick = (i: SlashItem) => apply(`${agent === 'codex' ? '$' : '/'}${i.name} `);

  const handleKey = (e: React.KeyboardEvent): boolean => {
    if (!open || !shown.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((x) => (x + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
      return true;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      pick(shown[index]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setClosedFor(text);
      return true;
    }
    return false;
  };

  const menu = open ? <SlashList items={items} shown={shown} index={index} setIndex={setIndex} pick={pick} agent={agent} /> : null;
  return { menu, handleKey };
}

function SlashList({ items, shown, index, setIndex, pick, agent }: { items?: SlashItem[]; shown: SlashItem[]; index: number; setIndex: (i: number) => void; pick: (i: SlashItem) => void; agent: Agent }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-line bg-raised shadow-pop">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px] text-faint">
        {agent === 'codex' ? 'Skill của Codex (gọi bằng $tên)' : agent === 'antigravity' ? 'Skill & lệnh của Antigravity' : 'Lệnh & skill của Claude trong project này'}
        <span className="ml-auto">↑↓ chọn · Enter/Tab dùng · Esc đóng</span>
      </div>
      <div ref={list} className="max-h-72 overflow-auto p-1">
        {!items ? (
          <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted">
            <Spinner size={12} /> Đang đọc lệnh & skill…
          </div>
        ) : !shown.length ? (
          <div className="px-3 py-2 text-[13px] text-muted">Không có lệnh hay skill nào khớp.</div>
        ) : (
          shown.map((it, i) => {
            const k = KIND[it.kind];
            const Icon = k.icon;
            return (
              <button
                key={`${it.kind}:${it.name}`}
                type="button"
                data-i={i}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the composer
                  pick(it);
                }}
                className={cx('flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left', i === index && 'bg-hover')}
              >
                <Icon size={14} className={cx('mt-0.5 shrink-0', k.cls)} />
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[13px]">
                    {agent === 'codex' ? '$' : '/'}
                    {it.name}
                  </span>
                  {it.description && <span className="block truncate text-[12px] text-muted">{it.description}</span>}
                </span>
                <span className="shrink-0 pt-0.5 text-[10.5px] text-faint">{k.label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
