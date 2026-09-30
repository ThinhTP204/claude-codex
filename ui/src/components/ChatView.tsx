import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronRight, FolderOpen, Pause, Pencil, Play, RotateCcw, Square, ThumbsDown, ThumbsUp, Workflow, X } from 'lucide-react';
import type { Agent, Conversation, NodeRunState, PipelineRun, RunConfig } from '../../../shared/types.ts';
import { convAction, ensureConv, getState, hideRun, pickProject, safe, sendMessage, setComposer, setState, toast, useStore } from '../store.ts';
import { api, qs } from '../api.ts';
import { ConfigPicker } from './ConfigPicker.tsx';
import { reviewSections } from '../../../shared/verdict.ts';
import { AttachButton, AttachmentChip } from './Attachments.tsx';
import { type Attachment, REF_MIME, isImage, uploadFile, withAttachments } from '../attachments.ts';
import { ProjectChip } from './ProjectMenu.tsx';
import { TurnView, Markdown } from './Message.tsx';
import { AGENT_NAME, AgentIcon, EFFORT_LABEL, Popover, Spinner, cx, fmtDuration, fmtTokens, fmtUsage, inputCls, modelLabel } from './ui.tsx';

export function ChatView() {
  const project = useStore((s) => s.project);
  const conv = useStore((s) => s.conv);
  const drafts = useStore((s) => s.drafts);
  const loading = useStore((s) => s.convLoading);
  const hiddenRuns = useStore((s) => s.hiddenRuns);
  // a run the user closed stays hidden until a new run starts (new id)
  const hidden = !!conv?.run && conv.run.status !== 'running' && conv.run.status !== 'awaiting' && hiddenRuns.includes(conv.run.id);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    stick.current = true;
  }, [conv?.id]);

  if (!project) return <NoProject />;
  const empty = !conv || conv.turns.length === 0;

  if (loading)
    return (
      <div className="grid h-full place-items-center text-muted">
        <span className="inline-flex items-center gap-2">
          <Spinner /> Đang tải session…
        </span>
      </div>
    );

  if (empty) return <Welcome />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {conv?.run && !hidden && <RunBar run={conv.run} />}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl space-y-6 px-6 pb-8 pt-6">
          {conv!.turns.map((t) => (
            <TurnView key={t.id} t={t} draft={drafts[t.id]} />
          ))}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        {/* the big card only when the user has something to decide: approve a step, or read an error */}
        {conv?.run && !hidden && ['awaiting', 'error'].includes(conv.run.status) && conv.run.current && <ApprovalCard conv={conv} run={conv.run} />}
        <RoleChips />
        <Composer />
      </div>
    </div>
  );
}

function NoProject() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="text-2xl font-semibold">Chọn một project để bắt đầu</div>
      <p className="max-w-md text-muted">AgentDesk làm việc trong một thư mục trên máy. Chọn thư mục project để xem file, session cũ và giao việc cho Claude / Codex.</p>
      <button type="button" onClick={pickProject} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 font-medium text-white hover:opacity-90">
        <FolderOpen size={16} /> Mở thư mục… <kbd className="text-[11px] opacity-80">⌘O</kbd>
      </button>
    </div>
  );
}

function Welcome() {
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-10">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-3 text-[30px] font-semibold tracking-tight">
            <AgentIcon agent="claude" size={30} />
            {greet}, giao việc gì hôm nay?
          </div>
          <div className="mt-2 flex items-center justify-center gap-1 text-[13px] text-muted">
            Đang làm trong <ProjectChip />
            <span className="text-faint">·</span>
            <button type="button" className="rounded-lg px-2 py-1 hover:bg-hover hover:text-fg" onClick={() => setState({ activeTab: 'flow' })}>
              <Workflow size={13} className="mr-1 inline text-accent" />
              Thiết kế pipeline
            </button>
          </div>
        </div>
        <Composer autoFocus />
        <div className="mt-3">
          <RoleChips centered />
        </div>
      </div>
    </div>
  );
}

/** Round status dot of a pipeline step. */
function StepDot({ st }: { st: NodeRunState }) {
  const base = 'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full';
  switch (st.status) {
    case 'running':
      return (
        <span className={cx(base, 'bg-accent/15 text-accent')}>
          <Spinner size={11} />
        </span>
      );
    case 'awaiting':
      return (
        <span className={cx(base, 'relative bg-warn text-white')}>
          <span className="absolute inset-0 animate-ping rounded-full bg-warn/40" />
          <Pause size={9} fill="currentColor" strokeWidth={0} className="relative" />
        </span>
      );
    case 'done':
      return st.verdict === 'fail' ? (
        <span className={cx(base, 'bg-err text-white')}>
          <X size={11} strokeWidth={3} />
        </span>
      ) : (
        <span className={cx(base, 'bg-ok text-white')}>
          <Check size={11} strokeWidth={3} />
        </span>
      );
    case 'error':
      return (
        <span className={cx(base, 'bg-err text-white')}>
          <X size={11} strokeWidth={3} />
        </span>
      );
    case 'stopped':
      return (
        <span className={cx(base, 'border border-line-strong text-muted')}>
          <Square size={7} fill="currentColor" />
        </span>
      );
    default:
      return <span className={cx(base, 'border-[1.5px] border-line-strong')} />;
  }
}

const RUN_BADGE: Record<PipelineRun['status'], [string, string]> = {
  running: ['Đang chạy', 'bg-accent/12 text-accent'],
  awaiting: ['Chờ duyệt', 'bg-warn/15 text-warn'],
  done: ['Hoàn thành', 'bg-ok/15 text-ok'],
  error: ['Lỗi', 'bg-err/15 text-err'],
  stopped: ['Đã dừng', 'bg-hover text-muted'],
};

/** Pipeline progress above the chat: a compact stepper, details on hover, actions on the right. */
function RunBar({ run }: { run: PipelineRun }) {
  const catalog = useStore((s) => s.catalog);
  const agents = run.pipeline.nodes.filter((n) => n.type === 'agent');
  const [label, badge] = RUN_BADGE[run.status];
  const total = agents.reduce((a, n) => a + (run.nodes[n.id]?.usage?.inputTokens || 0) + (run.nodes[n.id]?.usage?.outputTokens || 0), 0);
  const current = run.current ? run.pipeline.nodes.find((n) => n.id === run.current) : undefined;
  const doneCount = agents.filter((n) => run.nodes[n.id]?.status === 'done' && run.nodes[n.id]?.verdict !== 'fail').length;
  const progress = run.status === 'done' ? 1 : agents.length ? doneCount / agents.length : 0;
  const short = (agent: string, model: string) => modelLabel(catalog, agent as Agent, model).replace(/\s*\(mới nhất\)$/, '');
  const scroller = useRef<HTMLDivElement>(null);
  // keep the active step in view when the bar is narrow
  useEffect(() => {
    scroller.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [run.current, run.status]);

  return (
    <div className="@container relative shrink-0 border-b border-line bg-panel/70 backdrop-blur">
    <div className="flex h-11 items-center gap-3 px-4 text-[12.5px]">
      <button type="button" onClick={() => setState({ activeTab: 'flow' })} className="flex min-w-0 max-w-[30%] shrink-0 items-center gap-1.5 text-muted hover:text-fg" title={`${run.pipeline.name} · xem sơ đồ`}>
        <Workflow size={14} className="shrink-0 text-accent" />
        <span className="hidden truncate font-medium @3xl:inline">{run.pipeline.name}</span>
      </button>
      <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', badge)}>{label}</span>

      <div ref={scroller} className="flex min-w-0 flex-1 items-center overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto flex items-center px-3">
          {agents.map((n, i) => {
            const st = run.nodes[n.id] || { status: 'idle' as const, runs: 0 };
            const cfg = n.data.config;
            const isCurrent = run.current === n.id && run.status !== 'done';
            const prevDone = i > 0 && run.nodes[agents[i - 1].id]?.status === 'done';
            const tip = [
              n.data.label,
              cfg && `${AGENT_NAME[cfg.agent]} · ${short(cfg.agent, cfg.model)}${cfg.effort ? ` · ${EFFORT_LABEL[cfg.effort] || cfg.effort}` : ''}`,
              st.runs > 1 && `Đã chạy ${st.runs} lần (bước sau chấm chưa đạt nên làm lại)`,
              st.usage && fmtUsage(st.usage),
            ]
              .filter(Boolean)
              .join('\n');
            return (
              <div key={n.id} className="flex shrink-0 items-center">
                {i > 0 && <span className={cx('mx-1 h-px w-3 shrink-0 rounded-full @xl:mx-1.5 @xl:w-6', prevDone ? 'bg-ok/60' : 'bg-line-strong/70')} />}
                <span
                  data-current={isCurrent}
                  title={tip}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 transition-colors',
                    isCurrent ? (st.status === 'awaiting' ? 'bg-warn/10 ring-1 ring-warn/40' : 'bg-accent/10 ring-1 ring-accent/30') : '',
                  )}
                >
                  <StepDot st={st} />
                  <span className={cx('whitespace-nowrap', isCurrent ? 'font-semibold text-fg' : st.status === 'idle' ? 'text-faint' : 'text-fg/80')}>{n.data.label}</span>
                  {isCurrent && cfg && (
                    <span className="hidden items-center gap-1 whitespace-nowrap text-[11.5px] text-muted @xl:inline-flex">
                      <AgentIcon agent={cfg.agent} size={11} />
                      {short(cfg.agent, cfg.model)}
                    </span>
                  )}
                  {st.runs > 1 && <span className="rounded-full bg-hover px-1.5 text-[10.5px] font-semibold leading-4 text-muted">×{st.runs}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {total > 0 && (
          <span className="whitespace-nowrap text-[11.5px] tabular-nums text-faint" title={`${total.toLocaleString('vi-VN')} token (vào + ra) của cả pipeline`}>
            {fmtTokens(total).replace('.', ',')}
            <span className="hidden @lg:inline"> token</span>
          </span>
        )}
        {run.status === 'running' && (
          <button type="button" onClick={() => convAction('run-stop')} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 hover:border-err/50 hover:text-err">
            <Square size={9} fill="currentColor" /> Dừng
          </button>
        )}
        {run.status === 'stopped' && current && (
          <button
            type="button"
            onClick={() => convAction('rerun', {})}
            title="Chạy lại bước đang dở rồi đi tiếp như bình thường"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-accent/50 px-2 py-0.5 text-accent hover:bg-accent/10"
          >
            <RotateCcw size={12} /> Chạy tiếp từ {current.data.label}
          </button>
        )}
        {(run.status === 'stopped' || run.status === 'done' || run.status === 'error') && (
          <button type="button" onClick={() => hideRun(run.id)} title="Ẩn thanh pipeline (vẫn xem được ở tab Flow)" className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
            <X size={13} />
          </button>
        )}
      </div>

      {/* thin progress line along the bottom edge */}
      <span className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] bg-transparent">
        <span
          className={cx('block h-full rounded-r-full transition-[width] duration-500', run.status === 'error' ? 'bg-err' : run.status === 'awaiting' ? 'bg-warn' : run.status === 'done' ? 'bg-ok' : 'bg-accent')}
          style={{ width: `${Math.max(progress, run.status === 'running' ? 0.04 : 0) * 100}%` }}
        />
      </span>
    </div>
    </div>
  );
}

export function ApprovalCard({ conv, run, compact }: { conv: Conversation; run: PipelineRun; compact?: boolean }) {
  const node = run.pipeline.nodes.find((n) => n.id === run.current)!;
  const st = run.nodes[run.current!];
  const [mode, setMode] = useState<'none' | 'edit' | 'rerun'>('none');
  const [output, setOutput] = useState(st?.output || '');
  const [note, setNote] = useState('');
  const [cfg, setCfg] = useState<RunConfig | undefined>(node?.data.config);
  const catalog = useStore((s) => s.catalog);
  useEffect(() => {
    setOutput(st?.output || '');
    setCfg(node?.data.config);
    setMode('none');
    setNote('');
  }, [run.current, st?.turnId, conv.id]);
  if (!node || !st) return null;

  const approve = (verdict?: 'pass' | 'fail') => void convAction('approve', { verdict, note, output: mode === 'edit' ? output : undefined });
  const rerun = () => void convAction('rerun', { note, config: cfg });
  const awaiting = run.status === 'awaiting';

  return (
    <div className={cx('mb-2 rounded-2xl border bg-panel p-3 shadow-sm', awaiting ? 'border-warn/50' : 'border-err/40')}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {awaiting ? <Pause size={15} className="text-warn" /> : <X size={15} className="text-err" />}
        <span className="font-semibold">
          {awaiting ? `Bước "${node.data.label}" xong, chờ anh duyệt` : run.status === 'stopped' ? `Pipeline đã dừng ở bước "${node.data.label}"` : `Bước "${node.data.label}" bị lỗi`}
        </span>
        {node.data.config && (
          <span className="inline-flex items-center gap-1 text-muted">
            <AgentIcon agent={node.data.config.agent} size={12} /> {modelLabel(catalog, node.data.config.agent, node.data.config.model)}
          </span>
        )}
        {node.data.verdict && st.verdict && (
          <span className={cx('rounded-full px-2 py-px text-[11px] font-semibold', st.verdict === 'pass' ? 'bg-ok/15 text-ok' : 'bg-err/15 text-err')}>VERDICT: {st.verdict.toUpperCase()}</span>
        )}
        {st.verdictMissing && <span className="rounded-full bg-warn/15 px-2 py-px text-[11px] text-warn">Không có VERDICT, anh chọn giúp</span>}
        {st.needsInput && <span className="rounded-full bg-warn/15 px-2 py-px text-[11px] font-semibold text-warn">Cần bạn quyết định</span>}
        <span className="ml-auto text-[11.5px] text-faint">
          {fmtDuration(st.durationMs)} {st.usage && `· ${fmtUsage(st.usage)}`}
        </span>
        {!awaiting && !compact && (
          <button type="button" onClick={() => hideRun(run.id)} title="Đóng" className="-mr-1 rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
            <X size={14} />
          </button>
        )}
      </div>
      {st.needsInput && awaiting && (
        <div className="mt-2 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12.5px] text-fg/85">
          {node.data.label} cần một quyết định mà agent không tự chốt được (mục <b>Câu hỏi</b> ở trên). Gõ câu trả lời vào ô ghi chú bên dưới rồi chọn: gửi lại cho bước trước làm theo, hoặc đi tiếp luôn.
        </div>
      )}
      {awaiting && <ReviewSummary text={st.output || ''} turnId={st.turnId} />}
      {st.error && <div className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-err/5 px-2.5 py-1.5 text-[12.5px] text-err">{st.error}</div>}

      {mode === 'edit' && (
        <textarea className={cx(inputCls, 'mt-2 h-48 resize-y font-mono text-[12.5px]')} value={output} onChange={(e) => setOutput(e.target.value)} />
      )}
      {mode === 'rerun' && cfg && (
        <div className="mt-2 rounded-lg border border-line p-2">
          <div className="mb-1 text-xs text-muted">Chạy lại với cấu hình:</div>
          <ConfigPicker value={cfg} onChange={setCfg} placement="bottom-start" />
        </div>
      )}
      {!compact && (
        <input
          className={cx(inputCls, 'mt-2')}
          placeholder={mode === 'rerun' ? 'Góp ý cho lần chạy lại (tuỳ chọn)…' : st.needsInput ? 'Trả lời các câu hỏi ở trên…' : 'Ghi chú cho bước tiếp theo (tuỳ chọn)…'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {awaiting && mode !== 'rerun' && (
          node.data.verdict ? (
            <>
              <button type="button" onClick={() => approve('pass')} className={cx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium', st.verdict !== 'fail' ? 'bg-ok text-white' : 'border border-ok/50 text-ok hover:bg-ok/10')}>
                <ThumbsUp size={14} /> {st.needsInput ? 'Đi tiếp với câu trả lời này' : 'Đạt, đi nhánh Pass'}
              </button>
              <button type="button" onClick={() => approve('fail')} className={cx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium', st.verdict === 'fail' ? 'bg-err text-white' : 'border border-err/50 text-err hover:bg-err/10')}>
                <ThumbsDown size={14} /> {st.needsInput ? 'Gửi câu trả lời cho bước trước làm lại' : 'Chưa đạt, đi nhánh Fail'}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => approve()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">
              <Play size={14} /> Duyệt và chạy tiếp
            </button>
          )
        )}
        {mode === 'rerun' ? (
          <>
            <button type="button" onClick={rerun} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white">
              <RotateCcw size={14} /> Chạy lại bước này
            </button>
            <button type="button" onClick={() => setMode('none')} className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover">
              Huỷ
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setMode('rerun')} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] hover:bg-hover">
            <RotateCcw size={13} /> Chạy lại…
          </button>
        )}
        {awaiting && mode !== 'rerun' && (
          <button type="button" onClick={() => setMode(mode === 'edit' ? 'none' : 'edit')} className={cx('inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] hover:bg-hover', mode === 'edit' && 'bg-hover')}>
            <Pencil size={13} /> Sửa kết quả
          </button>
        )}
        {run.status !== 'stopped' && (
          <button type="button" onClick={() => convAction('run-stop')} className="ml-auto rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-err">
            Dừng pipeline
          </button>
        )}
      </div>
    </div>
  );
}

const SECTION_STYLE: Record<string, string> = {
  'Cần sửa': 'border-err/30 bg-err/5',
  'Câu hỏi': 'border-warn/40 bg-warn/5',
  'Lưu ý': 'border-line bg-bg/40',
  'Giả định': 'border-line bg-bg/40',
};

/** The parts of a step's answer the user needs to decide on, right inside the approval card. */
function ReviewSummary({ text, turnId }: { text: string; turnId?: string }) {
  const sections = reviewSections(text);
  const jump = () => document.getElementById(`turn-${turnId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="mt-2 space-y-1.5">
      {sections.map((s) => (
        <div key={s.title} className={cx('rounded-lg border px-3 py-2', SECTION_STYLE[s.title])}>
          <div className="mb-0.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{s.title}</div>
          <div className="max-h-56 overflow-auto">
            <Markdown text={s.body} className="text-[13.5px]" />
          </div>
        </div>
      ))}
      {turnId && (
        <button type="button" onClick={jump} className="text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline">
          {sections.length ? 'Xem toàn bộ nhận xét ↑' : 'Xem kết quả của bước này ↑'}
        </button>
      )}
    </div>
  );
}

export function RoleChips({ centered }: { centered?: boolean }) {
  const roles = useStore((s) => s.roles);
  const roleId = useStore((s) => s.roleId);
  return (
    <div className={cx('mb-2 flex flex-wrap items-center gap-1.5', centered && 'justify-center')}>
      {roles.map((r) => (
        <button
          key={r.id}
          type="button"
          title={`${r.description} · ${r.config.agent} ${r.config.model}`}
          onClick={() => setComposer(r.config, r.id)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] transition-colors',
            roleId === r.id ? 'border-accent/60 bg-accent/10 text-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg',
          )}
        >
          <span>{r.icon}</span>
          {r.name}
        </button>
      ))}
      <button type="button" onClick={() => setState({ showRoles: true })} className="rounded-full px-2 py-1 text-[12px] text-faint hover:text-fg">
        Sửa vai trò…
      </button>
    </div>
  );
}

function Composer({ autoFocus }: { autoFocus?: boolean }) {
  const composer = useStore((s) => s.composer);
  const roleId = useStore((s) => s.roleId);
  const conv = useStore((s) => s.conv);
  const pipelines = useStore((s) => s.pipelines);
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const running = !!conv?.turns.some((t) => t.status === 'running') || conv?.run?.status === 'running';
  const uploading = atts.some((a) => a.uploading);

  const addFiles = (files: File[]) => {
    for (const file of files) {
      const id = Math.random().toString(36).slice(2);
      const image = file.type.startsWith('image/') || isImage(file.name);
      const name = file.name || 'ảnh dán.png';
      setAtts((a) => [...a, { id, name, image, uploading: true, preview: image ? URL.createObjectURL(file) : undefined }]);
      uploadFile(file)
        .then((path) => setAtts((a) => a.map((x) => (x.id === id ? { ...x, path, uploading: false } : x))))
        .catch((e) => {
          toast(`Không tải lên được ${name}: ${(e as Error).message}`);
          setAtts((a) => a.filter((x) => x.id !== id));
        });
    }
    ta.current?.focus();
  };
  const addRefs = (refs: { path: string; name: string }[]) =>
    setAtts((a) => [...a, ...refs.filter((r) => !a.some((x) => x.path === r.path)).map((r) => ({ id: Math.random().toString(36).slice(2), name: r.name, path: r.path, image: isImage(r.name) }))]);
  const removeAtt = (id: string) =>
    setAtts((a) => {
      const x = a.find((y) => y.id === id);
      if (x?.preview) URL.revokeObjectURL(x.preview);
      return a.filter((y) => y.id !== id);
    });
  const clearAtts = () => {
    for (const a of atts) if (a.preview) URL.revokeObjectURL(a.preview);
    setAtts([]);
  };

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px';
  }, [text]);
  useEffect(() => ta.current?.focus(), [conv?.id, autoFocus]);

  // "Gửi cho agent" from the terminal appends to whatever is being typed
  const insert = useStore((s) => s.composerInsert);
  const seenInsert = useRef(insert?.n ?? 0);
  useEffect(() => {
    if (!insert || insert.n === seenInsert.current) return;
    seenInsert.current = insert.n;
    setText((t) => (t.trim() ? `${t.trimEnd()}\n\n${insert.text}` : insert.text));
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [insert]);

  const send = async () => {
    const t = text.trim();
    if ((!t && !atts.length) || running || uploading) return;
    const sent = atts;
    setText('');
    setAtts([]);
    if (!(await sendMessage(withAttachments(t, sent)))) {
      setText(t);
      setAtts(sent);
    } else for (const a of sent) if (a.preview) URL.revokeObjectURL(a.preview);
  };

  const runPipeline = async (pid: string) => {
    const p = getState().pipelines.find((x) => x.id === pid);
    if (uploading) return toast('Đợi file tải lên xong đã', 'info');
    const task = withAttachments(text.trim(), atts).trim();
    if (!p) return;
    if (!task) {
      toast('Nhập task vào ô chat trước, rồi chọn pipeline.', 'info');
      return;
    }
    const c = await ensureConv();
    if (!c) return;
    const ok = await safe(api('POST', `/conversations/${encodeURIComponent(c.id)}/run${qs({ project: getState().project })}`, { pipeline: p, task }));
    if (ok) {
      setText('');
      clearAtts();
    }
  };

  return (
    <div>
      <div
        className={cx(
          'relative rounded-2xl border border-line-strong/70 bg-raised shadow-sm focus-within:border-line-strong focus-within:shadow-md',
          dragging && 'border-accent ring-2 ring-accent/30',
        )}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].some((t) => t === 'Files' || t === REF_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
        onDrop={(e) => {
          setDragging(false);
          const ref = e.dataTransfer.getData(REF_MIME);
          if (ref) {
            e.preventDefault();
            addRefs(JSON.parse(ref));
            return;
          }
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            addFiles([...e.dataTransfer.files]);
          }
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-accent/10 text-[13px] font-medium text-accent">
            Thả file vào đây để đính kèm
          </div>
        )}
        {atts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {atts.map((a) => (
              <AttachmentChip key={a.id} a={a} onRemove={() => removeAtt(a.id)} />
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // screenshots / copied files: attach instead of pasting nothing
            const files = [...e.clipboardData.files];
            if (files.length && !e.clipboardData.getData('text/plain')) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={running ? 'Đang chạy… (có thể gõ trước)' : 'Giao việc cho agent… (Enter để gửi, Shift+Enter xuống dòng)'}
          className="block max-h-80 min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <AttachButton onFiles={addFiles} />
          <ConfigPicker value={composer} onChange={(c) => setComposer(c, roleId)} />
          <div className="ml-auto flex items-center gap-1.5">
            <Popover
              placement="top-end"
              width={280}
              trigger={(open, toggle) => (
                <button
                  type="button"
                  onClick={toggle}
                  disabled={running}
                  title="Chạy pipeline với nội dung ô chat làm task"
                  className={cx('inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40', open && 'bg-hover')}
                >
                  <Workflow size={14} /> Pipeline
                </button>
              )}
            >
              {(close) => (
                <div className="p-1">
                  <div className="px-2 pb-1 pt-1 text-xs text-faint">Chạy pipeline, task = nội dung ô chat</div>
                  {pipelines.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        close();
                        void runPipeline(p.id);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-hover"
                    >
                      <Play size={13} className="text-accent" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      setState({ activeTab: 'flow' });
                    }}
                    className="mt-1 w-full rounded-lg border-t border-line px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:bg-hover"
                  >
                    Mở trình thiết kế Flow…
                  </button>
                </div>
              )}
            </Popover>
            {running ? (
              <button type="button" onClick={() => convAction('stop')} title="Dừng" className="grid h-8 w-8 place-items-center rounded-full bg-fg text-bg hover:opacity-85">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={(!text.trim() && !atts.length) || uploading}
                title={uploading ? 'Đang tải file lên…' : 'Gửi'}
                className="grid h-8 w-8 place-items-center rounded-full bg-accent text-white hover:opacity-90 disabled:opacity-35"
              >
                <ArrowUp size={17} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { Markdown };
