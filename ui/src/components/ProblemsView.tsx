import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Info, MessageSquarePlus, RefreshCw, XCircle } from 'lucide-react';
import type { Diagnostic } from '../../../shared/diagnostics.ts';
import { insertIntoComposer, openFile, runChecks, useStore } from '../store.ts';
import { FileIcon } from './Explorer.tsx';
import { Spinner, cx } from './ui.tsx';

const SEV = {
  error: { icon: XCircle, cls: 'text-err', label: 'Lỗi' },
  warning: { icon: AlertTriangle, cls: 'text-warn', label: 'Cảnh báo' },
  info: { icon: Info, cls: 'text-info', label: 'Gợi ý' },
} as const;

/** Error / warning counts, for the tab label and the toolbar button. */
export function useProblemCounts() {
  const p = useStore((s) => s.problems);
  return useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const d of p?.diagnostics || []) c[d.severity]++;
    return c;
  }, [p]);
}

export function ProblemsView() {
  const problems = useStore((s) => s.problems);
  const checking = useStore((s) => s.checking);
  const checkers = useStore((s) => s.checkers);
  const counts = useProblemCounts();
  const [show, setShow] = useState({ error: true, warning: true, info: false });
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const g = new Map<string, Diagnostic[]>();
    for (const d of problems?.diagnostics || []) if (show[d.severity]) g.set(d.file, [...(g.get(d.file) || []), d]);
    const rank = (l: Diagnostic[]) => (l.some((d) => d.severity === 'error') ? 0 : 1);
    return [...g.entries()].map(([f, l]) => [f, l.sort((a, b) => a.line - b.line)] as const).sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]));
  }, [problems, show]);

  const sendToAgent = () => {
    const list = groups.flatMap(([, l]) => l).filter((d) => d.severity !== 'info').slice(0, 80);
    if (!list.length) return;
    insertIntoComposer(
      `Sửa các lỗi sau (từ ${[...new Set(list.map((d) => d.source))].join(', ')}). Sửa tận gốc, không tắt rule hay dùng any/@ts-ignore:\n` +
        list.map((d) => `- ${d.file}:${d.line}:${d.col} [${d.code || d.source}] ${d.message.split('\n')[0]}`).join('\n'),
    );
  };

  if (!checkers.length)
    return (
      <div className="grid h-full place-items-center p-4 text-center text-[13px] text-muted">
        Project này chưa dùng công cụ kiểm tra nào mà app nhận ra (TypeScript, ESLint, Biome, Ruff).
      </div>
    );

  return (
    <div className="flex h-full flex-col text-[13px]">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2 py-1">
        {(Object.keys(SEV) as (keyof typeof SEV)[]).map((k) => {
          const S = SEV[k];
          const Icon = S.icon;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setShow((v) => ({ ...v, [k]: !v[k] }))}
              title={`${show[k] ? 'Ẩn' : 'Hiện'} ${S.label.toLowerCase()}`}
              className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5', show[k] ? 'bg-hover text-fg' : 'text-faint hover:text-muted')}
            >
              <Icon size={13} className={S.cls} /> {counts[k]}
            </button>
          );
        })}
        <span className="mx-1 min-w-0 truncate text-[11.5px] text-faint">
          {problems?.tools.map((t) => `${t.dir ? `${t.dir}: ` : ''}${t.name}${t.ok ? '' : ' (lỗi chạy)'}`).join(' · ') ||
            checkers.map((c) => `${c.dir ? `${c.dir}: ` : ''}${c.tools.join(', ')}`).join(' · ')}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={sendToAgent} disabled={!counts.error && !counts.warning} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-40">
            <MessageSquarePlus size={13} /> Gửi cho agent sửa
          </button>
          <button type="button" onClick={() => void runChecks()} disabled={checking} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-60">
            {checking ? <Spinner size={12} /> : <RefreshCw size={12} />} Kiểm tra lại
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {problems?.tools
          .filter((t) => !t.ok)
          .map((t) => (
            <div key={t.name + t.dir} className="mx-2 mb-1 rounded-md bg-err/5 px-2 py-1 text-[12px] text-err">
              {t.name} không chạy được: {t.error}
            </div>
          ))}
        {!problems ? (
          <div className="flex items-center gap-2 px-3 py-3 text-muted">
            <Spinner size={13} /> Đang kiểm tra…
          </div>
        ) : !groups.length ? (
          <div className="px-3 py-3 text-muted">{counts.info && !show.info ? `Không có lỗi hay cảnh báo (còn ${counts.info} gợi ý đang ẩn).` : 'Không có vấn đề nào.'}</div>
        ) : (
          groups.map(([file, list]) => {
            const open = !closed.has(file);
            const name = file.split('/').pop()!;
            const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
            return (
              <div key={file}>
                <div
                  className="flex h-6 cursor-pointer items-center gap-1.5 px-2 hover:bg-hover"
                  onClick={() => setClosed((c) => (c.delete(file) ? new Set(c) : new Set(c).add(file)))}
                >
                  <ChevronRight size={13} className={cx('shrink-0 text-muted transition-transform', open && 'rotate-90')} />
                  <FileIcon name={name} size={14} />
                  <span className="shrink-0">{name}</span>
                  <span className="min-w-0 truncate text-[11.5px] text-faint">{dir}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-hover px-1.5 text-[11px] text-muted">{list.length}</span>
                </div>
                {open &&
                  list.map((d, i) => {
                    const S = SEV[d.severity];
                    const Icon = S.icon;
                    return (
                      <div
                        key={i}
                        onClick={() => openFile(d.file, { line: d.line })}
                        title={d.message}
                        className="flex cursor-pointer items-start gap-1.5 py-0.5 pl-8 pr-2 hover:bg-hover"
                      >
                        <Icon size={13} className={cx('mt-[3px] shrink-0', S.cls)} />
                        <span className="min-w-0 flex-1 truncate">{d.message.split('\n')[0]}</span>
                        <span className="shrink-0 text-[11.5px] text-faint">
                          {d.source}
                          {d.code ? `(${d.code})` : ''} [{d.line}, {d.col}]
                        </span>
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
