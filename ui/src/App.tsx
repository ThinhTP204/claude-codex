import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CopyX, Globe, XCircle, MessageSquare, PanelLeftOpen, PanelRightOpen, SquareTerminal, Workflow, X } from 'lucide-react';
import { closeTab, closeTabs, LS, setBottomTab, newConv, setState, toggleTermPanel, useStore } from './store.ts';
import { TerminalPanel } from './components/TerminalPanel.tsx';
import { PreviewView } from './components/PreviewView.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { ChatView } from './components/ChatView.tsx';
import { FileIcon } from './components/Explorer.tsx';
import { RightPanel } from './components/RightPanel.tsx';
import { RolesDialog } from './components/RolesDialog.tsx';
import { UpdateDialog } from './components/UpdateDialog.tsx';
import { useProblemCounts } from './components/ProblemsView.tsx';
import { FolderBrowser } from './components/FolderBrowser.tsx';
import { useOpenShortcut } from './components/ProjectMenu.tsx';
import { cx, Spinner } from './components/ui.tsx';

// Monaco and React Flow are heavy: load them only when their tab opens
import { MEDIA_RE, MediaView } from './components/MediaView.tsx';
const FileView = lazy(() => import('./components/FileView.tsx').then((m) => ({ default: m.FileView })));
const FlowView = lazy(() => import('./components/FlowView.tsx').then((m) => ({ default: m.FlowView })));

function useWidth(key: string, initial: number) {
  const [w, setW] = useState(() => LS.get(key, initial));
  const set = useCallback(
    (v: number) => {
      setW(v);
      LS.set(key, v);
    },
    [key],
  );
  return [w, set] as const;
}

/**
 * Drag handle between panels. Sizes are computed from where the drag started (not step by step),
 * and the pointer is captured so dragging across the editor / Preview iframe doesn't lose it.
 * Double-click restores the default size.
 */
function DragHandle({
  axis,
  value,
  onChange,
  min,
  max,
  sign,
  reset,
}: {
  axis: 'x' | 'y';
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  /** +1: dragging right/down grows the panel, -1: shrinks it */
  sign: 1 | -1;
  reset: number;
}) {
  const start = useRef<{ pos: number; size: number } | null>(null);
  const x = axis === 'x';
  return (
    <div
      role="separator"
      aria-orientation={x ? 'vertical' : 'horizontal'}
      title="Kéo để đổi kích thước · bấm đúp để về mặc định"
      className={cx('group relative z-20 shrink-0 touch-none', x ? '-mx-[3px] w-[7px] cursor-col-resize' : '-my-[3px] h-[7px] cursor-row-resize')}
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* no capture: dragging still works while the pointer stays over the handle */
        }
        start.current = { pos: x ? e.clientX : e.clientY, size: value };
        document.body.style.cursor = x ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(e) => {
        const st = start.current;
        if (!st) return;
        const d = (x ? e.clientX : e.clientY) - st.pos;
        onChange(Math.round(Math.max(min, Math.min(max, st.size + sign * d))));
      }}
      onPointerUp={(e) => {
        start.current = null;
        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* was not captured */
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }}
      onDoubleClick={() => onChange(reset)}
    >
      <div className={cx('absolute transition-colors group-hover:bg-accent/50 group-active:bg-accent', x ? 'inset-y-0 left-[3px] w-px' : 'inset-x-0 top-[3px] h-px')} />
    </div>
  );
}

/** "⊗ 2 ⚠ 5" in the tab bar, like VS Code's status bar: opens the Problems panel. */
function ProblemsButton() {
  const checkers = useStore((s) => s.checkers.length);
  const checking = useStore((s) => s.checking);
  const checked = useStore((s) => !!s.problems);
  const c = useProblemCounts();
  if (!checkers) return null;
  // not checked yet: don't pretend there are 0 problems
  if (!checked)
    return (
      <button type="button" onClick={() => setBottomTab('problems')} title="Đang kiểm tra lỗi code…" className="mb-1.5 ml-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg">
        <Spinner size={12} /> Kiểm tra lỗi…
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => setBottomTab('problems')}
      title="Problems: lỗi từ TypeScript / ESLint / Biome / Ruff của project"
      className="mb-1.5 ml-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg"
    >
      {checking ? <Spinner size={12} /> : <XCircle size={13} className={c.error ? 'text-err' : ''} />}
      {c.error}
      <AlertTriangle size={13} className={c.warning ? 'text-warn' : ''} />
      {c.warning}
    </button>
  );
}

export function App() {
  const noToken = useStore((s) => s.noToken);
  const tabs = useStore((s) => s.tabs);
  const project = useStore((s) => s.project);
  const activeTab = useStore((s) => s.activeTab);
  const showRoles = useStore((s) => s.showRoles);
  const showUpdate = useStore((s) => s.showUpdate);
  const showFolderBrowser = useStore((s) => s.showFolderBrowser);
  const toast = useStore((s) => s.toast);
  const conv = useStore((s) => s.conv);
  const gitFiles = useStore((s) => s.git.files);
  const rootGit = useStore((s) => s.rootGit);
  const [leftW, setLeftW] = useWidth('leftW', 272);
  const [rightW, setRightW] = useWidth('rightW', 280);
  const [leftOpen, setLeftOpen] = useWidth('leftOpen', 1);
  const [rightOpen, setRightOpen] = useWidth('rightOpen', 1);
  const [termH, setTermH] = useWidth('termH', 280);
  const termOpen = useStore((s) => s.termOpen);
  const termMax = useStore((s) => s.termMax);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string }>();
  const openFileTabs = tabs.filter((t) => t.kind === 'file' || t.kind === 'preview').length;
  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(undefined);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [tabMenu]);
  useOpenShortcut();
  // keep the flow editor mounted after first open so unsaved edits survive tab switches
  const [flowSeen, setFlowSeen] = useState(false);
  useEffect(() => {
    if (activeTab === 'flow') setFlowSeen(true);
  }, [activeTab]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setLeftOpen(leftOpen ? 0 : 1);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newConv();
      }
      // VS Code: ⌃` or ⌘J toggles the terminal panel
      if ((e.ctrlKey && e.key === '`') || (e.metaKey && e.key.toLowerCase() === 'j')) {
        e.preventDefault();
        toggleTermPanel();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'e' && e.shiftKey) {
        e.preventDefault();
        setRightOpen(rightOpen ? 0 : 1);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [leftOpen, rightOpen, setLeftOpen, setRightOpen]);

  useEffect(() => {
    document.title = conv && conv.title ? `${conv.title} · AgentDesk` : 'AgentDesk';
  }, [conv?.title]);

  if (noToken)
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <div className="text-xl font-semibold">Hãy mở AgentDesk bằng lệnh terminal</div>
          <pre className="mt-3 rounded-lg bg-code px-4 py-2 font-mono text-[13px]">agentdesk ~/đường/dẫn/project</pre>
          <p className="mt-2 text-muted">Link này thiếu token bảo mật nên không kết nối được server.</p>
        </div>
      </div>
    );

  const running = conv?.run?.status === 'running' || conv?.turns.some((t) => t.status === 'running');
  const awaiting = conv?.run?.status === 'awaiting';

  return (
    <div className="flex h-full">
      {leftOpen ? (
        <>
          <div style={{ width: leftW }} className="shrink-0 border-r border-line">
            <Sidebar onCollapse={() => setLeftOpen(0)} />
          </div>
          <DragHandle axis="x" value={leftW} onChange={setLeftW} min={200} max={560} sign={1} reset={272} />
        </>
      ) : null}

      {tabMenu && (
        <div
          className="fixed z-50 w-52 rounded-lg border border-line bg-raised p-1 text-[13px] shadow-pop"
          style={{ left: Math.min(tabMenu.x, window.innerWidth - 216), top: tabMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              ['Đóng', () => closeTab(tabMenu.id), tabs.some((t) => t.id === tabMenu.id && (t.kind === 'file' || t.kind === 'preview'))],
              ['Đóng các tab khác', () => closeTabs('others', tabMenu.id), openFileTabs > 0],
              ['Đóng các tab bên phải', () => closeTabs('right', tabMenu.id), true],
              ['Đóng tất cả tab file', () => closeTabs('all'), openFileTabs > 0],
            ] as const
          ).map(([label, act, enabled]) => (
            <button
              key={label}
              type="button"
              disabled={!enabled}
              onClick={() => {
                act();
                setTabMenu(undefined);
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-end gap-0 border-b border-line bg-sidebar/60 pl-1 pr-2">
          {!leftOpen && (
            <button type="button" onClick={() => setLeftOpen(1)} className="mb-1.5 mr-1 rounded-md p-1 text-muted hover:bg-hover hover:text-fg" title="Mở sidebar (⌘B)">
              <PanelLeftOpen size={16} />
            </button>
          )}
          <div className="flex min-w-0 flex-1 items-end overflow-x-auto">
            {tabs.map((t) => {
              const active = t.id === activeTab;
              let icon: ReactNode;
              let label: string;
              let code: string | undefined;
              let hint: string | undefined;
              if (t.kind === 'chat') {
                icon = <MessageSquare size={14} />;
                label = conv?.title && conv.title !== 'Cuộc trò chuyện mới' ? conv.title : 'Chat';
              } else if (t.kind === 'flow') {
                icon = <Workflow size={14} />;
                label = 'Flow';
              } else if (t.kind === 'preview') {
                icon = <Globe size={14} className="text-ok" />;
                label = `Preview · ${t.url.replace(/^https?:\/\//, '')}`;
              } else {
                icon = <FileIcon name={t.path} size={14} />;
                label = t.path.split('/').pop()!;
                code = (t.root ? rootGit[t.root]?.files : gitFiles)?.[t.path];
                // same file name open from another folder: say which one (like VS Code)
                if (tabs.some((o) => o !== t && o.kind === 'file' && o.path.split('/').pop() === label)) hint = (t.root || project || '').split(/[\\/]/).pop();
              }
              return (
                <div
                  key={t.id}
                  onClick={() => setState({ activeTab: t.id })}
                  onAuxClick={(e) => e.button === 1 && (t.kind === 'file' || t.kind === 'preview') && closeTab(t.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTabMenu({ x: e.clientX, y: e.clientY, id: t.id });
                  }}
                  title={t.kind === 'file' ? (t.root ? `${t.root.split(/[\\/]/).pop()} › ${t.path}` : t.path) : label}
                  className={cx(
                    'group relative flex h-9 max-w-[240px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-3 text-[13px]',
                    active ? 'bg-bg text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg',
                  )}
                >
                  {active && <span className="absolute inset-x-0 top-0 h-[2px] bg-accent" />}
                  {icon}
                  <span
                    className="truncate"
                    style={{ color: code ? `var(--git-${code === 'M' ? 'modified' : code === 'D' ? 'deleted' : 'added'})` : undefined }}
                  >
                    {label}
                  </span>
                  {hint && <span className="truncate text-[11.5px] text-faint">{hint}</span>}
                  {t.kind === 'flow' && running && <Spinner size={11} className="text-accent" />}
                  {t.kind === 'flow' && awaiting && <span className="h-1.5 w-1.5 rounded-full bg-warn" />}
                  {(t.kind === 'file' || t.kind === 'preview') && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.id);
                      }}
                      className={cx('rounded p-0.5 hover:bg-active', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {openFileTabs > 1 && (
            <button type="button" onClick={() => closeTabs('all')} className="mb-1.5 ml-1 rounded-md p-1 text-muted hover:bg-hover hover:text-fg" title={`Đóng tất cả ${openFileTabs} tab file (chuột phải vào tab để có thêm lựa chọn)`}>
              <CopyX size={16} />
            </button>
          )}
          <ProblemsButton />
          <button
            type="button"
            onClick={() => toggleTermPanel()}
            className={cx('mb-1.5 ml-1 rounded-md p-1 hover:bg-hover hover:text-fg', termOpen ? 'text-fg' : 'text-muted')}
            title="Terminal (⌃` hoặc ⌘J)"
          >
            <SquareTerminal size={16} />
          </button>
          {!rightOpen && (
            <button type="button" onClick={() => setRightOpen(1)} className="mb-1.5 ml-1 rounded-md p-1 text-muted hover:bg-hover hover:text-fg" title="Mở Explorer (⇧⌘E)">
              <PanelRightOpen size={16} />
            </button>
          )}
        </div>
        <div className={cx('relative min-h-0 flex-1', termOpen && termMax && 'hidden')}>
          {tabs.map((t) => (
            <div key={t.id} className={cx('absolute inset-0', t.id !== activeTab && 'hidden')}>
              {t.kind === 'chat' ? (
                <ChatView />
              ) : (
                <Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}>
                  {t.kind === 'flow' ? flowSeen ? <FlowView /> : null : t.kind === 'preview' ? <PreviewView url={t.url} /> : MEDIA_RE.test(t.path) ? <MediaView path={t.path} root={t.root} /> : <FileView path={t.path} root={t.root} diff={t.diff} line={t.line} nonce={t.nonce} />}
                </Suspense>
              )}
            </div>
          ))}
        </div>
        {termOpen && (
          <>
            {!termMax && <DragHandle axis="y" value={termH} onChange={setTermH} min={120} max={Math.max(160, window.innerHeight - 200)} sign={-1} reset={280} />}
            <div style={termMax ? undefined : { height: termH }} className={cx('border-t border-line', termMax ? 'min-h-0 flex-1' : 'shrink-0')}>
              <TerminalPanel />
            </div>
          </>
        )}
      </main>

      {rightOpen ? (
        <>
          <DragHandle axis="x" value={rightW} onChange={setRightW} min={200} max={720} sign={-1} reset={280} />
          <div style={{ width: rightW }} className="shrink-0 border-l border-line">
            <RightPanel onCollapse={() => setRightOpen(0)} />
          </div>
        </>
      ) : null}

      {showRoles && <RolesDialog />}
      {showUpdate && <UpdateDialog />}
      {showFolderBrowser && <FolderBrowser />}
      {toast && (
        <div
          className={cx(
            'fixed bottom-5 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-xl px-4 py-2.5 text-[13px] shadow-pop',
            toast.kind === 'error' ? 'bg-err text-white' : 'bg-fg text-bg',
          )}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
