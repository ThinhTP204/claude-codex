import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronRight, FolderOpen, Pause, Pencil, Play, RotateCcw, Square, ThumbsDown, ThumbsUp, Workflow, X } from 'lucide-react';
import type { Conversation, NodeRunState, PipelineRun, RunConfig } from '../../../shared/types.ts';
import { convAction, ensureConv, getState, hideRun, pickProject, safe, sendMessage, setComposer, setState, toast, useStore } from '../store.ts';
import { api, qs } from '../api.ts';
import { ConfigPicker } from './ConfigPicker.tsx';
import { AttachButton, AttachmentChip } from './Attachments.tsx';
import { type Attachment, REF_MIME, isImage, uploadFile, withAttachments } from '../attachments.ts';
import { ProjectChip } from './ProjectMenu.tsx';
import { TurnView, Markdown } from './Message.tsx';
import { AgentIcon, Popover, Spinner, cx, fmtDuration, fmtUsage, inputCls, modelLabel } from './ui.tsx';

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

const STATUS_STYLE: Record<NodeRunState['status'], string> = {
  idle: 'border-line text-faint',
  running: 'border-accent text-fg bg-accent/10',
  awaiting: 'border-warn text-fg bg-warn/10',
  done: 'border-ok/50 text-fg',
  error: 'border-err text-err bg-err/5',
  stopped: 'border-line-strong text-muted',
};

function StatusIcon({ st }: { st: NodeRunState }) {
  switch (st.status) {
    case 'running':
      return <Spinner size={12} className="text-accent" />;
    case 'awaiting':
      return <Pause size={12} className="text-warn" />;
    case 'done':
      return st.verdict === 'fail' ? <ThumbsDown size={12} className="text-err" /> : <Check size={12} className="text-ok" />;
    case 'error':
      return <X size={12} className="text-err" />;
    case 'stopped':
      return <Square size={10} />;
    default:
      return <span className="block h-2 w-2 rounded-full border border-current" />;
  }
}

function RunBar({ run }: { run: PipelineRun }) {
  const catalog = useStore((s) => s.catalog);
  const agents = run.pipeline.nodes.filter((n) => n.type === 'agent');
  const label =
    run.status === 'running' ? 'Đang chạy' : run.status === 'awaiting' ? 'Chờ duyệt' : run.status === 'done' ? 'Hoàn thành' : run.status === 'error' ? 'Lỗi' : 'Đã dừng';
  const total = agents.reduce((a, n) => a + (run.nodes[n.id]?.usage?.inputTokens || 0) + (run.nodes[n.id]?.usage?.outputTokens || 0), 0);
  const current = run.current ? run.pipeline.nodes.find((n) => n.id === run.current) : undefined;
  return (
    <div className="flex items-center gap-2 border-b border-line bg-panel/60 px-4 py-2 text-[12.5px]">
      <button type="button" onClick={() => setState({ activeTab: 'flow' })} className="flex shrink-0 items-center gap-1.5 font-medium hover:text-accent" title="Xem sơ đồ">
        <Workflow size={14} className="text-accent" />
        {run.pipeline.name}
      </button>
      <span className={cx('shrink-0 rounded-full px-2 py-px text-[11px] font-medium', run.status === 'done' ? 'bg-ok/15 text-ok' : run.status === 'error' ? 'bg-err/15 text-err' : run.status === 'awaiting' ? 'bg-warn/15 text-warn' : 'bg-accent/15 text-accent')}>
        {label}
      </span>
      {/* steps scroll horizontally; the action buttons keep their own space on the right */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {agents.map((n, i) => {
          const st = run.nodes[n.id] || { status: 'idle', runs: 0 };
          const cfg = n.data.config;
          return (
            <div key={n.id} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="text-faint" />}
              <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5', STATUS_STYLE[st.status], run.current === n.id && 'ring-1 ring-offset-0 ring-current')} title={cfg ? `${cfg.agent} · ${cfg.model}` : ''}>
                <StatusIcon st={st} />
                {cfg && <AgentIcon agent={cfg.agent} size={11} />}
                <span>{n.data.label}</span>
                {cfg && <span className="text-faint">{modelLabel(catalog, cfg.agent, cfg.model)}</span>}
                {st.runs > 1 && <span className="text-faint" title={`Lần chạy thứ ${st.runs}: bước sau chấm chưa đạt nên gửi lại bước này làm lại`}>lần {st.runs}</span>}
              </span>
            </div>
          );
        })}
      </div>
      {total > 0 && <span className="shrink-0 text-[11px] text-faint">Σ {Math.round(total / 1000)}k token</span>}
      {run.status === 'running' && (
        <button type="button" onClick={() => convAction('run-stop')} className="shrink-0 rounded-md border border-line px-2 py-0.5 hover:bg-hover">
          Dừng
        </button>
      )}
      {run.status === 'stopped' && current && (
        <button
          type="button"
          onClick={() => convAction('rerun', {})}
          title="Chạy lại bước đang dở rồi đi tiếp như bình thường"
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-accent/50 px-2 py-0.5 text-accent hover:bg-accent/10"
        >
          <RotateCcw size={12} /> Chạy tiếp từ bước {current.data.label}
        </button>
      )}
      {(run.status === 'stopped' || run.status === 'done' || run.status === 'error') && (
        <button type="button" onClick={() => hideRun(run.id)} title="Ẩn thanh pipeline (vẫn xem được ở tab Flow)" className="shrink-0 rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
          <X size={13} />
        </button>
      )}
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
