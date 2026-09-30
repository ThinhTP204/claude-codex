import { useEffect, useState } from 'react';
import { ArrowUp, Check, ChevronRight, Eye, EyeOff, Folder, FolderGit2, HardDrive, Home, X } from 'lucide-react';
import { api, qs } from '../api.ts';
import { addWorkspaceFolder, getState, openProject, setState } from '../store.ts';
import { Spinner, cx, inputCls } from './ui.tsx';

interface BrowseResult {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string; git: boolean }[];
  places: { name: string; path: string }[];
}

/** Pick a project folder inside AgentDesk (no native dialog, works the same on every OS). */
export function FolderBrowser() {
  const [data, setData] = useState<BrowseResult>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [typed, setTyped] = useState('');
  const [filter, setFilter] = useState('');

  const go = async (dir?: string) => {
    setLoading(true);
    setError('');
    try {
      const r = await api<BrowseResult>('GET', `/browse${qs({ dir, hidden: hidden ? '1' : undefined })}`);
      setData(r);
      setTyped(r.path);
      setFilter('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void go(data?.path);
  }, [hidden]);

  const close = () => setState({ showFolderBrowser: false, folderBrowserMode: 'open' });
  const choose = async (p: string) => {
    const add = getState().folderBrowserMode === 'add';
    close();
    await (add ? addWorkspaceFolder(p) : openProject(p));
  };

  const sep = data?.path.includes('\\') ? '\\' : '/';
  const crumbs = data ? data.path.split(/[\\/]/).filter(Boolean) : [];
  const crumbPath = (i: number) => {
    const parts = crumbs.slice(0, i + 1);
    if (sep === '\\') return parts.length === 1 ? `${parts[0]}\\` : parts.join('\\');
    return '/' + parts.join('/');
  };
  const dirs = (data?.dirs || []).filter((d) => !filter || d.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex h-[min(620px,88vh)] w-[min(760px,94vw)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Folder size={17} className="text-accent" />
          <span className="font-semibold">Chọn thư mục project</span>
          <button type="button" onClick={close} className="ml-auto rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg">
            <X size={16} />
          </button>
        </div>

        <form
          className="flex gap-2 border-b border-line px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void go(typed.trim());
          }}
        >
          <input className={cx(inputCls, 'font-mono text-[12.5px]')} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Dán đường dẫn rồi Enter" />
          <button type="button" title={hidden ? 'Ẩn thư mục ẩn' : 'Hiện thư mục ẩn'} onClick={() => setHidden((h) => !h)} className="rounded-lg border border-line px-2 text-muted hover:bg-hover hover:text-fg">
            {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </form>

        <div className="flex min-h-0 flex-1">
          <div className="w-40 shrink-0 space-y-0.5 overflow-y-auto border-r border-line p-2">
            {data?.places.map((p) => (
              <button
                key={p.path}
                type="button"
                onClick={() => void go(p.path)}
                className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover', data.path === p.path && 'bg-active')}
              >
                {p.name === 'Home' ? <Home size={14} /> : /^[A-Z]:$|^\/$/.test(p.name) ? <HardDrive size={14} /> : <Folder size={14} />}
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 text-[12.5px] text-muted">
              <button type="button" disabled={!data?.parent} onClick={() => data?.parent && void go(data.parent)} title="Lên thư mục cha" className="mr-1 rounded-md p-1 hover:bg-hover hover:text-fg disabled:opacity-30">
                <ArrowUp size={14} />
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex shrink-0 items-center gap-1">
                  {i > 0 && <ChevronRight size={12} className="text-faint" />}
                  <button type="button" onClick={() => void go(crumbPath(i))} className={cx('rounded px-1 hover:bg-hover hover:text-fg', i === crumbs.length - 1 && 'font-medium text-fg')}>
                    {c}
                  </button>
                </span>
              ))}
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Lọc…" className="ml-auto w-28 shrink-0 rounded-md border border-line bg-panel px-2 py-0.5 text-[12px] outline-none placeholder:text-faint" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {loading && !data && (
                <div className="grid h-full place-items-center text-muted">
                  <Spinner />
                </div>
              )}
              {error && <div className="m-2 rounded-lg bg-err/10 px-3 py-2 text-[12.5px] text-err">{error}</div>}
              {data && !dirs.length && !error && <div className="p-6 text-center text-[13px] text-faint">Không có thư mục con</div>}
              {dirs.map((d) => (
                <div
                  key={d.path}
                  onDoubleClick={() => void go(d.path)}
                  className="group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-hover"
                  onClick={() => void go(d.path)}
                  title="Bấm để mở thư mục"
                >
                  {d.git ? <FolderGit2 size={15} className="shrink-0 text-accent" /> : <Folder size={15} className="shrink-0 text-[#c09553]" />}
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  {d.git && <span className="shrink-0 text-[11px] text-faint">git</span>}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void choose(d.path);
                    }}
                    className="shrink-0 rounded-md border border-accent/50 px-2 py-0.5 text-[11.5px] text-accent opacity-0 hover:bg-accent/10 group-hover:opacity-100"
                  >
                    Chọn
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted" title={data?.path}>
            {data?.path}
          </span>
          <button type="button" onClick={close} className="rounded-lg px-3 py-1.5 text-[13px] hover:bg-hover">
            Huỷ
          </button>
          <button
            type="button"
            disabled={!data}
            onClick={() => data && void choose(data.path)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
          >
            <Check size={14} /> Mở thư mục này
          </button>
        </div>
      </div>
    </div>
  );
}
