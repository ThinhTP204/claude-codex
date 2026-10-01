import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, Bell, BellOff, ChevronRight, CircleAlert, GitBranch, Hand, Monitor, Moon, MoreHorizontal, PanelLeftClose, Sun, Pencil, Plus, RefreshCw, Search, Trash2, Users, Workflow } from 'lucide-react';
import type { Agent, ConversationSummary, SessionLane } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import { getState, newConv, openConv, refreshList, safe, setNotify, setState, useStore } from '../store.ts';
import { ProjectSwitcher } from './ProjectMenu.tsx';
import { UsagePanel } from './UsagePanel.tsx';
import { UpdateBadge } from './UpdateDialog.tsx';
import { Logo } from './Logo.tsx';
import { cycleTheme, useThemePref } from '../theme.ts';
import { AGENT_NAME, AgentIcon, Popover, Spinner, cx, modelLabel } from './ui.tsx';

function groupOf(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000;
  if (diff <= 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  if (diff < 7) return '7 ngày qua';
  if (diff < 30) return '30 ngày qua';
  return 'Cũ hơn';
}

function ThemeButton() {
  const pref = useThemePref();
  const Icon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor;
  const label = pref === 'light' ? 'Sáng' : pref === 'dark' ? 'Tối' : 'Theo hệ thống';
  return (
    <button type="button" onClick={cycleTheme} title={`Theme: ${label} (bấm để đổi)`} className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
      <Icon size={15} />
    </button>
  );
}

export function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const project = useStore((s) => s.project);
  const list = useStore((s) => s.convList);
  const convId = useStore((s) => s.convId);
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const ql = q.toLowerCase();
    const items = list.filter((c) => !ql || c.title.toLowerCase().includes(ql));
    const g = new Map<string, ConversationSummary[]>();
    // sessions at work (or waiting for you) stay on top, like Orca
    const live = items.filter(isLive);
    if (live.length) g.set('Đang hoạt động', live);
    for (const c of items) {
      if (isLive(c)) continue;
      const k = groupOf(c.updatedAt);
      g.set(k, [...(g.get(k) || []), c]);
    }
    return [...g.entries()];
  }, [list, q]);

  return (
    <aside className="flex h-full flex-col bg-sidebar">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        {/* clicking the name opens the (otherwise hidden) updater: version + "check for updates" */}
        <button type="button" onClick={() => setState({ showUpdate: true })} title="Phiên bản & cập nhật" className="flex items-center gap-2 rounded-md">
          <Logo size={24} />
          <span className="font-semibold tracking-tight">AgentDesk</span>
        </button>
        <ThemeButton />
        <button type="button" onClick={onCollapse} title="Thu gọn sidebar (⌘B)" className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="space-y-1 px-2">
        <ProjectSwitcher />
        <button
          type="button"
          onClick={() => void newConv()}
          disabled={!project}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13.5px] font-medium hover:bg-hover disabled:opacity-40"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-white">
            <Plus size={13} strokeWidth={3} />
          </span>
          Cuộc trò chuyện mới
          <kbd className="ml-auto text-[11px] font-normal text-faint">⌘N</kbd>
        </button>
        <div className="flex items-center gap-0.5 pb-1">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm session…" className="w-full rounded-lg bg-transparent py-1.5 pl-8 pr-2 text-[13px] outline-none placeholder:text-faint hover:bg-hover/60 focus:bg-hover/60" />
          </div>
          <NotifyButton />
          <button type="button" title="Làm mới" onClick={() => void refreshList()} className="rounded-md p-1 text-faint hover:text-fg">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <nav className="@container/side min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {project && groups.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-faint">Chưa có session nào</div>}
        {groups.map(([g, items]) => (
          <div key={g} className="mt-3">
            <div className="px-2.5 pb-1 text-[11.5px] font-medium text-faint">{g}</div>
            {items.map((c) => (
              <SessionItem key={c.id} c={c} active={c.id === convId} />
            ))}
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-line px-2 py-2">
        <button type="button" onClick={() => setState({ activeTab: 'flow' })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg">
          <Workflow size={15} /> Pipelines
        </button>
        <button type="button" onClick={() => setState({ showRoles: true })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg">
          <Users size={15} /> Vai trò & model
        </button>
        <UpdateBadge />
        <UsagePanel />
      </div>
    </aside>
  );
}

const isLive = (c: ConversationSummary) => c.status === 'running' || c.status === 'awaiting' || !!c.autoAt;

/** Re-render every second while something is running (elapsed timers). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
};
const clock = (ts: number) => new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

function NotifyButton() {
  const on = useStore((s) => s.notify);
  return (
    <button
      type="button"
      onClick={() => setNotify(!on)}
      title={on ? 'Thông báo khi agent xong, lỗi hoặc chờ duyệt: đang bật' : 'Thông báo: đang tắt'}
      className={cx('rounded-md p-1', on ? 'text-faint hover:text-fg' : 'text-faint/60 hover:text-fg')}
    >
      {on ? <Bell size={12} /> : <BellOff size={12} />}
    </button>
  );
}

function StatusMark({ c, unread }: { c: ConversationSummary; unread: boolean }) {
  if (c.status === 'running') return <Spinner size={12} className="shrink-0 text-accent" />;
  if (c.status === 'awaiting') return <Hand size={12} className="shrink-0 text-warn" aria-label="Chờ bạn duyệt" />;
  if (c.autoAt) return <AlarmClock size={12} className="shrink-0 text-accent" aria-label={`Tự tiếp tục lúc ${clock(c.autoAt)}`} />;
  if (c.status === 'error') return <CircleAlert size={12} className={cx('shrink-0 text-err', !unread && 'opacity-60')} aria-label="Gặp lỗi" />;
  if (unread) return <span className="mx-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Có kết quả mới" />;
  return null;
}

function LaneRow({ lane, now }: { lane: SessionLane; now: number }) {
  const catalog = useStore((s) => s.catalog);
  // model ids read better as names; pipeline step names pass through unchanged
  const label = modelLabel(catalog, lane.agent, lane.label) || lane.label;
  const time = lane.status === 'running' && lane.startedAt ? elapsed(now - lane.startedAt) : lane.durationMs ? elapsed(lane.durationMs) : '';
  return (
    <div className={cx('flex items-center gap-1.5 py-[3px] pl-1 pr-1 text-[12px]', lane.status === 'idle' && 'opacity-50')} title={`${AGENT_NAME[lane.agent]}${label ? ` · ${label}` : ''}${lane.activity ? `\n${lane.activity}` : ''}`}>
      <AgentIcon agent={lane.agent} size={12} />
      {label && <span className="max-w-[45%] shrink-0 truncate text-muted">{label}</span>}
      <span className="min-w-0 flex-1 truncate text-faint">
        {lane.activity ?? (lane.status === 'running' ? 'Đang làm việc' : lane.status === 'done' ? 'Xong' : lane.status === 'error' ? 'Lỗi' : lane.status === 'stopped' ? 'Đã dừng' : lane.status === 'idle' ? 'Chưa chạy' : '')}
      </span>
      {time && <span className="shrink-0 tabular-nums text-faint">{time}</span>}
      {lane.status === 'running' ? (
        <Spinner size={10} className="shrink-0 text-accent" />
      ) : lane.status === 'awaiting' ? (
        <Hand size={10} className="shrink-0 text-warn" />
      ) : lane.status === 'error' ? (
        <CircleAlert size={10} className="shrink-0 text-err" />
      ) : null}
    </div>
  );
}

function SessionItem({ c, active }: { c: ConversationSummary; active: boolean }) {
  const catalog = useStore((s) => s.catalog);
  const unread = useStore((s) => !!s.unread[c.id]) && !active;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  const project = useStore((s) => s.project);
  const lanes = c.lanes || [];
  const running = c.status === 'running';
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  // a pipeline at work opens by itself; the user's choice wins after that
  const expanded = lanes.length > 0 && (open ?? (running && lanes.length > 1));
  const now = useNow(running);
  const solo = lanes.length === 1 && running ? lanes[0] : undefined;

  const rename = async () => {
    setEditing(false);
    if (title.trim() && title !== c.title) {
      await safe(api('PATCH', `/conversations/${encodeURIComponent(c.id)}${qs({ project })}`, { title: title.trim() }));
      void refreshList();
    }
  };
  const remove = async () => {
    if (!confirm(`Xoá "${c.title}" khỏi AgentDesk?\n(Session gốc của Claude/Codex vẫn giữ nguyên)`)) return;
    await safe(api('DELETE', `/conversations/${encodeURIComponent(c.id)}${qs({ project })}`));
    if (getState().convId === c.id) setState({ conv: undefined, convId: undefined });
    void refreshList();
  };

  const sub = [
    solo && [AGENT_NAME[solo.agent], modelLabel(catalog, solo.agent, solo.label), solo.activity].filter(Boolean).join(' · '),
    c.status === 'awaiting' && !solo ? 'Chờ bạn duyệt' : undefined,
    c.autoAt && c.status !== 'running' ? `Tự tiếp tục lúc ${clock(c.autoAt)}` : undefined,
    c.status === 'error' && !c.autoAt ? 'Gặp lỗi' : undefined,
  ].filter(Boolean)[0];

  return (
    <div className={cx('group rounded-lg', active ? 'bg-active' : 'hover:bg-hover')}>
      <div
        className="relative flex cursor-pointer items-start gap-2 px-2.5 py-1.5"
        onClick={() => !editing && void openConv(c.id)}
        title={`${c.title}\n${c.models.map((m) => modelLabel(catalog, undefined, m)).join(', ')}`}
      >
        <span className="mt-[3px] flex shrink-0 -space-x-1">
          {(c.agents.length ? c.agents : lanes.length ? [lanes[0].agent] : ['claude' as Agent]).map((a) => (
            <span key={a} className={cx('rounded-full p-px', active ? 'bg-active' : 'bg-sidebar')}>
              <AgentIcon agent={a} size={13} />
            </span>
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {editing ? (
              <input
                autoFocus
                value={title}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={rename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename();
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="min-w-0 flex-1 rounded border border-line bg-panel px-1 text-[13px] outline-none"
              />
            ) : (
              <span className={cx('min-w-0 flex-1 truncate text-[13px]', unread && 'font-semibold')}>{c.title}</span>
            )}
            {solo?.startedAt && <span className="shrink-0 text-[11px] tabular-nums text-faint">{elapsed(now - solo.startedAt)}</span>}
            <StatusMark c={c} unread={unread} />
          </div>
          {(c.branch || sub || lanes.length > 1) && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
              {lanes.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(!expanded);
                  }}
                  title={expanded ? 'Thu gọn' : 'Xem từng agent'}
                  className="-ml-1 flex shrink-0 items-center rounded hover:text-fg"
                >
                  <ChevronRight size={12} className={cx('transition-transform', expanded && 'rotate-90')} />
                  {lanes.length} {lanes[0].kind === 'agent' ? 'agent' : 'bước'}
                </button>
              )}
              {sub && <span className={cx('min-w-0 flex-1 truncate', c.status === 'error' && 'text-err/80', c.status === 'awaiting' && 'text-warn')}>{sub}</span>}
              {c.branch && (
                <span className={cx('flex min-w-0 items-center gap-0.5', sub ? 'ml-auto max-w-[45%] shrink-0 @max-[300px]/side:hidden' : 'shrink')} title={`Nhánh ${c.branch}`}>
                  <GitBranch size={11} className="shrink-0" />
                  <span className="truncate">{c.branch}</span>
                </span>
              )}
            </div>
          )}
        </div>
        {c.source === 'app' && !editing && (
          <Popover
            placement="bottom-end"
            width={170}
            trigger={(open, toggle) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
                className={cx('shrink-0 rounded p-0.5 text-muted hover:text-fg', open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
              >
                <MoreHorizontal size={15} />
              </button>
            )}
          >
            {(close) => (
              <div onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setTitle(c.title);
                    setEditing(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-hover"
                >
                  <Pencil size={13} /> Đổi tên
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void remove();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-err hover:bg-hover"
                >
                  <Trash2 size={13} /> Xoá
                </button>
              </div>
            )}
          </Popover>
        )}
      </div>
      {expanded && (
        <div className="mb-1 ml-[22px] mr-1.5 border-l border-line pl-1.5">
          {lanes.map((l) => (
            <LaneRow key={l.id} lane={l} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
