import { useEffect, useState } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import { ensurePreview } from '../store.ts';
import { inputCls, cx } from './ui.tsx';

/** The project's dev server, shown inside AgentDesk. */
export function PreviewView({ url }: { url: string }) {
  const [draft, setDraft] = useState(url);
  const [nonce, setNonce] = useState(0);
  useEffect(() => setDraft(url), [url]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-2">
        <button type="button" title="Tải lại" onClick={() => setNonce((n) => n + 1)} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <RotateCw size={14} />
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            const u = /^https?:\/\//.test(draft) ? draft : `http://${draft}`;
            ensurePreview(u, true);
            setNonce((n) => n + 1);
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} className={cx(inputCls, 'h-7 py-0 font-mono text-[12.5px]')} />
        </form>
        <button type="button" title="Mở bằng trình duyệt" onClick={() => window.open(url, '_blank')} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
          <ExternalLink size={14} />
        </button>
      </div>
      <iframe key={`${url}#${nonce}`} src={url} title="Preview" className="min-h-0 w-full flex-1 bg-white" />
    </div>
  );
}
