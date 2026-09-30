import { useEffect } from 'react';
import { ClipboardCopy, FilePlus, FolderOpen, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { api, qs } from '../api.ts';
import { getState, openFile, safe, setState, toast } from '../store.ts';
import { cx } from './ui.tsx';

export interface MenuTarget {
  x: number;
  y: number;
  /** workspace folder the entry belongs to */
  root: string;
  primary: boolean;
  /** project-relative path; "" = the folder itself */
  path: string;
  isDir: boolean;
}

const bump = () => setState((s) => ({ fsVersion: s.fsVersion + 1 }));

/** Close editor tabs showing `rel` (or anything inside it). */
function closeTabsUnder(root: string | undefined, rel: string) {
  setState((s) => {
    const gone = (t: (typeof s.tabs)[number]) => t.kind === 'file' && (t.root || undefined) === root && (t.path === rel || t.path.startsWith(rel + '/'));
    const tabs = s.tabs.filter((t) => !gone(t));
    return { tabs, activeTab: tabs.some((t) => t.id === s.activeTab) ? s.activeTab : 'chat' };
  });
}

const call = (root: string, action: string, body: unknown) => safe(api('POST', `/fs/${action}${qs({ project: root })}`, body));

export async function createEntry(root: string, primary: boolean, parent: string, dir: boolean) {
  const name = prompt(dir ? 'Tên thư mục mới' : 'Tên file mới (có thể gồm thư mục con, vd src/utils/a.ts)');
  if (!name?.trim()) return;
  const rel = [parent, name.trim().replace(/^\/+/, '')].filter(Boolean).join('/');
  if (!(await call(root, 'create', { path: rel, dir }))) return;
  bump();
  if (!dir) openFile(rel, { root: primary ? undefined : root });
}

async function renameEntry(t: MenuTarget) {
  const base = t.path.split('/').pop()!;
  const name = prompt('Tên mới', base);
  if (!name?.trim() || name === base) return;
  const to = [...t.path.split('/').slice(0, -1), name.trim()].join('/');
  if (!(await call(t.root, 'rename', { from: t.path, to }))) return;
  closeTabsUnder(t.primary ? undefined : t.root, t.path);
  bump();
  if (!t.isDir) openFile(to, { root: t.primary ? undefined : t.root });
}

async function deleteEntry(t: MenuTarget) {
  const what = t.isDir ? `thư mục "${t.path}" và mọi thứ bên trong` : `"${t.path}"`;
  if (!confirm(`Chuyển ${what} vào Thùng rác?\n(Khôi phục được từ Thùng rác)`)) return;
  if (!(await call(t.root, 'delete', { path: t.path }))) return;
  closeTabsUnder(t.primary ? undefined : t.root, t.path);
  bump();
  toast(`Đã chuyển ${t.path} vào Thùng rác`, 'info');
}

/** Right-click menu of the Explorer (VS Code-like). */
export function ExplorerMenu({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);

  const t = target;
  const parent = t.isDir ? t.path : t.path.split('/').slice(0, -1).join('/');
  const abs = t.path ? `${t.root}/${t.path}` : t.root;
  const mac = getState().platform === 'darwin';
  type Item = [string, React.ReactNode, () => void, boolean?] | 'sep';
  const items: Item[] = [
    ['Tệp mới…', <FilePlus size={14} />, () => void createEntry(t.root, t.primary, parent, false)],
    ['Thư mục mới…', <FolderPlus size={14} />, () => void createEntry(t.root, t.primary, parent, true)],
    'sep',
    ['Sao chép đường dẫn', <ClipboardCopy size={14} />, () => void navigator.clipboard.writeText(abs)],
    ['Sao chép đường dẫn tương đối', <ClipboardCopy size={14} />, () => void navigator.clipboard.writeText(t.path || '.'), !t.path],
    [mac ? 'Hiện trong Finder' : 'Mở trong trình quản lý file', <FolderOpen size={14} />, () => void call(t.root, 'reveal', { path: t.path })],
    ...(t.path
      ? ([
          'sep',
          ['Đổi tên…', <Pencil size={14} />, () => void renameEntry(t)],
          ['Xoá (vào Thùng rác)', <Trash2 size={14} />, () => void deleteEntry(t)],
        ] as Item[])
      : []),
  ];

  return (
    <div
      className="fixed z-50 w-60 rounded-lg border border-line bg-raised p-1 text-[13px] shadow-pop"
      style={{ left: Math.min(t.x, window.innerWidth - 248), top: Math.min(t.y, window.innerHeight - 260) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="my-1 border-t border-line" />
        ) : (
          <button
            key={it[0]}
            type="button"
            disabled={it[3]}
            onClick={() => {
              onClose();
              it[2]();
            }}
            className={cx('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-hover disabled:opacity-40', it[0].startsWith('Xoá') && 'text-err')}
          >
            <span className="text-muted">{it[1]}</span>
            {it[0]}
          </button>
        ),
      )}
    </div>
  );
}
