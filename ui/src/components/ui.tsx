import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import type { Agent, Catalog, Permission, Usage } from '../../../shared/types.ts';
import { CLAUDE_MARK, OPENAI_MARK } from '../assets/agentMarks.ts';
import antigravityLogo from '../assets/antigravity.png';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function AgentIcon({ agent, size = 16 }: { agent: Agent; size?: number }) {
  if (agent === 'antigravity') return <img src={antigravityLogo} width={size} height={size} alt="Antigravity" className="shrink-0 object-contain" draggable={false} />;
  const claude = agent === 'claude';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={claude ? 'Claude' : 'Codex'} className="shrink-0">
      <path d={claude ? CLAUDE_MARK : OPENAI_MARK} fill={claude ? '#D97757' : 'currentColor'} />
    </svg>
  );
}

export const AGENT_NAME: Record<Agent, string> = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' };

export const PERMISSIONS: { id: Permission; label: string; short: string; desc: string }[] = [
  { id: 'read', label: 'Chỉ đọc', short: 'Đọc', desc: 'Đọc code, không sửa gì' },
  { id: 'write', label: 'Sửa file', short: 'Sửa', desc: 'Được sửa file trong project, không chạy lệnh' },
  { id: 'exec', label: 'Sửa + chạy lệnh', short: 'Sửa+lệnh', desc: 'Sửa file và chạy lệnh (build, test…)' },
  { id: 'full', label: 'Toàn quyền', short: 'Full', desc: 'Bỏ qua mọi kiểm tra quyền (rủi ro)' },
];

export const EFFORT_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra',
};

export function modelLabel(catalog: Catalog | undefined, agent: Agent | undefined, model: string | undefined): string {
  if (!model) return '';
  const list = agent ? catalog?.[agent] : [...(catalog?.claude || []), ...(catalog?.codex || [])];
  const hit = list?.find((m) => m.id === model);
  if (hit) return hit.label;
  // full claude ids like claude-opus-5 / claude-haiku-4-5-20251001
  const m = /^claude-(\w+)-([\d-]+?)(?:-\d{8})?$/.exec(model);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace('-', '.')}`;
  return model;
}

export const fmtTokens = (n?: number) => (n === undefined ? '' : n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const fmtDuration = (ms?: number) => (ms === undefined ? '' : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`);
export function fmtUsage(u?: Usage): string {
  if (!u) return '';
  const parts = [`${fmtTokens(u.inputTokens)} vào`, `${fmtTokens(u.outputTokens)} ra`];
  if (u.costUsd) parts.push(`~$${u.costUsd.toFixed(3)}`);
  return parts.join(' · ');
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('animate-spin', className)} />;
}

export function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOut, active]);
}

/** Popover anchored to a trigger, rendered in a portal so it is never clipped. */
export function Popover({
  trigger,
  children,
  placement = 'bottom-start',
  width,
  anchorClassName = 'inline-flex min-w-0',
}: {
  anchorClassName?: string;
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  placement?: 'bottom-start' | 'top-start' | 'bottom-end' | 'top-end';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number }>({ left: 0, top: 0, maxH: 400 });

  useLayoutEffect(() => {
    if (!open || !anchor.current || !pop.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const up = placement.startsWith('top');
    let left = placement.endsWith('end') ? a.right - p.width : a.left;
    left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8));
    const spaceBelow = window.innerHeight - a.bottom - 12;
    const spaceAbove = a.top - 12;
    const goUp = up ? spaceAbove > 160 || spaceAbove > spaceBelow : spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxH = Math.max(160, goUp ? spaceAbove : spaceBelow);
    const h = Math.min(p.height, maxH);
    setPos({ left, top: goUp ? a.top - h - 6 : a.bottom + 6, maxH });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      // a dialog opened from inside the popover lives in a portal: clicking it must not close (and unmount) it
      if ((t as Element).closest?.('[data-keep-popover]')) return;
      if (!pop.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);

  return (
    <>
      <span ref={anchor} className={anchorClassName}>
        {trigger(open, () => setOpen((o) => !o))}
      </span>
      {open &&
        createPortal(
          <div
            ref={pop}
            style={{ left: pos.left, top: pos.top, maxHeight: pos.maxH, width }}
            className="fixed z-50 overflow-auto rounded-xl border border-line bg-raised p-1 shadow-pop"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  display,
  title,
  placement,
  width = 260,
  className,
  footer,
}: {
  value: T | undefined;
  options: Option<T>[];
  onChange: (v: T) => void;
  display?: ReactNode;
  title?: string;
  placement?: 'bottom-start' | 'top-start' | 'bottom-end' | 'top-end';
  width?: number;
  className?: string;
  /** extra content under the options (e.g. a free-text entry) */
  footer?: (close: () => void) => ReactNode;
}) {
  const cur = options.find((o) => o.value === value);
  return (
    <Popover
      placement={placement}
      width={width}
      trigger={(open, toggle) => (
        <button
          type="button"
          title={title}
          onClick={toggle}
          className={cx(
            'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted hover:bg-hover hover:text-fg',
            open && 'bg-hover text-fg',
            className,
          )}
        >
          {display ?? (
            <>
              {cur?.icon}
              <span className="truncate">{cur?.label ?? value ?? '—'}</span>
            </>
          )}
          <ChevronDown size={13} className="shrink-0 opacity-60" />
        </button>
      )}
    >
      {(close) => (
        <>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => {
              onChange(o.value);
              close();
            }}
            className={cx(
              'flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-hover disabled:opacity-40',
              o.value === value && 'bg-hover/60',
            )}
          >
            {o.icon && <span className="mt-0.5">{o.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{o.label}</span>
              {o.hint && <span className="block text-xs text-faint">{o.hint}</span>}
            </span>
            {o.value === value && <Check size={14} className="mt-0.5 shrink-0 text-accent" />}
          </button>
        ))}
        {footer?.(close)}
        </>
      )}
    </Popover>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-[18px] w-8 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={cx('absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all', checked ? 'left-[16px]' : 'left-[2px]')} />
      </button>
      {label}
    </label>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/15';

export function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{fmtDuration(Math.max(0, Date.now() - since)).replace(/\.\ds/, 's')}</>;
}
