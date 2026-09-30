import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronsUpDown, Folder, FolderOpen, FolderPlus, FolderTree, X } from 'lucide-react';
import { api } from '../api.ts';
import { openProject, pickProject, safe, setState, useStore } from '../store.ts';
import { Popover, cx, inputCls } from './ui.tsx';

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');
const base = (p?: string) => p?.split('/').filter(Boolean).pop() || '';

/** ⌘O anywhere opens the native folder picker */
export function useOpenShortcut() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void pickProject();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

function MenuContent({ close }: { close: () => void }) {
  const project = useStore((s) => s.project);
  const recent = useStore((s) => s.recent);
  const [typing, setTyping] = useState(false);
  const [path, setPath] = useState('');

  const forget = async (p: string) => {
    const r = await safe(api<string[]>('POST', '/projects/forget', { path: p }));
    if (r) setState({ recent: r });
  };

  return (
    <div className="p-1">
      <button
        type="button"
        onClick={() => {
          close();
          void pickProject();
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium hover:bg-hover"
      >
        <FolderPlus size={15} className="text-accent" />
        Mở thư mục khác…
        <kbd className="ml-auto text-[11px] font-normal text-faint">⌘O</kbd>
      </button>
      <button
        type="button"
        onClick={() => {
          close();
          setState({ showFolderBrowser: true });
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg"
      >
        <FolderTree size={15} />
        Duyệt thư mục trong app…
      </button>
      {typing ? (
        <form
          className="px-1 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!path.trim()) return;
            close();
            void openProject(path.trim());
          }}
        >
          <input autoFocus className={inputCls} placeholder="~/code/my-app rồi Enter" value={path} onChange={(e) => setPath(e.target.value)} />
        </form>
      ) : (
        <button type="button" onClick={() => setTyping(true)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg">
          <Folder size={15} />
          Nhập đường dẫn…
        </button>
      )}
      {recent.length > 0 && (
        <>
          <div className="mx-2 my-1 border-t border-line" />
          <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-faint">Gần đây</div>
          {recent.map((p) => (
            <div key={p} className={cx('group flex items-center rounded-lg hover:bg-hover', p === project && 'bg-hover/60')}>
              <button
                type="button"
                onClick={() => {
                  close();
                  if (p !== project) void openProject(p);
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left"
              >
                <FolderOpen size={15} className={p === project ? 'text-accent' : 'text-faint'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{base(p)}</span>
                  <span className="block truncate text-[11px] text-faint">{tilde(p)}</span>
                </span>
                {p === project && <Check size={14} className="shrink-0 text-accent" />}
              </button>
              {p !== project && (
                <button type="button" title="Bỏ khỏi danh sách" onClick={() => forget(p)} className="mr-1.5 rounded p-1 text-faint opacity-0 hover:bg-active hover:text-fg group-hover:opacity-100">
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Full-width switcher at the top of the left sidebar */
export function ProjectSwitcher() {
  const project = useStore((s) => s.project);
  return (
    <Popover
      width={300}
      anchorClassName="block w-full"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          title={project ? `${project}\nBấm để đổi project (⌘O)` : 'Chọn project'}
          className={cx(
            'group flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
            open ? 'border-line-strong bg-panel' : 'border-line bg-panel/70 hover:border-line-strong hover:bg-panel',
          )}
        >
          <FolderOpen size={15} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-faint">Project</span>
            <span className="block truncate text-[13px] font-medium">{base(project) || 'Chọn project…'}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line px-1.5 py-0.5 text-[11.5px] text-muted group-hover:border-accent/50 group-hover:text-accent">
            Đổi <ChevronsUpDown size={12} />
          </span>
        </button>
      )}
    >
      {(close) => <MenuContent close={close} />}
    </Popover>
  );
}

/** Compact chip, used on the new-chat screen */
export function ProjectChip() {
  const project = useStore((s) => s.project);
  return (
    <Popover
      width={300}
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          className={cx('inline-flex max-w-[320px] items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted hover:bg-hover hover:text-fg', open && 'bg-hover text-fg')}
        >
          <FolderOpen size={14} className="shrink-0 text-accent" />
          <span className="truncate font-medium text-fg">{base(project)}</span>
          <ChevronDown size={13} className="shrink-0" />
        </button>
      )}
    >
      {(close) => <MenuContent close={close} />}
    </Popover>
  );
}
