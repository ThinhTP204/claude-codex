import { lazy, Suspense, useEffect, useState } from 'react';
import { Check, CircleAlert, CircleStop, FileDiff, GitFork, Plus, Square, Trash2, X } from 'lucide-react';
import type { Agent, Conversation, Fanout, FanoutAttempt, RunConfig } from '../../../shared/types.ts';
import { AGENTS } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import { convAction, ensureConv, getState, LS, safe, toast, useStore } from '../store.ts';
import { Markdown } from './Message.tsx';
import { AGENT_NAME, AgentIcon, Popover, Spinner, cx, fmtDuration, modelLabel } from './ui.tsx';

// "Chạy song song": one task, 2–5 agents, each in its own git worktree; compare, then apply one.

const FanoutDiff = lazy(() => import('./FanoutDiff.tsx').then((m) => ({ default: m.FanoutDiff })));

const MAX = 5;

function defaultRows(composer: RunConfig): RunConfig[] {
  const other: Agent = composer.agent === 'claude' ? 'codex' : 'claude';
  return [composer, { ...composer, agent: other, model: '', effort: undefined, fast: undefined }];
}

/** Button + popover in the composer: pick the agents, then run the typed task on all of them. */
export function ParallelButton({ disabled, getTask, onStarted }: { disabled: boolean; getTask: () => string | undefined; onStarted: () => void }) {
  const composer = useStore((s) => s.composer);
  const catalog = useStore((s) => s.catalog);
  const health = useStore((s) => s.health);
  const [rows, setRowsRaw] = useState<RunConfig[]>(() => LS.get<RunConfig[] | null>('fanoutRows', null) ?? defaultRows(composer));
  const [busy, setBusy] = useState(false);
  const setRows = (r: RunConfig[]) => {
    LS.set('fanoutRows', r);
    setRowsRaw(r);
  };
  const usable = AGENTS.filter((a) => !health || health[a]?.installed || a === composer.agent);
  const models = (a: Agent) => catalog?.[a] ?? [];
  const modelOf = (r: RunConfig) => r.model || models(r.agent)[0]?.id || '';

  const start = async (close: () => void) => {
    const task = getTask();
    if (!task) return toast('Nhập task vào ô chat trước, rồi chạy song song.', 'info');
    setBusy(true);
    const c = await ensureConv();
    const configs = rows.map((r) => ({ ...r, model: modelOf(r), permission: composer.permission === 'read' ? 'write' : composer.permission }) as RunConfig);
    const ok = c && (await safe(api('POST', `/conversations/${encodeURIComponent(c.id)}/fanout${qs({ project: getState().project })}`, { task, configs })));
    setBusy(false);
    if (ok) {
      close();
      onStarted();
    }
  };

  return (
    <Popover
      placement="top-end"
      width={340}
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          title="Giao cùng task cho nhiều agent cùng lúc rồi chọn bản tốt nhất"
          className={cx('inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40', open && 'bg-hover')}
        >
          <GitFork size={14} /> <span className="@max-3xl/composer:hidden">Song song</span>
        </button>
      )}
    >
      {(close) => (
        <div className="p-2">
          <div className="px-1 text-[13px] font-medium">Chạy song song</div>
          <p className="px-1 pb-2 pt-0.5 text-[12px] leading-snug text-faint">Mỗi agent làm task trong ô chat trên một bản sao riêng của project (git worktree). Xong thì so sánh và chọn một bản để đưa vào project.</p>
          <div className="space-y-1">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="flex shrink-0 rounded-lg border border-line p-0.5">
                  {usable.map((a) => (
                    <button
                      key={a}
                      type="button"
                      title={AGENT_NAME[a]}
                      onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, agent: a, model: '', effort: undefined, fast: undefined } : x)))}
                      className={cx('rounded-md p-1', r.agent === a ? 'bg-active' : 'opacity-50 hover:opacity-100')}
                    >
                      <AgentIcon agent={a} size={14} />
                    </button>
                  ))}
                </div>
                <select
                  value={modelOf(r)}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, model: e.target.value, effort: undefined } : x)))}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-1.5 text-[12.5px] outline-none"
                >
                  {models(r.agent).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {!models(r.agent).some((m) => m.id === modelOf(r)) && modelOf(r) && <option value={modelOf(r)}>{modelOf(r)}</option>}
                </select>
                <button type="button" title="Bỏ" disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="rounded p-1 text-faint hover:bg-hover hover:text-fg disabled:opacity-30">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={rows.length >= MAX}
              onClick={() => setRows([...rows, { ...rows[rows.length - 1] }])}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              <Plus size={13} /> Thêm agent
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void start(close)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {busy ? <Spinner size={13} /> : <GitFork size={13} />} Chạy {rows.length} agent
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const STATUS_TEXT: Record<Fanout['status'], string> = {
  running: 'Đang chạy',
  ready: 'Chọn một bản để đưa vào project',
  merged: 'Đã đưa vào project',
  discarded: 'Đã bỏ',
};

/** Results of a parallel run, shown under the message that started it. */
export function FanoutPanel({ conv, f }: { conv: Conversation; f: Fanout }) {
  const catalog = useStore((s) => s.catalog);
  const lanes = useStore((s) => s.convList.find((c) => c.id === conv.id)?.lanes);
  const now = useNow(f.status === 'running');
  const [diffOf, setDiffOf] = useState<FanoutAttempt>();
  const [busy, setBusy] = useState<string>();
  const live = f.status === 'running' || f.status === 'ready';
  const label = (a: FanoutAttempt) => `${AGENT_NAME[a.config.agent]} · ${modelLabel(catalog, a.config.agent, a.config.model)}`;

  const choose = async (a: FanoutAttempt) => {
    if (!confirm(`Đưa thay đổi của ${label(a)} vào project?\nCác bản còn lại sẽ bị xoá.`)) return;
    setBusy(a.id);
    const ok = await convAction(`fanout/${f.id}/choose`, { attempt: a.id });
    setBusy(undefined);
    if (ok) toast(`Đã đưa thay đổi của ${label(a)} vào project. Xem lại trong Source Control rồi commit.`, 'info');
  };
  const discard = async () => {
    if (!confirm('Bỏ tất cả các bản? Thay đổi của các agent sẽ bị xoá.')) return;
    setBusy('all');
    await convAction(`fanout/${f.id}/discard`);
    setBusy(undefined);
  };

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px]">
        <GitFork size={14} className="text-accent" />
        <span className="font-medium">Chạy song song · {f.attempts.length} agent</span>
        <span className={cx('text-[12px]', f.status === 'ready' ? 'text-warn' : 'text-faint')}>{STATUS_TEXT[f.status]}</span>
        <div className="ml-auto flex items-center gap-1">
          {f.status === 'running' && (
            <button type="button" onClick={() => void convAction(`fanout/${f.id}/stop`)} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12.5px] text-muted hover:bg-hover hover:text-fg">
              <Square size={11} /> Dừng tất cả
            </button>
          )}
          {f.status === 'ready' && (
            <button type="button" disabled={!!busy} onClick={discard} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12.5px] text-muted hover:bg-hover hover:text-err">
              <Trash2 size={11} /> Bỏ hết
            </button>
          )}
        </div>
      </div>
      <div className={cx('grid gap-2 p-2', live ? 'grid-cols-[repeat(auto-fit,minmax(220px,1fr))]' : 'grid-cols-1')}>
        {f.attempts.map((a) => {
          const lane = lanes?.find((l) => l.id === a.id);
          const chosen = f.chosen === a.id;
          const time = a.status === 'running' ? fmtDuration(now - a.startedAt).replace(/\.\d+s/, 's') : fmtDuration(a.durationMs);
          if (!live)
            return (
              <div key={a.id} className={cx('flex items-center gap-2 rounded-lg px-2 py-1 text-[12.5px]', chosen ? 'bg-accent/10' : 'text-faint')}>
                <AgentIcon agent={a.config.agent} size={13} />
                <span className={cx('truncate', chosen && 'font-medium text-fg')}>{label(a)}</span>
                {a.stat && (
                  <span className="shrink-0 tabular-nums">
                    {a.stat.files} file · <span className="text-ok">+{a.stat.additions}</span> <span className="text-err">−{a.stat.deletions}</span>
                  </span>
                )}
                {chosen && (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-accent">
                    <Check size={12} /> Đã chọn
                  </span>
                )}
              </div>
            );
          const changed = !!a.stat?.files;
          return (
            <div key={a.id} className="flex min-w-0 flex-col rounded-lg border border-line bg-bg/40 p-2.5">
              <div className="flex items-center gap-1.5 text-[13px]">
                <AgentIcon agent={a.config.agent} size={15} />
                <span className="min-w-0 flex-1 truncate font-medium" title={label(a)}>
                  {label(a)}
                </span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-faint">{time}</span>
                {a.status === 'running' ? (
                  <Spinner size={12} className="shrink-0 text-accent" />
                ) : a.status === 'done' ? (
                  <Check size={13} className="shrink-0 text-ok" />
                ) : a.status === 'error' ? (
                  <CircleAlert size={13} className="shrink-0 text-err" />
                ) : (
                  <CircleStop size={13} className="shrink-0 text-faint" />
                )}
              </div>
              {a.status === 'running' && <div className="mt-1 truncate text-[12px] text-muted">{lane?.activity ?? 'Đang khởi động'}</div>}
              {a.stat && (
                <div className="mt-1 text-[12px] tabular-nums text-faint">
                  {changed ? (
                    <>
                      {a.stat.files} file · <span className="text-ok">+{a.stat.additions}</span> <span className="text-err">−{a.stat.deletions}</span>
                    </>
                  ) : (
                    'Không sửa file nào'
                  )}
                </div>
              )}
              {a.error && <div className="mt-1 line-clamp-3 text-[12px] text-err">{a.error}</div>}
              {a.answer && <Answer text={a.answer} />}
              {a.status !== 'running' && (
                <div className="mt-auto flex items-center gap-1 pt-2">
                  <button
                    type="button"
                    disabled={!changed}
                    onClick={() => setDiffOf(a)}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[12.5px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                  >
                    <FileDiff size={12} /> Xem thay đổi
                  </button>
                  {f.status === 'ready' && (
                    <button
                      type="button"
                      disabled={!changed || !!busy}
                      onClick={() => void choose(a)}
                      className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[12.5px] font-medium text-white disabled:opacity-40"
                    >
                      {busy === a.id ? <Spinner size={11} /> : <Check size={12} />} Chọn bản này
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {diffOf && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35">
              <Spinner />
            </div>
          }
        >
          <FanoutDiff conv={conv} f={f} a={diffOf} title={label(diffOf)} onClose={() => setDiffOf(undefined)} onChoose={f.status === 'ready' ? () => (setDiffOf(undefined), void choose(diffOf)) : undefined} />
        </Suspense>
      )}
    </div>
  );
}

function Answer({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  return (
    <div className="mt-1.5 text-[12.5px]">
      <div className={cx('prose-sm overflow-hidden', !open && long && 'max-h-28 [mask-image:linear-gradient(black_70%,transparent)]')}>
        <Markdown text={text} />
      </div>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="text-[12px] text-accent hover:underline">
          {open ? 'Thu gọn' : 'Xem hết'}
        </button>
      )}
    </div>
  );
}
