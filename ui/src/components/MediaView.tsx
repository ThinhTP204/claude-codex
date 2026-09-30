import { useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { TOKEN, qs } from '../api.ts';
import { useStore } from '../store.ts';
import { FileIcon } from './Explorer.tsx';
import { cx } from './ui.tsx';

export const MEDIA_RE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|pdf)$/i;

/** Images and PDFs from the project: shown as they are instead of "binary file". */
export function MediaView({ path, root }: { path: string; root?: string }) {
  const project = useStore((s) => root || s.project) || '';
  // fsVersion busts the cache when the file changes on disk
  const version = useStore((s) => s.fsVersion);
  const [fit, setFit] = useState(true);
  const [dims, setDims] = useState<string>();
  const src = `/api/fs/raw${qs({ project, path, token: TOKEN, v: String(version) })}`;
  const pdf = /\.pdf$/i.test(path);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-[12.5px] text-muted">
        <FileIcon name={path} size={14} />
        <span className="truncate">{path}</span>
        {dims && <span className="text-faint">{dims}</span>}
        {!pdf && (
          <button type="button" onClick={() => setFit((f) => !f)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg">
            {fit ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
            {fit ? 'Kích thước thật' : 'Vừa khung'}
          </button>
        )}
      </div>
      {pdf ? (
        <iframe src={src} title={path} className="min-h-0 flex-1 bg-white" />
      ) : (
        <div
          className={cx('min-h-0 flex-1 overflow-auto p-6', fit && 'grid place-items-center')}
          // checkerboard so transparent images stay visible in both themes
          style={{ backgroundImage: 'repeating-conic-gradient(var(--hover) 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}
        >
          <img
            src={src}
            alt={path}
            onLoad={(e) => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
            className={cx('shadow-sm', fit ? 'max-h-full max-w-full object-contain' : 'max-w-none')}
          />
        </div>
      )}
    </div>
  );
}
