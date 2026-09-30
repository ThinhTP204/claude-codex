import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MessageSquare, PanelLeftOpen, PanelRightOpen, Workflow, X } from 'lucide-react';
import { closeTab, LS, newConv, setState, useStore } from './store.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { ChatView } from './components/ChatView.tsx';
import { Explorer, FileIcon } from './components/Explorer.tsx';
import { RolesDialog } from './components/RolesDialog.tsx';
import { useOpenShortcut } from './components/ProjectMenu.tsx';
import { cx, Spinner } from './components/ui.tsx';

// Monaco and React Flow are heavy: load them only when their tab opens
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

function Resizer({ onDrag, side }: { onDrag: (dx: number) => void; side: 'left' | 'right' }) {
  const last = useRef(0);
  return (
    <div
      className={cx('group relative z-10 w-0 shrink-0 cursor-col-resize', side === 'left' ? '-mr-px' : '-ml-px')}
      onMouseDown={(e) => {
        last.current = e.clientX;
        const move = (ev: MouseEvent) => {
          onDrag(ev.clientX - last.current);
          last.current = ev.clientX;
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          document.body.style.cursor = '';
        };
        document.body.style.cursor = 'col-resize';
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      }}
    >
      <div className="absolute inset-y-0 -left-1 w-2 group-hover:bg-accent/30" />
    </div>
  );
}

export function App() {
  const noToken = useStore((s) => s.noToken);
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const showRoles = useStore((s) => s.showRoles);
  const toast = useStore((s) => s.toast);
  const conv = useStore((s) => s.conv);
  const gitFiles = useStore((s) => s.git.files);
  const [leftW, setLeftW] = useWidth('leftW', 272);
  const [rightW, setRightW] = useWidth('rightW', 280);
  const [leftOpen, setLeftOpen] = useWidth('leftOpen', 1);
  const [rightOpen, setRightOpen] = useWidth('rightOpen', 1);
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
          <Resizer side="left" onDrag={(dx) => setLeftW(Math.max(200, Math.min(460, leftW + dx)))} />
        </>
      ) : null}

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
              if (t.kind === 'chat') {
                icon = <MessageSquare size={14} />;
                label = conv?.title && conv.title !== 'Cuộc trò chuyện mới' ? conv.title : 'Chat';
              } else if (t.kind === 'flow') {
                icon = <Workflow size={14} />;
                label = 'Flow';
              } else {
                icon = <FileIcon name={t.path} size={14} />;
                label = t.path.split('/').pop()!;
              }
              return (
                <div
                  key={t.id}
                  onClick={() => setState({ activeTab: t.id })}
                  onAuxClick={(e) => e.button === 1 && t.kind === 'file' && closeTab(t.id)}
                  title={t.kind === 'file' ? t.path : label}
                  className={cx(
                    'group relative flex h-9 max-w-[240px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-3 text-[13px]',
                    active ? 'bg-bg text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg',
                  )}
                >
                  {active && <span className="absolute inset-x-0 top-0 h-[2px] bg-accent" />}
                  {icon}
                  <span
                    className="truncate"
                    style={{ color: t.kind === 'file' && gitFiles[t.path] ? `var(--git-${gitFiles[t.path] === 'M' ? 'modified' : gitFiles[t.path] === 'D' ? 'deleted' : 'added'})` : undefined }}
                  >
                    {label}
                  </span>
                  {t.kind === 'flow' && running && <Spinner size={11} className="text-accent" />}
                  {t.kind === 'flow' && awaiting && <span className="h-1.5 w-1.5 rounded-full bg-warn" />}
                  {t.kind === 'file' && (
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
          {!rightOpen && (
            <button type="button" onClick={() => setRightOpen(1)} className="mb-1.5 ml-1 rounded-md p-1 text-muted hover:bg-hover hover:text-fg" title="Mở Explorer (⇧⌘E)">
              <PanelRightOpen size={16} />
            </button>
          )}
        </div>
        <div className="relative min-h-0 flex-1">
          {tabs.map((t) => (
            <div key={t.id} className={cx('absolute inset-0', t.id !== activeTab && 'hidden')}>
              {t.kind === 'chat' ? (
                <ChatView />
              ) : (
                <Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}>
                  {t.kind === 'flow' ? flowSeen ? <FlowView /> : null : <FileView path={t.path} />}
                </Suspense>
              )}
            </div>
          ))}
        </div>
      </main>

      {rightOpen ? (
        <>
          <Resizer side="right" onDrag={(dx) => setRightW(Math.max(200, Math.min(520, rightW - dx)))} />
          <div style={{ width: rightW }} className="shrink-0 border-l border-line">
            <Explorer onCollapse={() => setRightOpen(0)} />
          </div>
        </>
      ) : null}

      {showRoles && <RolesDialog />}
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
