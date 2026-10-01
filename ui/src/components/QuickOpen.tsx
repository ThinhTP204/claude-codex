import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Command, File, GitBranch, MessageSquare, Sparkles } from 'lucide-react';
import type { GitBranch as Branch } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import {
  getState,
  gitAction,
  insertIntoComposer,
  newConv,
  newTerm,
  openConv,
  openFile,
  pickProject,
  runChecks,
  scmRootOf,
  setBottomTab,
  setNotify,
  setRightTab,
  setState,
  toast,
  toggleTermPanel,
  useStore,
} from '../store.ts';
import { cycleTheme } from '../theme.ts';
import { loadSlash, type SlashItem } from './SlashMenu.tsx';
import { AgentIcon, cx } from './ui.tsx';

// ⌘P: one box for files and sessions; ">" commands, "/" skills, "#" branches (like VS Code's prefixes).

interface Item {
  key: string;
  icon: ReactNode;
  label: string;
  /** dimmed text after the label (folder, shortcut…) */
  detail?: string;
  /** character positions of `label` that matched, for highlighting */
  hits?: number[];
  run: () => void;
}

/** Fuzzy match (letters in order). Higher is better; null = no match. */
function fuzzy(q: string, text: string): { score: number; hits: number[] } | null {
  if (!q) return { score: 0, hits: [] };
  const t = text.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let last = -2;
  for (let i = 0, j = 0; i < q.length; i++) {
    const ch = q[i];
    if (ch === ' ') continue;
    const k = t.indexOf(ch, j);
    if (k < 0) return null;
    // consecutive letters and word starts count most
    score += k === last + 1 ? 6 : 1;
    if (k === 0 || /[\s/_.\-]/.test(t[k - 1]) || (text[k] !== t[k] && text[k - 1] === t[k - 1])) score += 4;
    score -= Math.min(k - j, 8) * 0.2;
    hits.push(k);
    last = k;
    j = k + 1;
  }
  if (t.includes(q)) score += 12;
  return { score: score - text.length * 0.01, hits };
}

/** Score a file path: matches in the file name beat matches in folders. */
function fileMatch(q: string, path: string) {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const inName = fuzzy(q, name);
  if (inName) return { score: inName.score + 20, hits: inName.hits.map((h) => h + slash + 1) };
  return fuzzy(q, path);
}

const filesCache = new Map<string, { at: number; v: number; files: Promise<string[]> }>();
function loadFiles(project: string, fsVersion: number): Promise<string[]> {
  const hit = filesCache.get(project);
  if (hit && hit.v === fsVersion && Date.now() - hit.at < 60_000) return hit.files;
  const files = api<{ files: string[] }>('GET', `/fs/all${qs({ project })}`)
    .then((r) => r.files)
    .catch(() => (filesCache.delete(project), []));
  filesCache.set(project, { at: Date.now(), v: fsVersion, files });
  return files;
}

function Highlight({ text, hits }: { text: string; hits?: number[] }) {
  if (!hits?.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-accent">
            {ch}
          </span>
        ) : (
          ch
        ),
      )}
    </>
  );
}

export interface QuickOpenProps {
  initial: string;
  onClose: () => void;
  toggleSidebar: () => void;
  showRight: () => void;
}

export function QuickOpen({ initial, onClose, toggleSidebar, showRight }: QuickOpenProps) {
  const project = useStore((s) => s.project);
  const fsVersion = useStore((s) => s.fsVersion);
  const convList = useStore((s) => s.convList);
  const agent = useStore((s) => s.composer.agent);
  const notify = useStore((s) => s.notify);
  const [q, setQ] = useState(initial);
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<string[]>();
  const [skills, setSkills] = useState<SlashItem[]>();
  const [branches, setBranches] = useState<{ local: Branch[]; remote: Branch[] }>();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mode = q.startsWith('>') ? 'cmd' : q.startsWith('/') ? 'skill' : q.startsWith('#') ? 'branch' : 'file';
  const query = (mode === 'file' ? q : q.slice(1)).trim().toLowerCase();

  useEffect(() => {
    if (!project) return;
    if (mode === 'file') void loadFiles(project, fsVersion).then(setFiles);
    // skills are fetched right away (shared with the "/" menu): listing them can take a few seconds
    if (!skills) void loadSlash(project, agent).then(setSkills);
    if (mode === 'branch' && !branches) {
      const root = scmRootOf(getState());
      void api<{ local: Branch[]; remote: Branch[] }>('GET', `/git/branches${qs({ project: root })}`).then(setBranches, () => setBranches({ local: [], remote: [] }));
    }
  }, [mode, project, fsVersion, agent, skills, branches]);

  const done = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const commands: Omit<Item, 'hits'>[] = useMemo(
    () => [
      { key: 'new', icon: <Command size={14} />, label: 'Cuộc trò chuyện mới', detail: '⌘N', run: done(newConv) },
      { key: 'term', icon: <Command size={14} />, label: 'Bật/tắt terminal', detail: '⌘J', run: done(() => toggleTermPanel()) },
      { key: 'term-new', icon: <Command size={14} />, label: 'Terminal mới', run: done(() => void newTerm()) },
      {
        key: 'checks',
        icon: <Command size={14} />,
        label: 'Kiểm tra lỗi code (Problems)',
        run: done(() => {
          setBottomTab('problems');
          toggleTermPanel(true);
          void runChecks();
        }),
      },
      { key: 'files', icon: <Command size={14} />, label: 'Mở Explorer', detail: '⇧⌘E', run: done(() => (setRightTab('files'), showRight())) },
      { key: 'scm', icon: <Command size={14} />, label: 'Mở Source Control', run: done(() => (setRightTab('scm'), showRight())) },
      { key: 'tasks', icon: <Command size={14} />, label: 'Mở bảng Tasks', run: done(() => setState({ activeTab: 'tasks' })) },
      { key: 'flow', icon: <Command size={14} />, label: 'Mở Pipelines', run: done(() => setState({ activeTab: 'flow' })) },
      { key: 'roles', icon: <Command size={14} />, label: 'Vai trò & model', run: done(() => setState({ showRoles: true })) },
      { key: 'sidebar', icon: <Command size={14} />, label: 'Bật/tắt sidebar', detail: '⌘B', run: done(toggleSidebar) },
      { key: 'theme', icon: <Command size={14} />, label: 'Đổi giao diện sáng/tối', run: done(cycleTheme) },
      { key: 'notify', icon: <Command size={14} />, label: notify ? 'Tắt thông báo khi agent xong' : 'Bật thông báo khi agent xong', run: done(() => setNotify(!notify)) },
      { key: 'project', icon: <Command size={14} />, label: 'Mở project khác', run: done(() => void pickProject()) },
      { key: 'update', icon: <Command size={14} />, label: 'Kiểm tra cập nhật', run: done(() => setState({ showUpdate: true })) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notify],
  );

  const items: Item[] = useMemo(() => {
    const rank = <T,>(list: T[], text: (x: T) => string, limit: number, match = fuzzy) =>
      list
        .map((x) => ({ x, m: match(query, text(x)) }))
        .filter((r): r is { x: T; m: NonNullable<ReturnType<typeof fuzzy>> } => !!r.m)
        .sort((a, b) => b.m.score - a.m.score)
        .slice(0, limit);

    if (mode === 'cmd') return rank(commands, (c) => c.label, 50).map(({ x, m }) => ({ ...x, hits: m.hits }));
    if (mode === 'skill') {
      const sign = agent === 'codex' ? '$' : '/';
      return rank(skills || [], (s) => s.name, 60).map(({ x, m }) => ({
        key: `s:${x.name}`,
        icon: x.kind === 'skill' ? <Sparkles size={14} className="text-accent" /> : <Command size={14} className="text-info" />,
        label: x.name,
        detail: x.description,
        hits: m.hits,
        run: done(() => insertIntoComposer(`${sign}${x.name} `)),
      }));
    }
    if (mode === 'branch') {
      const local = new Set(branches?.local.map((b) => b.name));
      const all = [...(branches?.local || []), ...(branches?.remote || []).filter((b) => !local.has(b.name.replace(/^[^/]+\//, '')))];
      return rank(all, (b) => b.name, 60).map(({ x, m }) => ({
        key: `b:${x.name}`,
        icon: <GitBranch size={14} className={x.current ? 'text-accent' : undefined} />,
        label: x.name,
        detail: x.current ? 'nhánh hiện tại' : local.has(x.name) ? x.date : `remote · ${x.date ?? ''}`,
        hits: m.hits,
        run: done(async () => {
          if (x.current) return;
          if (await gitAction('checkout', { branch: x.name })) toast(local.has(x.name) ? `Đã chuyển sang ${x.name}` : `Đã lấy nhánh ${x.name} về máy`, 'info');
        }),
      }));
    }
    // files + sessions
    const sessions = rank(convList, (c) => c.title, query ? 5 : 4).map(({ x, m }) => ({
      key: `c:${x.id}`,
      icon: x.agents[0] ? <AgentIcon agent={x.agents[0]} size={14} /> : <MessageSquare size={14} />,
      label: x.title,
      detail: 'session',
      hits: m.hits,
      run: done(() => void openConv(x.id)),
    }));
    const fileItems = rank(files || [], (f) => f, 60, fileMatch).map(({ x, m }) => {
      const slash = x.lastIndexOf('/');
      return {
        key: `f:${x}`,
        icon: <File size={14} />,
        label: x.slice(slash + 1),
        detail: slash > 0 ? x.slice(0, slash) : undefined,
        hits: m.hits.filter((h) => h > slash).map((h) => h - slash - 1),
        run: done(() => openFile(x)),
      };
    });
    return query ? [...fileItems.slice(0, 8), ...sessions, ...fileItems.slice(8)] : [...sessions, ...fileItems];
  }, [mode, query, commands, skills, branches, files, convList, agent]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const loading = (mode === 'file' && !files) || (mode === 'skill' && !skills) || (mode === 'branch' && !branches);
  const placeholder = { file: 'Tìm file hoặc session…', cmd: 'Gõ tên lệnh…', skill: 'Tìm skill hoặc lệnh /…', branch: 'Tìm nhánh git…' }[mode];

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/25 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-fit max-h-[60vh] w-full max-w-[600px] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
        <input
          ref={inputRef}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              items[index]?.run();
            }
          }}
          className="w-full border-b border-line bg-transparent px-4 py-3 text-[14px] outline-none placeholder:text-faint"
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              data-i={i}
              onMouseMove={() => i !== index && setIndex(i)}
              onClick={it.run}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]', i === index ? 'bg-active' : '')}
            >
              <span className="shrink-0 text-muted">{it.icon}</span>
              <span className="shrink-0 truncate" style={{ maxWidth: '60%' }}>
                <Highlight text={it.label} hits={it.hits} />
              </span>
              {it.detail && <span className="min-w-0 flex-1 truncate text-[12px] text-faint">{it.detail}</span>}
            </button>
          ))}
          {!items.length && <div className="px-3 py-4 text-center text-[13px] text-faint">{loading ? 'Đang tải…' : 'Không tìm thấy gì'}</div>}
        </div>
        <div className="flex gap-3 border-t border-line px-3 py-1.5 text-[11.5px] text-faint">
          {(
            [
              ['', 'file, session'],
              ['>', 'lệnh'],
              ['/', 'skill'],
              ['#', 'nhánh git'],
            ] as const
          ).map(([p, label]) => (
            <button key={label} type="button" onClick={() => (setQ(p), inputRef.current?.focus())} className={cx('hover:text-fg', (p || 'file') === (mode === 'file' ? 'file' : q[0]) && 'text-fg')}>
              {p && <kbd className="mr-1 rounded bg-hover px-1 font-mono">{p}</kbd>}
              {label}
            </button>
          ))}
          <span className="ml-auto">↑↓ chọn · Enter mở · Esc đóng</span>
        </div>
      </div>
    </div>
  );
}
