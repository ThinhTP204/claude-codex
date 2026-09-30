import { useRef } from 'react';
import { Paperclip, X } from 'lucide-react';
import { type Attachment, attachmentUrl, displayName, isImage } from '../attachments.ts';
import { openFileRef } from '../store.ts';
import { FileIcon } from './Explorer.tsx';
import { Spinner, cx } from './ui.tsx';

const uploaded = (path: string) => /[\\/]attachments[\\/]/.test(path);

/** Paperclip button in the composer: pick files from disk. */
export function AttachButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        title="Đính kèm file (hoặc kéo thả / dán ảnh vào khung chat)"
        onClick={() => input.current?.click()}
        className="inline-flex h-7 items-center rounded-lg px-1.5 text-muted hover:bg-hover hover:text-fg"
      >
        <Paperclip size={15} />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </>
  );
}

/** Pending attachment in the composer. */
export function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const src = a.preview || (a.image && a.path && uploaded(a.path) ? attachmentUrl(a.path) : undefined);
  return (
    <div className="group relative flex h-12 max-w-[220px] items-center gap-2 rounded-lg border border-line bg-panel pr-2 text-[12.5px]" title={a.path || a.name}>
      {src ? (
        <img src={src} alt="" className="h-full w-12 shrink-0 rounded-l-lg object-cover" />
      ) : (
        <span className="grid h-full w-10 shrink-0 place-items-center">
          <FileIcon name={a.name} size={18} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate">{a.name}</span>
        <span className="block truncate text-[11px] text-faint">{a.uploading ? 'Đang tải lên…' : a.path && !uploaded(a.path) ? a.path : 'Đã đính kèm'}</span>
      </span>
      {a.uploading && <Spinner size={12} className="shrink-0" />}
      <button
        type="button"
        onClick={onRemove}
        title="Bỏ file này"
        className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-fg text-bg opacity-0 group-hover:opacity-100"
      >
        <X size={10} />
      </button>
    </div>
  );
}

/** Attachments shown under a sent message. */
export function SentAttachments({ paths, className }: { paths: string[]; className?: string }) {
  return (
    <div className={cx('flex flex-wrap justify-end gap-1.5', className)}>
      {paths.map((p) =>
        uploaded(p) && isImage(p) ? (
          <a key={p} href={attachmentUrl(p)} target="_blank" rel="noreferrer" title={displayName(p)}>
            <img src={attachmentUrl(p)} alt={displayName(p)} className="max-h-40 max-w-[240px] rounded-xl border border-line object-cover" />
          </a>
        ) : (
          <button
            key={p}
            type="button"
            title={p}
            onClick={() => !uploaded(p) && void openFileRef(p)}
            className={cx('flex h-8 max-w-[260px] items-center gap-1.5 rounded-lg border border-line bg-panel px-2 text-[12.5px]', !uploaded(p) && 'hover:bg-hover')}
          >
            <FileIcon name={p} size={14} />
            <span className="truncate">{uploaded(p) ? displayName(p) : p}</span>
          </button>
        ),
      )}
    </div>
  );
}
