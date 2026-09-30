import { Files, GitBranch } from 'lucide-react';
import { setRightTab, useStore } from '../store.ts';
import { Explorer } from './Explorer.tsx';
import { SourceControl, useChangeCount } from './SourceControl.tsx';
import { cx } from './ui.tsx';

/** Right sidebar: VS Code-style switch between the file Explorer and Source Control. */
export function RightPanel({ onCollapse }: { onCollapse: () => void }) {
  const tab = useStore((s) => s.rightTab);
  const count = useChangeCount();
  const btn = (id: 'files' | 'scm', icon: React.ReactNode, label: string, badge?: number) => (
    <button
      type="button"
      onClick={() => setRightTab(id)}
      title={label}
      className={cx(
        'relative flex h-9 flex-1 items-center justify-center gap-1.5 text-[12px]',
        tab === id ? 'text-fg' : 'text-muted hover:text-fg',
      )}
    >
      {icon}
      {label}
      {!!badge && <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-semibold leading-4 text-white">{badge > 99 ? '99+' : badge}</span>}
      {tab === id && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-accent" />}
    </button>
  );
  return (
    <div className="flex h-full flex-col bg-explorer">
      <div className="flex shrink-0 border-b border-line">
        {btn('files', <Files size={14} />, 'Explorer')}
        {btn('scm', <GitBranch size={14} />, 'Source Control', count)}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'files' ? (
          <Explorer onCollapse={onCollapse} />
        ) : (
          <div className="flex h-full flex-col pt-2">
            <SourceControl />
          </div>
        )}
      </div>
    </div>
  );
}
