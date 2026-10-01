import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronDown,
  Columns2,
  Copy,
  Eraser,
  ExternalLink,
  Globe,
  ListChecks,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Play,
  Plus,
  Radio,
  Regex,
  RotateCcw,
  Square,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react';
import type { TermPort, TermProfiles } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import {
  activateTerm,
  closeTerm,
  ensurePreview,
  getState,
  insertIntoComposer,
  newTerm,
  renameTerm,
  safe,
  setBottomTab,
  setState,
  toast,
  toggleTermMax,
  toggleTermPanel,
  useStore,
  type BottomTab,
} from '../store.ts';
import {
  clearFind,
  clearTerm,
  commandOutput,
  copySelection,
  ensureTerm,
  findInTerm,
  fitTerm,
  focusTerm,
  pasteInto,
  retheme,
  selectAll,
  sendToShell,
  termCommands,
  termText,
} from '../terminals.ts';
import { useIsDark } from '../theme.ts';
import { Popover, cx } from './ui.tsx';
import { ProblemsView, useProblemCounts } from './ProblemsView.tsx';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const KEY = isMac ? '⌘' : 'Ctrl+Shift+';

const toAgent = (title: string, text: string) => insertIntoComposer(`${title}:\n\`\`\`\n${text}\n\`\`\`\n`);

export function TerminalPanel() {
  const terms = useStore((s) => s.terms);
  const active = useStore((s) => s.activeTerm);
  const devUrl = useStore((s) => s.devUrl);
  const tab = useStore((s) => s.bottomTab);
  const max = useStore((s) => s.termMax);
  const dark = useIsDark();
  const counts = useProblemCounts();
  const [ports, setPorts] = useState<TermPort[]>([]);
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number }>();

  const cur = terms.find((t) => t.id === active);
  const group = cur ? terms.filter((t) => t.group === cur.group) : [];

  useEffect(() => {
    // wait for the CSS variables of the new theme to apply
    requestAnimationFrame(retheme);
  }, [dark]);

  // ports: fetched while the Ports tab is open (lsof/ps are not free), once when the panel opens
  const project = useStore((s) => s.project);
  useEffect(() => {
    let stop = false;
    const load = () =>
      api<TermPort[]>('GET', `/terms/ports${qs({ project: getState().project })}`)
        .then((p) => !stop && setPorts(p))
        .catch(() => {});
    void load();
    if (tab !== 'ports') return () => void (stop = true);
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [tab, project, terms.length]);

  const sendToAgent = () => {
    if (!active) return;
    const text = termText(active, 60);
    if (!text.trim()) return toast('Terminal chưa có output để gửi', 'info');
    toAgent('Output từ terminal', text);
  };

  const icon = 'grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg';
  const TABS: [BottomTab, string, ReactNode, ReactNode?][] = [
    ['terminal', 'Terminal', <SquareTerminal size={13} />],
    [
      'problems',
      'Problems',
      <ListChecks size={13} />,
      counts.error + counts.warning > 0 && <span className={cx('rounded-full px-1.5 text-[10.5px] leading-4 text-white', counts.error ? 'bg-err' : 'bg-warn')}>{counts.error + counts.warning}</span>,
    ],
    ['ports', 'Ports', <Radio size={13} />, ports.length > 0 && <span className="rounded-full bg-hover px-1.5 text-[10.5px] leading-4 text-fg">{ports.length}</span>],
  ];

  return (
    <div className="@container/panel flex h-full flex-col bg-term">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-[12px]">
        {TABS.map(([k, label, ic, badge]) => (
          <button
            key={k}
            type="button"
            onClick={() => setBottomTab(k)}
            className={cx('relative mr-0.5 flex h-8 shrink-0 items-center gap-1.5 px-1.5 text-[11px] font-semibold uppercase tracking-wider', tab === k ? 'text-fg' : 'text-muted hover:text-fg')}
          >
            {ic}
            <span className="@max-3xl/panel:hidden">{label}</span>
            {badge}
            {tab === k && <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-accent" />}
          </button>
        ))}
        {tab === 'terminal' ? (
          <>
            <TermTabs />
            <NewTermMenu />
            <button type="button" onClick={() => void newTerm({ split: true })} disabled={!cur} title={`Chia đôi terminal (${KEY}\\)`} className={cx(icon, 'disabled:opacity-40')}>
              <Columns2 size={13} />
            </button>
            {devUrl && (
              <button
                type="button"
                onClick={() => ensurePreview(devUrl, true)}
                title="Mở trang đang chạy trong tab Preview"
                className="flex min-w-0 shrink items-center gap-1 rounded-md border border-ok/40 px-2 py-0.5 text-ok hover:bg-ok/10"
              >
                <Globe size={12} className="shrink-0" /> <span className="truncate @max-3xl/panel:hidden">{devUrl.replace(/^https?:\/\//, '')}</span>
              </button>
            )}
            <button type="button" onClick={sendToAgent} title="Gửi đoạn đang chọn (hoặc 60 dòng cuối) vào ô chat" className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-muted hover:bg-hover hover:text-fg">
              <MessageSquarePlus size={13} /> <span className="@max-4xl/panel:hidden">Gửi cho agent</span>
            </button>
            <button type="button" onClick={() => active && clearTerm(active)} title={`Xoá màn hình${isMac ? ' (⌘K)' : ''}`} className={icon}>
              <Eraser size={13} />
            </button>
            <button type="button" onClick={() => active && void closeTerm(active)} title="Tắt terminal này" className={cx(icon, 'hover:text-err')}>
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <div className="flex-1" />
        )}
        <span className="mx-0.5 h-4 w-px shrink-0 bg-line" />
        <button type="button" onClick={() => toggleTermMax()} title={max ? 'Thu nhỏ panel' : 'Phóng to panel'} className={icon}>
          {max ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button
          type="button"
          onClick={() => {
            toggleTermMax(false);
            toggleTermPanel(false);
          }}
          title="Ẩn panel (⌃` hoặc ⌘J)"
          className={icon}
        >
          <X size={14} />
        </button>
      </div>

      {tab === 'problems' && (
        <div className="min-h-0 flex-1">
          <ProblemsView />
        </div>
      )}
      {tab === 'ports' && <PortsView ports={ports} onChange={setPorts} />}

      <div className={cx('relative flex min-h-0 flex-1', tab !== 'terminal' && 'hidden')}>
        {group.map((t, i) => (
          <Fragment key={t.id}>
            {i > 0 && <div className="w-px shrink-0 bg-line" />}
            <TermPane id={t.id} pty={t.pty} active={t.id === active} split={group.length > 1} visible={tab === 'terminal'} onMenu={(x, y) => setCtx({ id: t.id, x, y })} />
          </Fragment>
        ))}
        {cur && !cur.alive && (
          <div className="absolute bottom-2 right-3 rounded-md bg-hover px-2 py-1 text-[11.5px] text-muted">
            Shell đã thoát{cur.exitCode !== undefined ? ` (mã ${cur.exitCode})` : ''}.{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => void newTerm()}>
              Mở terminal mới
            </button>
          </div>
        )}
        {!terms.length && (
          <div className="absolute inset-0 grid place-items-center text-[13px] text-muted">
            <button type="button" onClick={() => void newTerm()} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:bg-hover">
              <Plus size={14} /> Mở terminal
            </button>
          </div>
        )}
      </div>

      {ctx && (
        <FixedMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(undefined)}>
          {[
            ['Copy', <Copy size={13} />, () => void copySelection(ctx.id).then((ok) => !ok && toast('Chưa chọn đoạn nào', 'info')), isMac ? '⌘C' : 'Ctrl+Shift+C'],
            ['Dán', <Copy size={13} />, () => void pasteInto(ctx.id), isMac ? '⌘V' : 'Ctrl+Shift+V'],
            ['Chọn tất cả', <ListChecks size={13} />, () => selectAll(ctx.id)],
            null,
            ['Gửi cho agent', <MessageSquarePlus size={13} />, () => toAgent('Output từ terminal', termText(ctx.id, 60))],
            ['Xoá màn hình', <Eraser size={13} />, () => clearTerm(ctx.id), isMac ? '⌘K' : undefined],
            null,
            ['Chia đôi', <Columns2 size={13} />, () => void newTerm({ split: true }), `${KEY}\\`],
            ['Tắt terminal', <Trash2 size={13} />, () => void closeTerm(ctx.id)],
          ]}
        </FixedMenu>
      )}
      <CommandMenu />
    </div>
  );
}

/** One xterm in the panel (two or more side by side when split). */
function TermPane({ id, pty, active, split, visible, onMenu }: { id: string; pty: boolean; active: boolean; split: boolean; visible: boolean; onMenu: (x: number, y: number) => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const find = useStore((s) => s.termFind === id);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const { host } = ensureTerm(id, '', pty);
    el.replaceChildren(host);
    requestAnimationFrame(() => fitTerm(id));
    const ro = new ResizeObserver(() => fitTerm(id));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, pty]);

  useEffect(() => {
    if (active && visible) requestAnimationFrame(() => focusTerm(id));
  }, [active, visible, id]);

  return (
    <div
      className={cx('relative min-w-0 flex-1 pt-1', split && active && 'bg-hover/20')}
      onMouseDown={() => !active && activateTerm(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!active) activateTerm(id);
        onMenu(e.clientX, e.clientY);
      }}
    >
      <div ref={mount} className="h-full w-full pr-1" />
      {find && <FindBar id={id} />}
    </div>
  );
}

/** Tabs of the terminals; split ones sit together in one box. */
function TermTabs() {
  const terms = useStore((s) => s.terms);
  const active = useStore((s) => s.activeTerm);
  const running = useStore((s) => s.termCmd);
  const [editing, setEditing] = useState<string>();
  const groups: (typeof terms)[] = [];
  for (const t of terms) {
    const g = groups.find((x) => x[0].group === t.group);
    if (g) g.push(t);
    else groups.push([t]);
  }
  return (
    <div className="flex min-w-[90px] flex-1 items-center gap-1 overflow-x-auto">
      {groups.map((g) => (
        <div key={g[0].group} className={cx('flex shrink-0 items-center', g.length > 1 && 'rounded-md border border-line')}>
          {g.map((t) => {
            const cmd = running[t.id];
            const on = t.id === active;
            return (
              <div
                key={t.id}
                onClick={() => activateTerm(t.id)}
                onDoubleClick={() => setEditing(t.id)}
                title={`${t.title}${cmd ? ` · đang chạy: ${cmd}` : ''}${t.cwd ? ` · ${t.cwd}` : ''}\nBấm đúp để đổi tên`}
                className={cx('group flex h-6 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2', on ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg')}
              >
                <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', !t.alive ? 'bg-faint' : cmd ? 'animate-pulse bg-accent' : 'bg-ok')} />
                {editing === t.id ? (
                  <input
                    autoFocus
                    defaultValue={t.title}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      void renameTerm(t.id, e.currentTarget.value);
                      setEditing(undefined);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditing(undefined);
                    }}
                    className="w-28 rounded border border-accent/60 bg-panel px-1 text-[12px] outline-none"
                  />
                ) : (
                  <span className="truncate">{cmd ? `${t.title}: ${cmd}` : t.title}</span>
                )}
                <button
                  type="button"
                  title="Đóng terminal"
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeTerm(t.id);
                  }}
                  className="shrink-0 rounded opacity-0 hover:text-err group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** "+" and its menu: a shell of choice, or a package.json script in a new terminal. */
function NewTermMenu() {
  const project = useStore((s) => s.project);
  const [profiles, setProfiles] = useState<TermProfiles>();
  return (
    <div className="flex shrink-0 items-center">
      <button type="button" title={`Terminal mới (Ctrl+Shift+\`)`} onClick={() => void newTerm()} className="grid h-6 w-6 place-items-center rounded-l-md text-muted hover:bg-hover hover:text-fg">
        <Plus size={14} />
      </button>
      <Popover
        placement="bottom-end"
        width={280}
        trigger={(open, toggle) => (
          <button
            type="button"
            title="Chọn shell hoặc chạy script"
            onClick={() => {
              if (!open) void safe(api<TermProfiles>('GET', `/terms/profiles${qs({ project })}`)).then((p) => p && setProfiles(p));
              toggle();
            }}
            className={cx('grid h-6 w-4 place-items-center rounded-r-md text-muted hover:bg-hover hover:text-fg', open && 'bg-hover text-fg')}
          >
            <ChevronDown size={12} />
          </button>
        )}
      >
        {(close) => (
          <div className="max-h-[60vh] overflow-auto p-1 text-[12.5px]">
            <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Shell</div>
            {(profiles?.shells ?? []).map((s) => (
              <MenuItem key={s.path || s.name} onClick={() => (close(), void newTerm({ shell: s.path || undefined }))} icon={<SquareTerminal size={13} />} hint={s.default ? 'mặc định' : undefined}>
                {s.name}
              </MenuItem>
            ))}
            {!profiles && <div className="px-2 py-1 text-muted">Đang tải…</div>}
            <MenuItem onClick={() => (close(), void newTerm({ split: true }))} icon={<Columns2 size={13} />} hint={`${KEY}\\`}>
              Chia đôi terminal
            </MenuItem>
            {!!profiles?.scripts.length && (
              <>
                <div className="mt-1 border-t border-line px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Chạy script (package.json)</div>
                {profiles.scripts.map((s) => (
                  <MenuItem key={s.name} onClick={() => (close(), void newTerm({ command: s.run, title: s.name }))} icon={<Play size={12} className="text-accent" />} hint={s.cmd}>
                    {s.name}
                  </MenuItem>
                ))}
              </>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}

function MenuItem({ children, icon, hint, onClick, danger }: { children: ReactNode; icon?: ReactNode; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover', danger && 'text-err')}>
      <span className="grid w-4 shrink-0 place-items-center text-muted">{icon}</span>
      <span className="shrink-0">{children}</span>
      {hint && <span className="ml-auto min-w-0 truncate pl-3 font-mono text-[11px] text-faint">{hint}</span>}
    </button>
  );
}

type Item = [string, ReactNode, () => void, string?] | null;

/** A right-click style menu at a screen position. */
function FixedMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: Item[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={ref} style={pos} className="fixed z-50 min-w-[210px] rounded-lg border border-line bg-raised p-1 text-[12.5px] shadow-xl">
      {children.map((it, i) =>
        it ? (
          <MenuItem
            key={it[0]}
            icon={it[1]}
            hint={it[3]}
            onClick={() => {
              onClose();
              it[2]();
            }}
          >
            {it[0]}
          </MenuItem>
        ) : (
          <div key={`sep${i}`} className="my-1 border-t border-line" />
        ),
      )}
    </div>
  );
}

/** Click on a command's circle: run it again, copy it, or hand its output to the agent. */
function CommandMenu() {
  const menu = useStore((s) => s.termMenu);
  if (!menu) return null;
  const c = termCommands(menu.id)[menu.index];
  const close = () => setState({ termMenu: undefined });
  if (!c) return null;
  const out = () => commandOutput(menu.id, menu.index);
  return (
    <FixedMenu x={menu.x} y={menu.y} onClose={close}>
      {[
        ['Chạy lại lệnh', <RotateCcw size={13} />, () => (sendToShell(menu.id, `${c.command}\r`), focusTerm(menu.id))],
        ['Copy lệnh', <Copy size={13} />, () => void navigator.clipboard.writeText(c.command)],
        ['Copy output', <Copy size={13} />, () => void navigator.clipboard.writeText(out())],
        ['Gửi lệnh + output cho agent', <MessageSquarePlus size={13} />, () => toAgent(`Lệnh \`${c.command}\` (mã thoát ${c.exitCode ?? '?'})`, out() || '(không có output)')],
      ]}
    </FixedMenu>
  );
}

/** ⌘F inside a terminal. */
function FindBar({ id }: { id: string }) {
  const [q, setQ] = useState('');
  const [caseSensitive, setCase] = useState(false);
  const [regex, setRegex] = useState(false);
  const [miss, setMiss] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const go = (dir: 1 | -1, query = q) => setMiss(!!query && !findInTerm(id, query, dir, { caseSensitive, regex }));
  const close = () => {
    clearFind(id);
    setState({ termFind: undefined });
    focusTerm(id);
  };
  const toggle = 'grid h-5 w-5 shrink-0 place-items-center rounded';
  return (
    <div className="absolute right-2 top-1.5 z-10 flex max-w-[calc(100%-16px)] items-center gap-0.5 rounded-md border border-line bg-raised p-1 shadow-lg" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        value={q}
        placeholder="Tìm trong terminal"
        onChange={(e) => {
          setQ(e.target.value);
          go(1, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go(e.shiftKey ? -1 : 1);
          if (e.key === 'Escape') close();
        }}
        className={cx('w-44 min-w-0 shrink rounded border bg-panel px-1.5 py-0.5 text-[12px] outline-none', miss ? 'border-err/70' : 'border-line focus:border-accent/60')}
      />
      <button type="button" title="Phân biệt hoa thường" onClick={() => setCase((v) => !v)} className={cx(toggle, caseSensitive ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-hover')}>
        <CaseSensitive size={14} />
      </button>
      <button type="button" title="Biểu thức chính quy" onClick={() => setRegex((v) => !v)} className={cx(toggle, regex ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-hover')}>
        <Regex size={13} />
      </button>
      <button type="button" title="Kết quả trước (Shift+Enter)" onClick={() => go(-1)} className={cx(toggle, 'text-muted hover:bg-hover')}>
        <ArrowUp size={13} />
      </button>
      <button type="button" title="Kết quả sau (Enter)" onClick={() => go(1)} className={cx(toggle, 'text-muted hover:bg-hover')}>
        <ArrowDown size={13} />
      </button>
      <button type="button" title="Đóng (Esc)" onClick={close} className={cx(toggle, 'text-muted hover:bg-hover')}>
        <X size={13} />
      </button>
    </div>
  );
}

/** Ports opened by things started in the terminals (dev servers…), like VS Code's Ports view. */
function PortsView({ ports, onChange }: { ports: TermPort[]; onChange: (p: TermPort[]) => void }) {
  const url = (p: TermPort) => `http://localhost:${p.port}`;
  const stop = async (p: TermPort) => {
    if (!confirm(`Dừng ${p.process} (PID ${p.pid}) đang mở cổng ${p.port}?`)) return;
    if (await safe(api('POST', `/terms/ports/stop${qs({ project: getState().project })}`, { pid: p.pid }))) onChange(ports.filter((x) => x.pid !== p.pid));
  };
  const btn = 'grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg';
  if (!ports.length)
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-[12.5px] text-muted">
        <div>
          Chưa có cổng nào đang mở từ các terminal.
          <div className="mt-1 text-faint">Chạy dev server (vd `npm run dev`) ở tab Terminal, cổng của nó sẽ hiện ở đây.</div>
        </div>
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-term text-left text-[11px] uppercase tracking-wide text-faint">
          <tr>
            <th className="px-3 py-1.5 font-semibold">Cổng</th>
            <th className="px-3 py-1.5 font-semibold">Địa chỉ</th>
            <th className="px-3 py-1.5 font-semibold">Process</th>
            <th className="px-3 py-1.5 font-semibold">Terminal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ports.map((p) => (
            <tr key={p.port} className="group border-t border-line hover:bg-hover/40">
              <td className="px-3 py-1 font-mono font-semibold">{p.port}</td>
              <td className="px-3 py-1">
                <button type="button" onClick={() => ensurePreview(url(p), true)} className="text-accent hover:underline">
                  {url(p).replace('http://', '')}
                </button>
                {p.host !== '*' && !/^(127\.|::1|localhost|\[::1\])/.test(p.host) && <span className="ml-1.5 text-faint">({p.host})</span>}
              </td>
              <td className="px-3 py-1 text-muted">
                {p.process} <span className="text-faint">· {p.pid}</span>
              </td>
              <td className="px-3 py-1">
                <button type="button" onClick={() => (setBottomTab('terminal'), activateTerm(p.termId))} className="text-muted hover:text-fg hover:underline">
                  {p.termTitle}
                </button>
              </td>
              <td className="px-2 py-1">
                <div className="flex justify-end gap-0.5">
                  <button type="button" title="Mở trong tab Preview" onClick={() => ensurePreview(url(p), true)} className={btn}>
                    <Globe size={13} />
                  </button>
                  <button type="button" title="Mở trong trình duyệt" onClick={() => window.open(url(p), '_blank')} className={btn}>
                    <ExternalLink size={13} />
                  </button>
                  <button type="button" title="Copy địa chỉ" onClick={() => void navigator.clipboard.writeText(url(p)).then(() => toast('Đã copy', 'info'))} className={btn}>
                    <Copy size={13} />
                  </button>
                  <button type="button" title="Dừng process này" onClick={() => void stop(p)} className={cx(btn, 'hover:text-err')}>
                    <Square size={12} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

