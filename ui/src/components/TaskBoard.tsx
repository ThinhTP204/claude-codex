import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { AlarmClock, Check, CircleAlert, GitBranch, Hand, Pencil, Play, Plus, Trash2, Workflow, X } from 'lucide-react';
import type { BacklogTask, ConversationSummary, SessionLane } from '../../../shared/types.ts';
import { addBacklog, openConv, removeBacklog, setConvDone, setState, startBacklog, toast, updateBacklog, useStore } from '../store.ts';
import { api, qs } from '../api.ts';
import { AGENT_NAME, AgentIcon, Spinner, cx, modelLabel } from './ui.tsx';

// Kanban of the project's work: tasks written down (backlog) and every session, placed by what its
// agents are doing. Only "Việc cần làm → Đang chạy" (start) and "→ Xong" (mark done) are moves the
// user makes; the other columns follow the real status.

type Col = 'backlog' | 'running' | 'awaiting' | 'paused' | 'done';

const COLS: { id: Col; title: string; hint: string; tone: string }[] = [
  { id: 'backlog', title: 'Việc cần làm', hint: 'Ghi task trước, kéo sang Đang chạy để giao cho agent', tone: 'bg-faint' },
  { id: 'running', title: 'Đang chạy', hint: 'Agent đang làm', tone: 'bg-accent' },
  { id: 'awaiting', title: 'Chờ duyệt', hint: 'Chờ bạn duyệt bước pipeline hoặc chọn bản chạy song song', tone: 'bg-warn' },
  { id: 'paused', title: 'Lỗi / tạm dừng', hint: 'Gặp lỗi, bị dừng, hoặc đang đợi tự tiếp tục', tone: 'bg-err' },
  { id: 'done', title: 'Xong', hint: 'Đã xong. Thẻ quá 3 ngày được ẩn bớt', tone: 'bg-ok' },
];

const OLD = 3 * 24 * 3600_000;

function columnOf(c: ConversationSummary): Col | undefined {
  if (c.status === 'running') return 'running';
  // put away by the user: stays in "Xong" until work starts again
  if (c.doneAt) return 'done';
  if (c.status === 'awaiting') return 'awaiting';
  if (c.autoAt || c.status === 'error' || c.status === 'stopped') return 'paused';
  if (c.status === 'done') return 'done';
}

type Drag = { kind: 'backlog' | 'session'; id: string };
const MIME = 'application/x-agentdesk-card';

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
const ago = (ts: number) => {
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  if (m < 1440) return `${Math.floor(m / 60)} giờ trước`;
  return `${Math.floor(m / 1440)} ngày trước`;
};

export function TaskBoard() {
  const project = useStore((s) => s.project);
  const list = useStore((s) => s.convList);
  const backlog = useStore((s) => s.backlog);
  const [showOld, setShowOld] = useState(false);
  const [over, setOver] = useState<Col>();
  const [starting, setStarting] = useState<BacklogTask>();

  const cols = useMemo(() => {
    const by: Record<Col, ConversationSummary[]> = { backlog: [], running: [], awaiting: [], paused: [], done: [] };
    for (const c of list) {
      const col = columnOf(c);
      if (col) by[col].push(c);
    }
    by.done.sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt));
    return by;
  }, [list]);
  const oldDone = cols.done.filter((c) => Date.now() - (c.doneAt ?? c.updatedAt) > OLD);
  const doneShown = showOld ? cols.done : cols.done.filter((c) => !oldDone.includes(c));

  const drop = async (col: Col, e: DragEvent) => {
    e.preventDefault();
    setOver(undefined);
    let d: Drag;
    try {
      d = JSON.parse(e.dataTransfer.getData(MIME));
    } catch {
      return;
    }
    if (d.kind === 'backlog') {
      const t = backlog.find((x) => x.id === d.id);
      if (!t) return;
      if (col === 'running') setStarting(t);
      else if (col === 'done') {
        if (confirm(`Bỏ task "${t.title}" khỏi danh sách?`)) void removeBacklog(t.id);
      } else if (col !== 'backlog') toast('Kéo sang "Đang chạy" để giao task cho agent.', 'info');
      return;
    }
    const c = list.find((x) => x.id === d.id);
    if (!c) return;
    const from = columnOf(c);
    if (col === from) return;
    if (col === 'done') {
      if (c.status === 'running') {
        if (!confirm(`"${c.title}" đang chạy. Dừng agent và chuyển sang Xong?`)) return;
        await api('POST', `/conversations/${encodeURIComponent(c.id)}/stop${qs({ project })}`).catch(() => {});
      } else if (c.status === 'awaiting' && c.stage?.steps) {
        if (!confirm(`Pipeline "${c.title}" đang chờ bạn duyệt. Dừng pipeline và chuyển sang Xong?`)) return;
        await api('POST', `/conversations/${encodeURIComponent(c.id)}/run-stop${qs({ project })}`).catch(() => {});
      }
      void setConvDone(c.id, true);
    } else if (from === 'done' && c.doneAt) {
      // taken back out of "Xong": it goes wherever its status says
      void setConvDone(c.id, false);
    } else toast('Cột này do app tự xếp theo trạng thái của agent. Mở session để làm tiếp.', 'info');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="text-[14px] font-semibold">Tasks</span>
        <span className="text-[12.5px] text-faint">{project?.split(/[\\/]/).pop()}</span>
        <span className="ml-auto text-[12px] text-faint">Kéo thẻ sang Đang chạy để bắt đầu, sang Xong để cất đi</span>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {COLS.map((col) => {
          const items = col.id === 'done' ? doneShown : cols[col.id];
          const count = col.id === 'backlog' ? backlog.length : cols[col.id].length;
          return (
            <section
              key={col.id}
              onDragOver={(e) => {
                if (![...e.dataTransfer.types].includes(MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(col.id);
              }}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(undefined)}
              onDrop={(e) => void drop(col.id, e)}
              className={cx('flex w-[272px] min-w-[240px] shrink-0 flex-col rounded-xl bg-sidebar/70 transition-colors', over === col.id && 'bg-accent/10 ring-1 ring-accent/50')}
            >
              <header className="flex items-center gap-2 px-3 pb-1.5 pt-2.5" title={col.hint}>
                <span className={cx('h-2 w-2 rounded-full', col.tone)} />
                <span className="text-[12.5px] font-semibold">{col.title}</span>
                <span className="text-[12px] tabular-nums text-faint">{count}</span>
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {col.id === 'backlog' && <NewTask />}
                {col.id === 'backlog'
                  ? backlog.map((t) => <BacklogCard key={t.id} t={t} onStart={() => setStarting(t)} />)
                  : items.map((c) => <SessionCard key={c.id} c={c} />)}
                {col.id === 'done' && oldDone.length > 0 && (
                  <button type="button" onClick={() => setShowOld(!showOld)} className="w-full rounded-lg py-1.5 text-[12px] text-faint hover:bg-hover hover:text-fg">
                    {showOld ? 'Ẩn thẻ cũ' : `Hiện ${oldDone.length} thẻ cũ hơn 3 ngày`}
                  </button>
                )}
                {col.id !== 'backlog' && items.length === 0 && <div className="px-2 py-6 text-center text-[12px] text-faint">{col.hint}</div>}
              </div>
            </section>
          );
        })}
      </div>
      {starting && <StartDialog task={starting} onClose={() => setStarting(undefined)} />}
    </div>
  );
}

function dragProps(d: Drag) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(MIME, JSON.stringify(d));
      e.dataTransfer.effectAllowed = 'move';
    },
  };
}

function NewTask() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const add = () => {
    if (!title.trim()) return;
    // clear first: typing the next task must not land in this one while it saves
    void addBacklog(title.trim(), note.trim() || undefined);
    setTitle('');
    setNote('');
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-muted hover:bg-hover hover:text-fg">
        <Plus size={14} /> Thêm task
      </button>
    );
  return (
    <div className="rounded-lg border border-line bg-panel p-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) add();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Tên task, vd Thêm đăng nhập Google"
        className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Mô tả thêm (không bắt buộc)"
        className="mt-1.5 w-full resize-y rounded-md bg-bg/60 px-1.5 py-1 text-[12.5px] outline-none placeholder:text-faint"
      />
      <div className="mt-1.5 flex justify-end gap-1">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-0.5 text-[12.5px] text-muted hover:bg-hover">
          Đóng
        </button>
        <button type="button" disabled={!title.trim()} onClick={add} className="rounded-md bg-accent px-2.5 py-0.5 text-[12.5px] font-medium text-white disabled:opacity-40">
          Thêm
        </button>
      </div>
    </div>
  );
}

function BacklogCard({ t, onStart }: { t: BacklogTask; onStart: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [note, setNote] = useState(t.note ?? '');
  if (editing)
    return (
      <div className="rounded-lg border border-accent/50 bg-panel p-2">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-transparent text-[13px] font-medium outline-none" />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Mô tả thêm" className="mt-1 w-full resize-y rounded-md bg-bg/60 px-1.5 py-1 text-[12.5px] outline-none placeholder:text-faint" />
        <div className="mt-1 flex justify-end gap-1">
          <button type="button" onClick={() => setEditing(false)} className="rounded-md px-2 py-0.5 text-[12.5px] text-muted hover:bg-hover">
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => {
              void updateBacklog(t.id, { title, note });
              setEditing(false);
            }}
            className="rounded-md bg-accent px-2.5 py-0.5 text-[12.5px] font-medium text-white"
          >
            Lưu
          </button>
        </div>
      </div>
    );
  return (
    <div {...dragProps({ kind: 'backlog', id: t.id })} className="group cursor-grab rounded-lg border border-line bg-panel p-2.5 shadow-sm active:cursor-grabbing">
      <div className="text-[13px] font-medium leading-snug">{t.title}</div>
      {t.note && <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] text-muted">{t.note}</div>}
      <div className="mt-2 flex items-center gap-1">
        <span className="text-[11.5px] text-faint">{ago(t.createdAt)}</span>
        <div className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" title="Sửa" onClick={() => setEditing(true)} className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
            <Pencil size={12} />
          </button>
          <button type="button" title="Xoá" onClick={() => confirm(`Xoá task "${t.title}"?`) && void removeBacklog(t.id)} className="rounded p-1 text-muted hover:bg-hover hover:text-err">
            <Trash2 size={12} />
          </button>
        </div>
        <button type="button" onClick={onStart} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-accent hover:bg-accent/10">
          <Play size={11} /> Bắt đầu
        </button>
      </div>
    </div>
  );
}

function StatusIcon({ c }: { c: ConversationSummary }) {
  if (c.status === 'running') return <Spinner size={12} className="text-accent" />;
  if (c.status === 'awaiting') return <Hand size={12} className="text-warn" />;
  if (c.autoAt) return <AlarmClock size={12} className="text-accent" />;
  if (c.status === 'error') return <CircleAlert size={12} className="text-err" />;
  if (c.status === 'stopped') return <X size={12} className="text-faint" />;
  return <Check size={12} className="text-ok" />;
}

const stepTone = (l: SessionLane) =>
  l.status === 'done' ? 'bg-ok' : l.status === 'running' ? 'bg-accent animate-pulse' : l.status === 'awaiting' ? 'bg-warn' : l.status === 'error' ? 'bg-err' : 'bg-line';

function SessionCard({ c }: { c: ConversationSummary }) {
  const catalog = useStore((s) => s.catalog);
  const unread = useStore((s) => !!s.unread[c.id]);
  const now = useNow(c.status === 'running');
  const lanes = c.lanes ?? [];
  const steps = lanes[0]?.kind === 'step' ? lanes : [];
  // the agent that matters now: the one running, else the most recent
  const lane = lanes.find((l) => l.status === 'running' || l.status === 'awaiting') ?? (steps.length ? [...steps].reverse().find((l) => l.status !== 'idle') : lanes[0]);
  const line = lane?.activity ?? lane?.text;
  let time: ReactNode = null;
  if (lane?.status === 'running' && lane.startedAt) time = elapsed(now - lane.startedAt);
  else if (c.doneAt) time = ago(c.doneAt);
  else time = ago(c.updatedAt);

  return (
    <div
      {...dragProps({ kind: 'session', id: c.id })}
      onClick={() => {
        void openConv(c.id);
        setState({ activeTab: 'chat' });
      }}
      title="Bấm để mở session"
      className={cx('cursor-pointer rounded-lg border bg-panel p-2.5 shadow-sm transition-colors hover:border-line-strong', unread ? 'border-accent/50' : 'border-line')}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-[3px] grid w-3 shrink-0 place-items-center">
          <StatusIcon c={c} />
        </span>
        <div className={cx('line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug', unread && 'font-semibold')}>{c.title}</div>
        {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
      </div>
      {c.stage && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-hover px-1.5 py-0.5 text-[11.5px] font-medium">
            {c.stage.icon ? <span>{c.stage.icon}</span> : <Workflow size={11} />}
            {c.stage.name}
          </span>
          {c.stage.steps && (
            <span className="text-[11.5px] tabular-nums text-faint">
              bước {c.stage.step}/{c.stage.steps}
            </span>
          )}
        </div>
      )}
      {steps.length > 1 && (
        <div className="mt-1.5 flex gap-0.5" title={steps.map((s) => `${s.label}: ${s.status}`).join('\n')}>
          {steps.map((s) => (
            <span key={s.id} className={cx('h-1 flex-1 rounded-full', stepTone(s))} />
          ))}
        </div>
      )}
      {lane && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px]">
          <AgentIcon agent={lane.agent} size={12} />
          <span className="truncate font-medium">{modelLabel(catalog, lane.agent, lane.model) || AGENT_NAME[lane.agent]}</span>
          <span className="ml-auto shrink-0 tabular-nums text-faint">{time}</span>
        </div>
      )}
      {line && <div className={cx('mt-0.5 line-clamp-2 text-[12px]', lane?.status === 'error' ? 'text-err/80' : lane?.activity ? 'text-muted' : 'text-faint')}>{line}</div>}
      {c.branch && (
        <div className="mt-1.5 flex items-center gap-0.5 text-[11px] text-faint">
          <GitBranch size={10} />
          <span className="truncate">{c.branch}</span>
        </div>
      )}
    </div>
  );
}

/** "Giao cho ai?": a role (one agent) or a pipeline. */
function StartDialog({ task, onClose }: { task: BacklogTask; onClose: () => void }) {
  const roles = useStore((s) => s.roles);
  const pipelines = useStore((s) => s.pipelines);
  const catalog = useStore((s) => s.catalog);
  const [busy, setBusy] = useState(false);
  const go = async (how: Parameters<typeof startBacklog>[1]) => {
    setBusy(true);
    const ok = await startBacklog(task, how);
    setBusy(false);
    if (ok) onClose();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 p-6" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-[460px] max-w-full rounded-2xl border border-line bg-panel p-4 shadow-pop">
        <div className="text-[15px] font-semibold">Giao task cho ai?</div>
        <div className="mt-1 text-[13px] text-muted">{task.title}</div>
        <div className="mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Một agent</div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              onClick={() => void go({ role: r })}
              className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left hover:border-accent/60 hover:bg-accent/5 disabled:opacity-50"
            >
              <span className="text-[16px]">{r.icon}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{r.name}</span>
                <span className="flex items-center gap-1 truncate text-[11.5px] text-faint">
                  <AgentIcon agent={r.config.agent} size={10} /> {modelLabel(catalog, r.config.agent, r.config.model)}
                </span>
              </span>
            </button>
          ))}
        </div>
        {pipelines.length > 0 && (
          <>
            <div className="mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Pipeline</div>
            <div className="mt-1.5 space-y-1">
              {pipelines.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void go({ pipeline: p })}
                  className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-[13px] hover:border-accent/60 hover:bg-accent/5 disabled:opacity-50"
                >
                  <Workflow size={14} className="text-accent" />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          {busy && <Spinner size={14} />}
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] hover:bg-hover">
            Huỷ
          </button>
        </div>
      </div>
    </div>
  );
}
