import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronRight, RefreshCw, RotateCcw } from 'lucide-react';
import type { Agent, AgentUsage, ResetCredit, RunConfig, UsageWindow } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { consumeCodexReset, refreshHealth, refreshUsage, toast, useStore } from '../store.ts';
import { AGENT_NAME, AgentIcon, Popover, Spinner, cx, fmtDuration, modelLabel } from './ui.tsx';

const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const pad = (n: number) => String(n).padStart(2, '0');

function fmtReset(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  if (days === 0) return `${time} hôm nay`;
  if (days === 1) return `${time} mai`;
  return `${time} ${DAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function fmtLeft(ms?: number): string {
  if (!ms) return '';
  const left = ms - Date.now();
  if (left <= 0) return 'đã reset';
  const h = Math.floor(left / 3600_000);
  const m = Math.floor((left % 3600_000) / 60_000);
  if (h >= 48) return `còn ${Math.floor(h / 24)} ngày`;
  return h ? `còn ${h}g ${m}p` : `còn ${m}p`;
}

const barColor = (p: number) => (p >= 90 ? 'bg-err' : p >= 70 ? 'bg-warn' : 'bg-ok');

function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-line', className)}>
      <div className={cx('h-full rounded-full transition-all', barColor(pct))} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
    </div>
  );
}

const shortLabel = (l: string) => (l === '5 giờ' ? '5h' : l.startsWith('Tuần') ? 'Tuần' : l);

/** Compact rows at the bottom of the sidebar */
function MiniRow({ agent, u, connected }: { agent: Agent; u?: AgentUsage; connected?: boolean }) {
  // several pools (Antigravity: Gemini + Claude/GPT) → show the tightest 5h / weekly window
  const worst = (re: RegExp) => (u?.windows || []).filter((w) => re.test(w.label)).sort((a, b) => b.usedPercent - a.usedPercent)[0];
  const main =
    (u?.windows.length || 0) > 2
      ? [worst(/5 giờ/), worst(/Tuần/)].filter((w): w is UsageWindow => !!w).map((w) => ({ ...w, label: /Tuần/.test(w.label) ? 'Tuần' : '5 giờ' }))
      : u?.windows.slice(0, 2) || [];
  const credits = u?.resetCredits?.length || 0;
  return (
    <div className="flex items-center gap-2">
      <span className="relative shrink-0">
        <AgentIcon agent={agent} size={14} />
        <span className={cx('absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-sidebar', connected === undefined ? 'bg-faint' : connected ? 'bg-ok' : 'bg-err')} />
      </span>
      {u?.ok ? (
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          {main.map((w) => (
            <div key={w.label} className="min-w-0" title={`${w.label}: ${w.usedPercent}% · reset ${fmtReset(w.resetsAt) || w.resetsText || ''}`}>
              <div className="flex items-baseline justify-between text-[10.5px] leading-none text-faint">
                <span>{shortLabel(w.label)}</span>
                <span className={cx('tabular-nums', w.usedPercent >= 90 ? 'text-err' : w.usedPercent >= 70 ? 'text-warn' : 'text-muted')}>{Math.round(w.usedPercent)}%</span>
              </div>
              <Bar pct={w.usedPercent} className="mt-1" />
            </div>
          ))}
        </div>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{u ? 'Không đọc được usage' : 'Đang tải…'}</span>
      )}
      {/* fixed slot on every row so the bars of all agents line up */}
      <span className="flex w-7 shrink-0 justify-end">
        {agent === 'codex' && credits > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded bg-accent/10 px-1 text-[10.5px] font-medium leading-4 text-accent" title={`${credits} lượt reset trong bank`}>
            <RotateCcw size={10} />
            {credits}
          </span>
        )}
      </span>
    </div>
  );
}

function WindowRow({ w }: { w: UsageWindow }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="font-medium">{w.label}</span>
        <span className={cx('tabular-nums font-semibold', w.usedPercent >= 90 ? 'text-err' : w.usedPercent >= 70 ? 'text-warn' : '')}>{Math.round(w.usedPercent)}%</span>
      </div>
      <Bar pct={w.usedPercent} className="mt-1 h-2" />
      <div className="mt-0.5 flex justify-between text-[11px] text-faint">
        <span>Reset {fmtReset(w.resetsAt) || w.resetsText || '—'}</span>
        <span>{fmtLeft(w.resetsAt)}</span>
      </div>
    </div>
  );
}

function ConfirmReset({ credit, usage, onClose }: { credit: ResetCredit; usage: AgentUsage; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const peak = Math.max(0, ...usage.windows.map((w) => w.usedPercent));
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 p-6" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-[420px] rounded-2xl border border-line bg-panel p-5 shadow-pop">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <AgentIcon agent="codex" size={18} /> Dùng 1 lượt reset Codex?
        </div>
        <p className="mt-2 text-[13px] text-muted">
          <b className="text-fg">{credit.title || 'Rate limit reset'}</b>: đưa giới hạn <b className="text-fg">5 giờ và tuần</b> về 0%. Dùng rồi không hoàn tác được.
        </p>
        <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
          {usage.windows.map((w) => (
            <WindowRow key={w.label} w={w} />
          ))}
        </div>
        {peak < 50 && (
          <div className="mt-3 flex gap-2 rounded-lg bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>Anh mới dùng tối đa {Math.round(peak)}%. Reset bây giờ khá phí, nên để dành tới lúc gần chạm giới hạn.</span>
          </div>
        )}
        {credit.expiresAt && <div className="mt-2 text-[11.5px] text-faint">Lượt này hết hạn {fmtReset(credit.expiresAt)}.</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] hover:bg-hover">
            Huỷ
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await consumeCodexReset(credit.id);
              setBusy(false);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
          >
            {busy ? <Spinner size={13} /> : <RotateCcw size={13} />} Dùng lượt reset
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AgentSection({ agent }: { agent: Agent }) {
  const health = useStore((s) => s.health?.[agent]);
  const u = useStore((s) => s.usage?.[agent]);
  const catalog = useStore((s) => s.catalog);
  const composer = useStore((s) => s.composer);
  const [test, setTest] = useState<{ busy?: boolean; ok?: boolean; text?: string }>();
  const [showDetails, setShowDetails] = useState(false);
  const [confirm, setConfirm] = useState<ResetCredit>();

  const runTest = async () => {
    const cfg: RunConfig =
      composer.agent === agent ? composer : { agent, model: catalog?.[agent]?.[0]?.id || '', effort: catalog?.[agent]?.[0]?.defaultEffort, permission: 'read' };
    setTest({ busy: true });
    try {
      const r = await api<{ ok: boolean; error?: string; durationMs: number }>('POST', '/health/test', cfg);
      setTest({ ok: r.ok, text: r.ok ? `${modelLabel(catalog, agent, cfg.model)} trả lời sau ${fmtDuration(r.durationMs)}` : r.error || 'Không trả lời "pong"' });
    } catch (e) {
      setTest({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center gap-2">
        <AgentIcon agent={agent} size={16} />
        <span className="font-semibold">{AGENT_NAME[agent]}</span>
        {(u?.plan || health?.account) && <span className="truncate text-[11.5px] text-faint">{u?.plan ? u.plan.toUpperCase() : ''}</span>}
        <span className={cx('h-2 w-2 rounded-full', !health ? 'bg-faint' : health.loggedIn ? 'bg-ok' : 'bg-err')} title={health?.loggedIn ? 'Đã đăng nhập' : 'Chưa đăng nhập'} />
        <span className="text-[11px] text-faint">{health?.version ? `v${health.version}` : ''}</span>
        <button
          type="button"
          onClick={runTest}
          disabled={test?.busy || !health?.loggedIn}
          title="Gửi thử 'pong' bằng model đang chọn (tốn ~20k token)"
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11.5px] hover:bg-hover disabled:opacity-40"
        >
          {test?.busy && <Spinner size={10} />} Test
        </button>
      </div>
      {health && !health.loggedIn && <div className="mt-1 text-[12px] text-err">{health.error || 'Chưa đăng nhập'}</div>}
      {test && !test.busy && <div className={cx('mt-1 text-[12px]', test.ok ? 'text-ok' : 'text-err')}>{test.ok ? '✓ ' : '✗ '}{test.text}</div>}

      <div className="mt-2.5 space-y-2.5">
        {u?.ok ? u.windows.map((w) => <WindowRow key={w.label} w={w} />) : <div className="text-[12px] text-faint">{u?.error || 'Đang tải usage…'}</div>}
        {u?.limitReached && <div className="rounded-md bg-err/10 px-2 py-1 text-[12px] text-err">Đã chạm giới hạn</div>}
      </div>

      {agent === 'codex' && u?.ok && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium">
            <RotateCcw size={12} className="text-accent" /> Bank reset: {u.resetCredits?.length || 0} lượt
          </div>
          {(u.resetCredits || []).map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg px-1 py-1 text-[12px] hover:bg-hover/60">
              <div className="min-w-0 flex-1">
                <div className="truncate">{c.title || 'Rate limit reset'}</div>
                <div className="text-[11px] text-faint">{c.expiresAt ? `Hết hạn ${fmtReset(c.expiresAt)}` : 'Không hết hạn'}</div>
              </div>
              <button
                type="button"
                disabled={c.status !== 'available'}
                onClick={() => setConfirm(c)}
                className="shrink-0 rounded-md border border-accent/50 px-2 py-0.5 text-[11.5px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                {c.status === 'redeeming' ? 'Đang dùng…' : 'Dùng'}
              </button>
            </div>
          ))}
          {!u.resetCredits?.length && <div className="text-[11.5px] text-faint">Không có lượt reset nào.</div>}
        </div>
      )}

      {agent === 'claude' && u?.details && (
        <div className="mt-2.5 border-t border-line pt-2">
          <button type="button" onClick={() => setShowDetails((v) => !v)} className="flex items-center gap-1 text-[12px] text-muted hover:text-fg">
            <ChevronRight size={12} className={cx('transition-transform', showDetails && 'rotate-90')} /> Điều gì đang ăn quota?
          </button>
          {showDetails && <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed text-muted">{u.details}</pre>}
        </div>
      )}
      {confirm && u && <ConfirmReset credit={confirm} usage={u} onClose={() => setConfirm(undefined)} />}
    </div>
  );
}

export function UsagePanel() {
  const usage = useStore((s) => s.usage);
  const loading = useStore((s) => s.usageLoading);
  const health = useStore((s) => s.health);
  const fetchedAt = Math.min(usage?.claude.fetchedAt || Infinity, usage?.codex.fetchedAt || Infinity);
  const shown = (['claude', 'codex', 'antigravity'] as Agent[]).filter((a) => a !== 'antigravity' || health?.antigravity?.installed);

  return (
    <Popover
      placement="top-start"
      width={360}
      anchorClassName="block w-full"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          className={cx('w-full space-y-1.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover', open && 'bg-hover')}
          title="Usage & kết nối"
        >
          <div className="flex items-center text-[10.5px] font-semibold uppercase tracking-wider text-faint">
            Usage
            {loading && <Spinner size={10} className="ml-1.5" />}
          </div>
          {shown.map((a) => (
            <MiniRow key={a} agent={a} u={usage?.[a]} connected={health ? health[a]?.loggedIn : undefined} />
          ))}
        </button>
      )}
    >
      {() => (
        <div className="space-y-2 p-2">
          <div className="flex items-center">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-faint">Usage & kết nối</span>
            <button
              type="button"
              onClick={() =>
                void Promise.all([refreshUsage(true), refreshHealth(true)]).then(() => toast('Đã cập nhật usage', 'info'))
              }
              className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg"
            >
              {loading ? <Spinner size={11} /> : <RefreshCw size={12} />} Làm mới
            </button>
          </div>
          {shown.map((a) => (
            <AgentSection key={a} agent={a} />
          ))}
          <div className="px-1 text-[11px] text-faint">
            {Number.isFinite(fetchedAt) && `Cập nhật lúc ${new Date(fetchedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · `}
            tự làm mới mỗi 5 phút và sau mỗi lượt chạy
          </div>
        </div>
      )}
    </Popover>
  );
}
