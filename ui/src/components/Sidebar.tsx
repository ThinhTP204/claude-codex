import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, SquareKanban, Bell, BellOff, ChevronDown, ChevronRight, Circle, CircleAlert, CircleCheck, CircleStop, MessageSquare, GitBranch, Hand, Monitor, Moon, MoreHorizontal, PanelLeftClose, Sun, Pencil, Plus, RefreshCw, Search, Trash2, Users, Workflow } from 'lucide-react';
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
        <button type="button" onClick={() => setState({ activeTab: 'tasks' })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg">
          <SquareKanban size={15} /> Tasks
          <TaskCounts />
        </button>
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

/** Small counters next to "Tasks": running and waiting for you. */
function TaskCounts() {
  const list = useStore((s) => s.convList);
  const running = list.filter((c) => c.status === 'running').length;
  const waiting = list.filter((c) => c.status === 'awaiting').length;
  return (
    <span className="ml-auto flex items-center gap-1 text-[11px] tabular-nums">
      {running > 0 && <span className="rounded-full bg-accent/15 px-1.5 text-accent" title={`${running} đang chạy`}>{running}</span>}
      {waiting > 0 && <span className="rounded-full bg-warn/15 px-1.5 text-warn" title={`${waiting} chờ duyệt`}>{waiting}</span>}
    </span>
  );
}

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

/** Left of the session name: what the session as a whole is doing. */
function StatusMark({ c, unread }: { c: ConversationSummary; unread: boolean }) {
  if (c.status === 'running') return <Spinner size={12} className="text-accent" />;
  if (c.status === 'awaiting') return <Hand size={12} className="text-warn" aria-label="Chờ bạn duyệt" />;
  if (c.autoAt) return <AlarmClock size={12} className="text-accent" aria-label={`Tự tiếp tục lúc ${clock(c.autoAt)}`} />;
  if (c.status === 'error') return <CircleAlert size={12} className={cx('text-err', !unread && 'opacity-60')} aria-label="Gặp lỗi" />;
  if (unread) return <span className="h-2 w-2 rounded-full bg-accent" aria-label="Có kết quả mới" />;
  return <MessageSquare size={12} className="text-faint/70" />;
}

const ago = (ts: number) => {
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút`;
  if (m < 1440) return `${Math.floor(m / 60)} giờ`;
  return `${Math.floor(m / 1440)} ngày`;
};

function LaneStatus({ status }: { status: SessionLane['status'] }) {
  if (status === 'running') return <Spinner size={11} className="text-accent" />;
  if (status === 'awaiting') return <Hand size={11} className="text-warn" />;
  if (status === 'error') return <CircleAlert size={11} className="text-err" />;
  if (status === 'done') return <CircleCheck size={11} className="text-ok" />;
  if (status === 'stopped') return <CircleStop size={11} className="text-faint" />;
  return <Circle size={11} className="text-faint/60" />;
}

/** One agent (or pipeline step) inside a session: status, AI, model, time, then what it does / said. */
function LaneRow({ lane, now }: { lane: SessionLane; now: number }) {
  const catalog = useStore((s) => s.catalog);
  const model = modelLabel(catalog, lane.agent, lane.model) || AGENT_NAME[lane.agent];
  const time = lane.status === 'running' && lane.startedAt ? elapsed(now - lane.startedAt) : lane.endedAt ? ago(lane.endedAt) : lane.durationMs ? elapsed(lane.durationMs) : '';
  const line = lane.activity ?? lane.text ?? (lane.status === 'idle' ? 'Chưa chạy' : lane.status === 'stopped' ? 'Đã dừng' : undefined);
  return (
    <div className={cx('rounded-md px-1.5 py-1', lane.status === 'idle' && 'opacity-55')} title={`${AGENT_NAME[lane.agent]} · ${model}${line ? `\n${line}` : ''}`}>
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <span className="grid w-3 shrink-0 place-items-center">
          <LaneStatus status={lane.status} />
        </span>
        <AgentIcon agent={lane.agent} size={13} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {lane.label && <span className="text-muted">{lane.label} · </span>}
          {model}
        </span>
        {time && <span className="shrink-0 text-[11px] tabular-nums text-faint">{time}</span>}
      </div>
      {line && <div className={cx('mt-0.5 truncate pl-[38px] text-[12px]', lane.status === 'error' ? 'text-err/80' : lane.activity ? 'text-muted' : 'text-faint')}>{line}</div>}
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
  // sessions at work, the open one and unseen results show their agents; the user's choice wins after that
  const expanded = lanes.length > 0 && (open ?? (isLive(c) || active || unread));
  const now = useNow(running);

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

  const isStep = lanes[0]?.kind === 'step';

  return (
    <div className={cx('group rounded-lg', active ? 'bg-active' : 'hover:bg-hover')}>
      <div className="relative flex cursor-pointer items-start gap-2 px-2.5 py-1.5" onClick={() => !editing && void openConv(c.id)} title={c.title}>
        <span className="mt-[3px] grid h-3.5 w-3 shrink-0 place-items-center">
          <StatusMark c={c} unread={unread} />
        </span>
        <div className="min-w-0 flex-1">
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
              className="w-full rounded border border-line bg-panel px-1 text-[13px] outline-none"
            />
          ) : (
            <div className={cx('truncate text-[13px]', unread && 'font-semibold')}>{c.title}</div>
          )}
          {(c.branch || (c.autoAt && !running)) && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
              {c.branch && (
                <span className="flex min-w-0 items-center gap-0.5" title={`Nhánh ${c.branch}`}>
                  <GitBranch size={11} className="shrink-0" />
                  <span className="truncate">{c.branch}</span>
                </span>
              )}
              {c.autoAt && !running && <span className="shrink-0 text-accent">Tự tiếp tục lúc {clock(c.autoAt)}</span>}
            </div>
          )}
        </div>
        {lanes.length > 0 && !expanded && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            title={isStep ? 'Xem các bước' : 'Xem agent'}
            className="mt-px shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-fg group-hover:opacity-100"
          >
            <ChevronRight size={14} />
          </button>
        )}
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
        <div className="pb-1 pl-[22px] pr-1.5">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint hover:text-fg"
          >
            <ChevronDown size={11} />
            {isStep ? 'Bước' : 'Agent'} ({lanes.length})
          </button>
          {lanes.map((l) => (
            <LaneRow key={l.id} lane={l} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
