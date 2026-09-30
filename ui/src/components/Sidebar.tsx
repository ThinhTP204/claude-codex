import { useMemo, useState } from 'react';
import { Monitor, Moon, MoreHorizontal, PanelLeftClose, Sun, Pause, Pencil, Plus, RefreshCw, Search, Trash2, Users, Workflow } from 'lucide-react';
import type { Agent, ConversationSummary } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import { getState, newConv, openConv, refreshList, safe, setState, useStore } from '../store.ts';
import { ProjectSwitcher } from './ProjectMenu.tsx';
import { UsagePanel } from './UsagePanel.tsx';
import { UpdateBadge } from './UpdateDialog.tsx';
import { cycleTheme, useThemePref } from '../theme.ts';
import { AgentIcon, Popover, Spinner, cx, modelLabel } from './ui.tsx';

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
  const [filter, setFilter] = useState<'all' | 'app' | Agent>('all');

  const groups = useMemo(() => {
    const ql = q.toLowerCase();
    const items = list.filter(
      (c) =>
        (!ql || c.title.toLowerCase().includes(ql)) &&
        (filter === 'all' || (filter === 'app' ? c.source === 'app' : c.agents.includes(filter))),
    );
    const g = new Map<string, ConversationSummary[]>();
    for (const c of items) {
      const k = groupOf(c.updatedAt);
      g.set(k, [...(g.get(k) || []), c]);
    }
    return [...g.entries()];
  }, [list, q, filter]);

  return (
    <aside className="flex h-full flex-col bg-sidebar">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        {/* clicking the name opens the (otherwise hidden) updater: version + "check for updates" */}
        <button type="button" onClick={() => setState({ showUpdate: true })} title="Phiên bản & cập nhật" className="flex items-center gap-2 rounded-md">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-accent text-[13px] font-bold text-white">A</div>
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
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm session…" className="w-full rounded-lg bg-transparent py-1.5 pl-8 pr-2 text-[13px] outline-none placeholder:text-faint hover:bg-hover/60 focus:bg-hover/60" />
        </div>
        <div className="flex gap-1 px-1 pb-1 text-[11.5px]">
          {(
            [
              ['all', 'Tất cả'],
              ['app', 'AgentDesk'],
              ['claude', 'Claude'],
              ['codex', 'Codex'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={cx('whitespace-nowrap rounded-md px-1.5 py-0.5', filter === k ? 'bg-active text-fg' : 'text-faint hover:text-fg')}>
              {label}
            </button>
          ))}
          <button type="button" title="Làm mới" onClick={() => void refreshList()} className="ml-auto rounded-md px-1 text-faint hover:text-fg">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
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

      <UpdateBadge />
      <div className="space-y-0.5 border-t border-line px-2 py-2">
        <button type="button" onClick={() => setState({ activeTab: 'flow' })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg">
          <Workflow size={15} /> Pipelines
        </button>
        <button type="button" onClick={() => setState({ showRoles: true })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg">
          <Users size={15} /> Vai trò & model
        </button>
        <UsagePanel />
      </div>
    </aside>
  );
}

function SessionItem({ c, active }: { c: ConversationSummary; active: boolean }) {
  const catalog = useStore((s) => s.catalog);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  const project = useStore((s) => s.project);

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

  return (
    <div
      className={cx('group relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5', active ? 'bg-active' : 'hover:bg-hover')}
      onClick={() => !editing && void openConv(c.id)}
      title={`${c.title}\n${c.models.map((m) => modelLabel(catalog, undefined, m)).join(', ')}`}
    >
      <span className="flex shrink-0 -space-x-1">
        {(c.agents.length ? c.agents : ['claude' as Agent]).map((a) => (
          <span key={a} className="rounded-full bg-sidebar p-px">
            <AgentIcon agent={a} size={13} />
          </span>
        ))}
      </span>
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
        <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
      )}
      {c.running || c.runStatus === 'running' ? (
        <Spinner size={12} className="shrink-0 text-accent" />
      ) : c.runStatus === 'awaiting' ? (
        <Pause size={12} className="shrink-0 text-warn" />
      ) : null}
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
  );
}
