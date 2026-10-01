import { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { Check, X } from 'lucide-react';
import '../monaco.ts';
import type { Conversation, Fanout, FanoutAttempt, FanoutFile } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import { getState } from '../store.ts';
import { useIsDark } from '../theme.ts';
import { FileIcon } from './Explorer.tsx';
import { Spinner, cx } from './ui.tsx';

const STATUS: Record<string, [string, string]> = {
  A: ['Mới', 'text-ok'],
  D: ['Xoá', 'text-err'],
  R: ['Đổi tên', 'text-info'],
  M: ['Sửa', 'text-warn'],
};

/** What one parallel attempt changed, file by file, against the starting point. */
export function FanoutDiff({ conv, f, a, title, onClose, onChoose }: { conv: Conversation; f: Fanout; a: FanoutAttempt; title: string; onClose: () => void; onChoose?: () => void }) {
  const dark = useIsDark();
  const [files, setFiles] = useState<FanoutFile[]>();
  const [sel, setSel] = useState<string>();
  const [versions, setVersions] = useState<{ before: string; after: string }>();
  const base = `/conversations/${encodeURIComponent(conv.id)}/fanout/${f.id}`;
  const project = getState().project;

  useEffect(() => {
    void api<FanoutFile[]>('GET', `${base}/diff${qs({ project, attempt: a.id })}`)
      .then((l) => {
        setFiles(l);
        setSel(l[0]?.path);
      })
      .catch(() => setFiles([]));
  }, [a.id]);
  useEffect(() => {
    if (!sel) return;
    setVersions(undefined);
    void api<{ before: string; after: string }>('GET', `${base}/file${qs({ project, attempt: a.id, path: sel })}`).then(setVersions, () => setVersions({ before: '', after: '' }));
  }, [sel]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="font-medium">Thay đổi của {title}</span>
          {files && <span className="text-[12.5px] text-faint">{files.length} file</span>}
          <div className="ml-auto flex items-center gap-1.5">
            {onChoose && (
              <button type="button" onClick={onChoose} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[13px] font-medium text-white">
                <Check size={13} /> Chọn bản này
              </button>
            )}
            <button type="button" onClick={onClose} title="Đóng (Esc)" className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-64 shrink-0 overflow-y-auto border-r border-line p-1.5">
            {!files && (
              <div className="grid place-items-center py-6 text-muted">
                <Spinner />
              </div>
            )}
            {files?.map((x) => {
              const [label, cls] = STATUS[x.status] ?? STATUS.M;
              const name = x.path.split('/').pop()!;
              const dir = x.path.slice(0, -name.length - 1);
              return (
                <button
                  key={x.path}
                  type="button"
                  onClick={() => setSel(x.path)}
                  title={x.path}
                  className={cx('flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px]', sel === x.path ? 'bg-active' : 'hover:bg-hover')}
                >
                  <FileIcon name={name} size={13} />
                  <span className="min-w-0 flex-1 truncate">
                    {name}
                    {dir && <span className="ml-1 text-[11px] text-faint">{dir}</span>}
                  </span>
                  <span className={cx('shrink-0 text-[10.5px]', cls)}>{label}</span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-faint">
                    +{x.additions} −{x.deletions}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="min-w-0 flex-1">
            {versions ? (
              <DiffEditor
                original={versions.before}
                modified={versions.after}
                language={undefined}
                originalModelPath={`fanout-base/${sel}`}
                modifiedModelPath={`fanout-${a.id}/${sel}`}
                theme={dark ? 'vs-dark' : 'vs'}
                options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 13, automaticLayout: true, scrollBeyondLastLine: false }}
              />
            ) : (
              sel && (
                <div className="grid h-full place-items-center text-muted">
                  <Spinner />
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
