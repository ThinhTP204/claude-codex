import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronsDownUp, File, FileCode2, FileJson, FileText, Folder, FolderOpen, FolderPlus, GitBranch, Image, PanelRightClose, RefreshCw, Settings, Lock, X } from 'lucide-react';
import type { FsEntry } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import { addWorkspaceFolder, fileKey, openFile, refreshGit, removeWorkspaceFolder, setRightTab, setScmRoot, setState, useStore } from '../store.ts';
import { cx } from './ui.tsx';

const EXT_COLOR: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', mts: '#3178c6', cts: '#3178c6',
  js: '#d4b72c', jsx: '#d4b72c', mjs: '#d4b72c', cjs: '#d4b72c',
  json: '#c5a332', md: '#519aba', mdx: '#519aba',
  css: '#a86bd1', scss: '#cd6799', less: '#4f6a9a',
  html: '#e44d26', vue: '#41b883', svelte: '#ff3e00',
  py: '#3776ab', go: '#00add8', rs: '#dea584', java: '#b07219', kt: '#a97bff', swift: '#f05138',
  rb: '#cc342d', php: '#777bb4', c: '#599eff', cpp: '#f34b7d', h: '#a074c4', cs: '#68217a',
  sh: '#89e051', zsh: '#89e051', yml: '#cb171e', yaml: '#cb171e', toml: '#9c4221', sql: '#e38c00',
  png: '#a074c4', jpg: '#a074c4', jpeg: '#a074c4', gif: '#a074c4', svg: '#ffb13b', webp: '#a074c4', ico: '#a074c4',
  lock: '#8a8778', env: '#e5c07b', txt: '#8a8778', pdf: '#e44d26',
};

export function FileIcon({ name, size = 15 }: { name: string; size?: number }) {
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  const color = EXT_COLOR[ext] || (lower.startsWith('.env') ? EXT_COLOR.env : 'var(--faint)');
  let I = File;
  if (['json'].includes(ext)) I = FileJson;
  else if (['md', 'mdx', 'txt'].includes(ext)) I = FileText;
  else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) I = Image;
  else if (lower.endsWith('.lock') || lower === 'package-lock.json') I = Lock;
  else if (lower.startsWith('.') || ['toml', 'yml', 'yaml', 'ini', 'conf'].includes(ext)) I = Settings;
  else if (ext) I = FileCode2;
  return <I size={size} style={{ color }} className="shrink-0" />;
}

// VS Code's gitDecoration colors (switch with the light/dark theme)
const GIT_COLOR: Record<string, string> = {
  M: 'var(--git-modified)',
  U: 'var(--git-added)',
  A: 'var(--git-added)',
  D: 'var(--git-deleted)',
  R: 'var(--git-renamed)',
};
const GIT_TITLE: Record<string, string> = { M: 'Đã sửa', U: 'File mới (chưa track)', A: 'Đã thêm', D: 'Đã xoá', R: 'Đổi tên' };

const NO_GIT = { files: {} as Record<string, string> };

/** File tree of one workspace folder. `multi`: several folders are open, so show a VS Code-style root header. */
function RootTree({ root, primary, multi, filter, collapseSignal }: { root: string; primary: boolean; multi: boolean; filter: string; collapseSignal: number }) {
  const fsVersion = useStore((s) => s.fsVersion);
  const git = useStore((s) => (primary ? s.git : s.rootGit[root] || NO_GIT));
  const touched = useStore((s) => s.touched);
  const [children, setChildren] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [open, setOpen] = useState(true);
  const fileRoot = primary ? undefined : root;

  const load = useCallback(
    async (dir: string) => {
      const list = await api<FsEntry[]>('GET', `/fs/list${qs({ project: root, dir })}`).catch(() => undefined);
      if (list) setChildren((c) => ({ ...c, [dir]: list }));
    },
    [root],
  );

  useEffect(() => {
    setChildren({});
    setExpanded(new Set(['']));
  }, [root]);

  useEffect(() => {
    if (collapseSignal) setExpanded(new Set(['']));
  }, [collapseSignal]);

  useEffect(() => {
    if (!open) return;
    for (const d of expanded) void load(d);
    // reload open folders whenever the disk changes
  }, [expanded, load, fsVersion, open]);

  // folders containing changed files
  const dirtyDirs = useMemo(() => {
    const s = new Map<string, string>();
    for (const [f, code] of Object.entries(git.files)) {
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) {
        const d = parts.slice(0, i).join('/');
        if (!s.has(d) || code === 'M') s.set(d, code);
      }
    }
    return s;
  }, [git]);

  const toggle = (dir: string) =>
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(dir)) n.delete(dir);
      else n.add(dir);
      return n;
    });

  const recent = (p: string) => (touched[fileKey(p, fileRoot)] || 0) > Date.now() - 5 * 60_000;
  const fl = filter.toLowerCase();
  const name = root.split(/[\\/]/).pop() || root;
  const changed = Object.keys(git.files).length;

  const render = (dir: string, depth: number): React.ReactNode =>
    (children[dir] || [])
      .filter((e) => !fl || e.type === 'dir' || e.name.toLowerCase().includes(fl))
      .map((e) => {
        const isDir = e.type === 'dir';
        const open = expanded.has(e.path);
        const code = isDir ? dirtyDirs.get(e.path) : git.files[e.path];
        const color = code ? GIT_COLOR[code] : undefined;
        return (
          <div key={e.path}>
            <div
              onClick={() => (isDir ? toggle(e.path) : openFile(e.path, { root: fileRoot }))}
              className={cx('group relative flex h-[22px] cursor-pointer items-center gap-1 pr-2 text-[13px] hover:bg-hover', e.ignored && 'opacity-50')}
              style={{ paddingLeft: 8 + depth * 12 }}
              title={code && !isDir ? `${e.path} · ${GIT_TITLE[code] || code}` : e.ignored ? `${e.path} · bị .gitignore` : e.path}
            >
              {Array.from({ length: depth }).map((_, i) => (
                <span key={i} className="absolute top-0 h-full border-l border-line group-hover:border-line-strong" style={{ left: 14 + i * 12 }} />
              ))}
              {isDir ? <ChevronRight size={14} className={cx('shrink-0 text-muted transition-transform', open && 'rotate-90')} /> : <span className="w-[14px] shrink-0" />}
              {isDir ? (
                open ? <FolderOpen size={15} className="shrink-0 text-[#c09553]" /> : <Folder size={15} className="shrink-0 text-[#c09553]" />
              ) : (
                <FileIcon name={e.name} />
              )}
              <span className="min-w-0 flex-1 truncate" style={{ color }}>
                {e.name}
              </span>
              {!isDir && recent(e.path) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Vừa bị thay đổi" />}
              {code && !isDir && (
                <span className="w-3 shrink-0 text-center text-[11px] font-semibold" style={{ color }}>
                  {code}
                </span>
              )}
              {code && isDir && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />}
            </div>
            {isDir && open && render(e.path, depth + 1)}
          </div>
        );
      });

  const branch = git.branch && (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        setScmRoot(root);
        setRightTab('scm');
      }}
      title="Mở Source Control của thư mục này"
      className="ml-auto inline-flex min-w-0 shrink items-center gap-1 rounded px-1 font-normal normal-case text-faint hover:bg-hover hover:text-fg"
    >
      <GitBranch size={11} className="shrink-0" /> <span className="truncate">{git.branch}</span>
    </button>
  );

  if (!multi)
    return (
      <>
        <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-bold uppercase tracking-wide">
          <span className="truncate">{name}</span>
          {branch}
        </div>
        {render('', 0)}
      </>
    );

  return (
    <div>
      <div
        onClick={() => setOpen((o) => !o)}
        title={root}
        className="group sticky top-0 z-10 flex h-[22px] cursor-pointer items-center gap-1 bg-explorer pl-1 pr-2 text-[11px] font-bold uppercase tracking-wide hover:bg-hover"
      >
        <ChevronRight size={14} className={cx('shrink-0 text-muted transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 truncate">{name}</span>
        {changed > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--git-modified)' }} title={`${changed} file thay đổi`} />}
        {branch}
        {!primary && (
          <button
            type="button"
            title="Bỏ thư mục khỏi workspace (không xoá file)"
            onClick={(ev) => {
              ev.stopPropagation();
              void removeWorkspaceFolder(root);
            }}
            className="shrink-0 rounded p-0.5 text-muted opacity-0 hover:bg-active hover:text-fg group-hover:opacity-100"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {open && render('', 0)}
    </div>
  );
}

export function Explorer({ onCollapse }: { onCollapse: () => void }) {
  const project = useStore((s) => s.project);
  const folders = useStore((s) => s.folders);
  const changed = useStore((s) => Object.keys(s.git.files).length + Object.values(s.rootGit).reduce((n, g) => n + Object.keys(g.files).length, 0));
  const [filter, setFilter] = useState('');
  const [collapseSignal, setCollapseSignal] = useState(0);
  const multi = folders.length > 0;

  return (
    <aside className="flex h-full flex-col bg-explorer">
      <div className="flex h-9 shrink-0 items-center gap-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span>Explorer</span>
        <div className="ml-auto flex items-center">
          {project && (
            <button type="button" title="Thêm thư mục vào workspace (như VS Code)" onClick={() => void addWorkspaceFolder()} className="rounded p-1 hover:bg-hover hover:text-fg">
              <FolderPlus size={14} />
            </button>
          )}
          <button type="button" title="Làm mới" onClick={() => { setState((s) => ({ fsVersion: s.fsVersion + 1 })); void refreshGit(); }} className="rounded p-1 hover:bg-hover hover:text-fg">
            <RefreshCw size={13} />
          </button>
          <button type="button" title="Thu gọn thư mục" onClick={() => setCollapseSignal((n) => n + 1)} className="rounded p-1 hover:bg-hover hover:text-fg">
            <ChevronsDownUp size={14} />
          </button>
          <button type="button" title="Ẩn Explorer" onClick={onCollapse} className="rounded p-1 hover:bg-hover hover:text-fg">
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>
      {project && (
        <div className="px-2 pb-1.5">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Lọc file…" className="w-full rounded border border-line bg-panel px-2 py-0.5 text-[12.5px] outline-none placeholder:text-faint focus:border-info/60" />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto pb-4">
        {project ? (
          [project, ...folders].map((root) => <RootTree key={root} root={root} primary={root === project} multi={multi} filter={filter} collapseSignal={collapseSignal} />)
        ) : (
          <div className="p-4 text-[13px] text-faint">Chưa mở project</div>
        )}
      </div>
      {changed > 0 && <div className="border-t border-line px-3 py-1.5 text-[11.5px] text-muted">{changed} file thay đổi so với git</div>}
    </aside>
  );
}
