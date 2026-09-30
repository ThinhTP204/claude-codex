import { useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, Check, ChevronRight, RefreshCw, X } from 'lucide-react';
import { api } from '../api.ts';
import { checkUpdate, setState, toast, useStore } from '../store.ts';
import { Spinner, cx } from './ui.tsx';

type Phase = 'idle' | 'pull' | 'install' | 'build' | 'download' | 'extract' | 'restart' | 'done' | 'error';
const GIT_STEPS: { id: Phase; label: string }[] = [
  { id: 'pull', label: 'Tải code mới (git pull)' },
  { id: 'install', label: 'Cài thư viện (npm install, khi có thay đổi)' },
  { id: 'build', label: 'Build giao diện' },
  { id: 'restart', label: 'Khởi động lại' },
];
const PACKAGED_STEPS: { id: Phase; label: string }[] = [
  { id: 'download', label: 'Tải bản cập nhật' },
  { id: 'extract', label: 'Giải nén và kiểm tra' },
  { id: 'restart', label: 'Khởi động lại' },
];

const NEW: [string, string] = ['Mới', 'bg-accent/12 text-accent'];
const FIX: [string, string] = ['Sửa lỗi', 'bg-err/10 text-err'];
const BETTER: [string, string] = ['Cải tiến', 'bg-ok/12 text-ok'];
const KIND: Record<string, [string, string]> = {
  // commit prefixes (git installs) and CHANGELOG labels (release notes)
  feat: NEW,
  'mới': NEW,
  fix: FIX,
  'sửa lỗi': FIX,
  perf: BETTER,
  refactor: BETTER,
  style: BETTER,
  'cải tiến': BETTER,
  docs: ['Tài liệu', 'bg-hover text-muted'],
};

/** "feat(ui): add X" / "Mới: Thêm X" → ["Mới", "Add X"] */
function readable(subject: string): { kind?: [string, string]; text: string } {
  const m = /^([^:()]{2,12})(?:\([^)]*\))?!?:\s*(.+)$/.exec(subject.replace(/\*\*/g, ''));
  const kind = m && KIND[m[1].trim().toLowerCase()];
  if (!m || !kind) return { text: subject };
  const text = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return { kind, text };
}

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

/** Always-visible sidebar entry: version + "Cập nhật"; turns orange when GitHub has something newer. */
export function UpdateBadge() {
  const u = useStore((s) => s.update);
  const behind = u?.behind || 0;
  return (
    <button
      type="button"
      onClick={() => setState({ showUpdate: true })}
      title={behind ? `Có ${behind} thay đổi mới, bấm để cập nhật` : 'Kiểm tra cập nhật'}
      className={cx(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px]',
        behind ? 'bg-accent/10 font-medium text-accent hover:bg-accent/15' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <ArrowUpCircle size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{behind ? 'Có bản cập nhật' : 'Cập nhật'}</span>
      {behind ? (
        <span className="shrink-0 rounded-full bg-accent px-1.5 text-[10.5px] font-semibold leading-4 text-white">{behind}</span>
      ) : (
        u?.version && <span className="shrink-0 text-[11px] font-normal text-faint">v{u.version}</span>
      )}
    </button>
  );
}

export function UpdateDialog() {
  const u = useStore((s) => s.update);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState('');
  const [error, setError] = useState<string>();
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const running = phase !== 'idle' && phase !== 'done' && phase !== 'error';
  const close = () => !running && setState({ showUpdate: false });

  useEffect(() => {
    if (!u) void checkUpdate(true);
  }, []);

  // follow the server-side job until it restarts (the page then reloads by itself)
  useEffect(() => {
    if (!running || phase === 'restart') return;
    const t = setInterval(async () => {
      const s = await api<{ phase: Phase; log: string; error?: string }>('GET', '/update/status').catch(() => undefined);
      if (!s) return;
      // a fresh server answers "idle": the restart already happened (the page reloads on reconnect)
      if (s.phase === 'idle') return setPhase('restart');
      setPhase(s.phase);
      setLog(s.log);
      setError(s.error);
      if (s.phase === 'error') setShowLog(true);
    }, 700);
    return () => clearInterval(t);
  }, [running, phase]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log, showLog]);

  const check = async () => {
    setChecking(true);
    await checkUpdate(true);
    setChecking(false);
  };
  const apply = async () => {
    setError(undefined);
    setLog('');
    try {
      await api('POST', '/update/apply');
      setPhase('pull');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const STEPS = u?.packaged ? PACKAGED_STEPS : GIT_STEPS;
  const at = STEPS.findIndex((s) => s.id === phase);
  const finished = phase === 'restart' && !u?.canRestart;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex max-h-[85vh] w-[min(560px,94vw)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <ArrowUpCircle size={17} className="text-accent" />
          <span className="font-semibold">Cập nhật AgentDesk</span>
          {!running && (
            <button type="button" onClick={close} className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-[13px]">
          <div className="flex items-baseline gap-2 text-muted">
            <span>
              Phiên bản hiện tại: <b className="font-semibold text-fg">{u?.version || '…'}</b>
              {u?.date && <> · cập nhật {fmtDate(u.date)}</>}
            </span>
            {u?.commit && (
              <code className="ml-auto text-[11px] text-faint" title={u.subject}>
                #{u.commit}
              </code>
            )}
          </div>

          {phase === 'idle' && (
            <>
              {!u || checking ? (
                <div className="flex items-center gap-2 text-muted">
                  <Spinner size={13} /> Đang kiểm tra GitHub…
                </div>
              ) : !u.supported ? (
                <div className="rounded-lg bg-warn/10 px-3 py-2 text-fg/85">{u.reason}</div>
              ) : u.reason ? (
                <div className="rounded-lg bg-err/5 px-3 py-2 text-err">{u.reason}</div>
              ) : u.behind === 0 ? (
                <div className="flex items-center gap-2 text-ok">
                  <Check size={15} /> Đang là bản mới nhất.
                </div>
              ) : (
                <>
                  <div className="font-medium">Có {u.behind} thay đổi mới:</div>
                  <ul className="max-h-60 space-y-1.5 overflow-auto rounded-lg border border-line bg-bg/40 p-2.5">
                    {u.commits.map((c) => {
                      const r = readable(c.subject);
                      return (
                        <li key={c.hash} className="flex items-start gap-2" title={`#${c.hash} · ${c.date}`}>
                          <span className={cx('mt-px w-[68px] shrink-0 rounded px-1.5 text-center text-[11px] font-medium', r.kind?.[1] ?? 'bg-hover text-muted')}>{r.kind?.[0] ?? 'Thay đổi'}</span>
                          <span className="min-w-0 flex-1 leading-snug">{r.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {u.busy && <div className="rounded-lg bg-warn/10 px-3 py-2">Đang có agent chạy. Cập nhật sẽ dừng nó, nên đợi chạy xong đã.</div>}
                  <div className="text-[12px] text-faint">
                    {u.packaged
                      ? u.payloadUrl
                        ? 'App tải bản mới về rồi khởi động lại, không cần cài lại. Dữ liệu và cài đặt giữ nguyên.'
                        : 'Bản này cần cài lại: bấm Tải bộ cài để mở trang tải, cài đè lên bản đang dùng (dữ liệu giữ nguyên).'
                      : 'App sẽ tự chạy git pull → npm install (nếu cần) → build → khởi động lại. Terminal đang mở sẽ bị đóng. Build lỗi thì app vẫn giữ bản cũ.'}
                  </div>
                </>
              )}
            </>
          )}

          {phase !== 'idle' && (
            <ol className="space-y-1.5">
              {STEPS.map((s, i) => {
                const state = phase === 'error' ? (i < at ? 'done' : i === at ? 'error' : 'todo') : i < at || phase === 'done' ? 'done' : i === at ? 'now' : 'todo';
                return (
                  <li key={s.id} className={cx('flex items-center gap-2', state === 'todo' && 'text-faint')}>
                    <span className="grid h-5 w-5 place-items-center">
                      {state === 'done' ? <Check size={14} className="text-ok" /> : state === 'now' ? <Spinner size={13} className="text-accent" /> : state === 'error' ? <X size={14} className="text-err" /> : <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />}
                    </span>
                    {s.label}
                  </li>
                );
              })}
            </ol>
          )}
          {phase === 'restart' && (
            <div className="rounded-lg bg-accent/10 px-3 py-2">
              {finished ? 'Đã cập nhật xong. Tắt AgentDesk rồi mở lại để dùng bản mới.' : 'Đang khởi động lại… cửa sổ sẽ tự tải lại sau vài giây.'}
            </div>
          )}
          {error && <div className="rounded-lg bg-err/5 px-3 py-2 text-err">{error}</div>}

          {log && (
            <div>
              <button type="button" onClick={() => setShowLog((v) => !v)} className="flex items-center gap-1 text-[12px] text-muted hover:text-fg">
                <ChevronRight size={12} className={cx('transition-transform', showLog && 'rotate-90')} /> Log
              </button>
              {showLog && (
                <pre ref={logRef} className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-code p-2 font-mono text-[11.5px] text-muted">
                  {log}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={check} disabled={running || checking} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-hover disabled:opacity-40">
            <RefreshCw size={13} className={cx(checking && 'animate-spin')} /> Kiểm tra lại
          </button>
          {u?.packaged && !!u.behind && !u.payloadUrl && (
            <button
              type="button"
              onClick={() => void api('POST', '/update/download').catch((e) => toast((e as Error).message))}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
            >
              <ArrowUpCircle size={14} /> Tải bộ cài
            </button>
          )}
          {(!u?.packaged || !!u.payloadUrl) && (phase === 'idle' || phase === 'error') && !!u?.behind && (
            <button type="button" onClick={apply} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">
              <ArrowUpCircle size={14} /> {phase === 'error' ? 'Thử lại' : 'Cập nhật & khởi động lại'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
