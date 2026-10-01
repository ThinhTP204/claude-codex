import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  GitBranch,
  GitCommitHorizontal,
  MessageSquarePlus,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Undo2,
} from 'lucide-react';
import type { GitBranch as Branch, GitCommit, GitFile } from '../../../shared/types.ts';
import { api, qs } from '../api.ts';
import { clearNotes, getState, gitAction, openFile, refreshGit, safe, scmRootOf, sendNotes, setScmRoot, toast, useStore } from '../store.ts';
import { FileIcon } from './Explorer.tsx';
import { Popover, Spinner, cx } from './ui.tsx';

const COLOR: Record<string, string> = {
  M: 'var(--git-modified)',
  A: 'var(--git-added)',
  U: 'var(--git-added)',
  D: 'var(--git-deleted)',
  R: 'var(--git-renamed)',
};
const LABEL: Record<string, string> = { M: 'Đã sửa', A: 'Thêm mới', U: 'File mới', D: 'Đã xoá', R: 'Đổi tên' };

/** Open a file of the repo shown in Source Control: through the project tree when the repo lives inside it. */
function openRepoFile(rel: string, diff: boolean) {
  const s = getState();
  const repo = scmRootOf(s);
  const project = s.project;
  if (repo && project && repo !== project && repo.startsWith(project + '/')) return openFile(`${repo.slice(project.length + 1)}/${rel}`, { diff });
  openFile(rel, { diff, root: repo });
}

function FileRow({ f, code, staged }: { f: GitFile; code: string; staged: boolean }) {
  const name = f.path.split('/').pop()!;
  const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
  const busy = !!useStore((s) => s.gitBusy);
  return (
    <div
      onClick={() => code !== 'D' && openRepoFile(f.path, !f.untracked)}
      title={`${f.path} · ${f.conflict ? 'Xung đột' : LABEL[code] || code}${code !== 'D' ? ' · bấm để xem diff' : ''}`}
      className="group flex h-[24px] cursor-pointer items-center gap-1.5 pl-5 pr-2 text-[13px] hover:bg-hover"
    >
      <FileIcon name={name} size={14} />
      <span className={cx('min-w-0 truncate', code === 'D' && 'line-through opacity-70')} style={{ color: COLOR[code] }}>
        {name}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{dir}</span>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
        {!staged && (
          <button
            type="button"
            disabled={busy}
            title="Huỷ thay đổi của file này"
            onClick={() => {
              const what = f.untracked ? `XOÁ file mới "${f.path}"` : `huỷ mọi thay đổi chưa stage trong "${f.path}"`;
              if (confirm(`Chắc chắn ${what}? Không hoàn tác được.`)) void gitAction('discard', { paths: [f.path] });
            }}
            className="rounded p-0.5 text-muted hover:bg-active hover:text-err"
          >
            <Undo2 size={13} />
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          title={staged ? 'Bỏ stage' : 'Stage file này'}
          onClick={() => void gitAction(staged ? 'unstage' : 'stage', { paths: [f.path] })}
          className="rounded p-0.5 text-muted hover:bg-active hover:text-fg"
        >
          {staged ? <Minus size={13} /> : <Plus size={13} />}
        </button>
      </span>
      <span className="w-3 shrink-0 text-center text-[11px] font-semibold" style={{ color: f.conflict ? 'var(--err)' : COLOR[code] }}>
        {f.conflict ? '!' : code}
      </span>
    </div>
  );
}

function Group({ title, files, staged, action }: { title: string; files: GitFile[]; staged: boolean; action: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  if (!files.length) return null;
  return (
    <div>
      <div className="group flex h-6 cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted hover:bg-hover/60" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="flex-1">{title}</span>
        <span className="hidden group-hover:flex" onClick={(e) => e.stopPropagation()}>
          {action}
        </span>
        <span className="rounded-full bg-hover px-1.5 text-[10.5px] font-medium normal-case">{files.length}</span>
      </div>
      {open && files.map((f) => <FileRow key={`${staged}:${f.path}`} f={f} staged={staged} code={(staged ? f.index : f.work) || 'M'} />)}
    </div>
  );
}

function BranchPicker() {
  const info = useStore((s) => s.gitInfo);
  const project = useStore(scmRootOf);
  const busy = !!useStore((s) => s.gitBusy);
  const [branches, setBranches] = useState<{ local: Branch[]; remote: Branch[] }>();
  const [q, setQ] = useState('');

  const load = async () => setBranches(await safe(api('GET', `/git/branches${qs({ project })}`)));
  const valid = /^[^\s~^:?*[\\]+$/.test(q.trim()) && !q.includes('..');
  const exists = branches?.local.some((b) => b.name === q.trim());
  const filter = (b: Branch) => !q || b.name.toLowerCase().includes(q.toLowerCase());
  const localNames = new Set(branches?.local.map((b) => b.name));

  return (
    <Popover
      width={320}
      trigger={(open, toggle) => (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!open) void load();
            toggle();
          }}
          title="Đổi hoặc tạo nhánh"
          className={cx('flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] font-medium hover:bg-hover', open && 'bg-hover')}
        >
          <GitBranch size={14} className="shrink-0 text-accent" />
          <span className="truncate">{info?.detached ? 'detached HEAD' : info?.branch || '…'}</span>
          <ChevronDown size={12} className="shrink-0 text-faint" />
        </button>
      )}
    >
      {(close) => (
        <div className="p-1">
          <div className="relative mb-1">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && valid && !exists) {
                  close();
                  if (await gitAction('checkout', { branch: q.trim(), create: true })) toast(`Đã tạo và chuyển sang nhánh ${q.trim()}`, 'info');
                }
              }}
              placeholder="Tìm nhánh hoặc gõ tên nhánh mới…"
              className="w-full rounded-md border border-line bg-panel py-1 pl-7 pr-2 text-[13px] outline-none focus:border-accent/60"
            />
          </div>
          {q.trim() && !exists && (
            <button
              type="button"
              disabled={!valid}
              onClick={async () => {
                close();
                if (await gitAction('checkout', { branch: q.trim(), create: true })) toast(`Đã tạo và chuyển sang nhánh ${q.trim()}`, 'info');
              }}
              className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-accent hover:bg-hover disabled:opacity-40"
            >
              <Plus size={14} /> Tạo nhánh mới <b className="truncate">{q.trim()}</b>
              <span className="ml-auto shrink-0 text-[11px] text-faint">từ {info?.branch}</span>
            </button>
          )}
          {!branches ? (
            <div className="grid h-16 place-items-center">
              <Spinner />
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <div className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-faint">Nhánh trên máy</div>
              {branches.local.filter(filter).map((b) => (
                <button
                  key={b.name}
                  type="button"
                  onClick={async () => {
                    close();
                    if (!b.current && (await gitAction('checkout', { branch: b.name }))) toast(`Đã chuyển sang ${b.name}`, 'info');
                  }}
                  className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-hover', b.current && 'bg-hover/60')}
                >
                  {b.current ? <Check size={13} className="shrink-0 text-accent" /> : <GitBranch size={13} className="shrink-0 text-faint" />}
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {!!b.ahead && <span className="text-[11px] text-faint">↑{b.ahead}</span>}
                  {!!b.behind && <span className="text-[11px] text-faint">↓{b.behind}</span>}
                  {!b.upstream && <span className="text-[10.5px] text-faint">chưa push</span>}
                  <span className="shrink-0 text-[10.5px] text-faint">{b.date}</span>
                </button>
              ))}
              {branches.remote.filter((b) => filter(b) && !localNames.has(b.name.replace(/^[^/]+\//, ''))).length > 0 && (
                <>
                  <div className="px-2 pb-0.5 pt-2 text-[11px] font-medium text-faint">Nhánh trên remote</div>
                  {branches.remote
                    .filter((b) => filter(b) && !localNames.has(b.name.replace(/^[^/]+\//, '')))
                    .map((b) => (
                      <button
                        key={b.name}
                        type="button"
                        onClick={async () => {
                          close();
                          if (await gitAction('checkout', { branch: b.name })) toast(`Đã lấy nhánh ${b.name} về máy`, 'info');
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-muted hover:bg-hover hover:text-fg"
                      >
                        <CloudUpload size={13} className="shrink-0 rotate-180" />
                        <span className="min-w-0 flex-1 truncate">{b.name}</span>
                        <span className="shrink-0 text-[10.5px] text-faint">{b.date}</span>
                      </button>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

function History() {
  const project = useStore(scmRootOf);
  const head = useStore((s) => s.gitInfo?.lastCommit?.hash);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<GitCommit[]>();
  useEffect(() => {
    if (open) void api<GitCommit[]>('GET', `/git/log${qs({ project, limit: '40' })}`).then(setLog).catch(() => setLog([]));
  }, [open, project, head]);
  return (
    <div className="border-t border-line">
      <div className="flex h-7 cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted hover:bg-hover/60" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Lịch sử commit
      </div>
      {open && (
        <div className="max-h-64 overflow-y-auto pb-2">
          {!log && <Spinner className="mx-auto my-3 block" />}
          {log?.map((c) => (
            <div key={c.hash} className="flex items-start gap-2 px-3 py-1 text-[12.5px] hover:bg-hover/60" title={`${c.hash} · ${c.author} · ${c.date}`}>
              <GitCommitHorizontal size={14} className="mt-0.5 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{c.subject}</div>
                <div className="flex flex-wrap items-center gap-1 text-[11px] text-faint">
                  <span className="font-mono">{c.hash}</span> · {c.author} · {c.date}
                  {c.refs.map((r) => (
                    <span key={r} className="rounded bg-accent/10 px-1 text-accent">
                      {r.replace('HEAD -> ', '')}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {log && !log.length && <div className="px-3 py-2 text-[12px] text-faint">Chưa có commit nào</div>}
        </div>
      )}
    </div>
  );
}

/** Multi-root workspace: pick which folder's repo the panel manages (like VS Code's Repositories view). */
function RepoPicker() {
  const project = useStore((s) => s.project);
  const folders = useStore((s) => s.folders);
  const repos = useStore((s) => s.repos);
  const current = useStore(scmRootOf);
  const rootGit = useStore((s) => s.rootGit);
  if (!project) return null;
  const name = (p: string) => p.split(/[\\/]/).pop();
  // repos found inside the project, then extra workspace folders
  const list = [
    ...repos.map((r) => ({ path: r.path, label: r.rel || name(r.path), hint: r.rel ? undefined : 'project', branch: r.branch, n: r.changes })),
    ...folders.map((f) => ({ path: f, label: name(f), hint: 'workspace', branch: rootGit[f]?.branch, n: Object.keys(rootGit[f]?.files || {}).length })),
  ];
  if (list.length < 2) return null;
  return (
    <div className="mb-1.5 border-b border-line px-2 pb-1.5">
      <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Repositories · {list.length}</div>
      <div className="max-h-48 overflow-auto">
        {list.map((r) => (
          <button
            key={r.path}
            type="button"
            title={r.path}
            onClick={() => setScmRoot(r.path)}
            className={cx('flex h-6 w-full items-center gap-1.5 rounded px-1.5 text-left text-[13px] hover:bg-hover', r.path === current && 'bg-hover text-fg')}
          >
            <GitBranch size={12} className="shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            {r.branch && <span className="max-w-[40%] shrink-0 truncate text-[11.5px] text-faint">{r.branch}</span>}
            {r.n > 0 && <span className="shrink-0 rounded-full bg-accent/15 px-1.5 text-[10.5px] font-semibold text-accent">{r.n}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SourceControl() {
  return (
    <div className="flex h-full flex-col">
      <RepoPicker />
      <div className="min-h-0 flex-1">
        <RepoPanel />
      </div>
    </div>
  );
}

function RepoPanel() {
  const info = useStore((s) => s.gitInfo);
  const gitError = useStore((s) => s.gitError);
  const busy = useStore((s) => s.gitBusy);
  const project = useStore(scmRootOf);
  const composerAgent = useStore((s) => s.composer.agent);
  const [msg, setMsg] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  // keep the panel fresh while it is open (branch switched from a terminal, etc.)
  useEffect(() => {
    void refreshGit();
    const t = setInterval(() => document.visibilityState === 'visible' && void refreshGit(), 8000);
    return () => clearInterval(t);
  }, [project]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [msg]);

  const staged = useMemo(() => info?.files.filter((f) => f.index) ?? [], [info]);
  const changes = useMemo(() => info?.files.filter((f) => f.work) ?? [], [info]);
  const total = info?.files.length ?? 0;

  if (!project) return <div className="p-4 text-[13px] text-faint">Chưa mở project</div>;
  if (!info)
    return gitError ? (
      <div className="space-y-2 p-4 text-[13px] text-muted">
        <p className="text-err">Không đọc được git: {gitError}</p>
        <button type="button" onClick={() => void refreshGit()} className="rounded-lg border border-line px-3 py-1 hover:bg-hover hover:text-fg">
          Thử lại
        </button>
      </div>
    ) : (
      <Spinner className="mx-auto mt-6 block" />
    );
  if (!info.isRepo)
    return (
      <div className="space-y-3 p-4 text-[13px] text-muted">
        <p>Thư mục này chưa phải git repo.</p>
        <button type="button" onClick={() => void gitAction('init')} className="w-full rounded-lg bg-accent px-3 py-1.5 font-medium text-white hover:opacity-90">
          Khởi tạo git (git init)
        </button>
      </div>
    );

  const commit = async (push: boolean) => {
    if (!msg.trim()) {
      toast('Nhập commit message trước', 'info');
      ta.current?.focus();
      return;
    }
    // like VS Code: nothing staged → commit every change
    const ok = await gitAction('commit', { message: msg, all: staged.length === 0 });
    if (!ok) return;
    setMsg('');
    if (push) {
      if (await gitAction('push')) toast('Đã commit và push lên remote', 'info');
    } else toast('Đã commit', 'info');
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const r = await api<{ message: string }>('POST', `/git/suggest-message${qs({ project })}`, { agent: composerAgent });
      setMsg(r.message);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  };

  const pushLabel = !info.upstream ? 'Publish nhánh' : info.ahead ? `Push ${info.ahead}` : 'Push';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-2 pb-1">
        <BranchPicker />
        {info.upstream ? (
          <span className="shrink-0 text-[11.5px] text-faint" title={`So với ${info.upstream}`}>
            {info.ahead > 0 && <span className="mr-1">↑{info.ahead}</span>}
            {info.behind > 0 && <span className="text-warn">↓{info.behind}</span>}
            {!info.ahead && !info.behind && 'đã đồng bộ'}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-faint">chưa có trên remote</span>
        )}
        <button type="button" title="Làm mới" onClick={() => void refreshGit()} className="ml-auto rounded p-1 text-muted hover:bg-hover hover:text-fg">
          <RefreshCw size={13} />
        </button>
      </div>

      <NotesBar />

      <div className="px-2 pb-2">
        <div className="rounded-lg border border-line bg-panel focus-within:border-accent/60">
          <textarea
            ref={ta}
            rows={2}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void commit(e.shiftKey);
              }
            }}
            placeholder="Commit message…"
            className="block max-h-40 w-full resize-none bg-transparent px-2.5 py-2 text-[13px] outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-2 px-2 pb-1.5">
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-faint" title="⌘Enter: commit · ⇧⌘Enter: commit & push">
              {staged.length ? `${staged.length} file đã stage` : total ? 'Sẽ commit tất cả thay đổi' : ''} · ⌘↵
            </span>
            <button
              type="button"
              onClick={suggest}
              disabled={suggesting || !total}
              title={`Nhờ ${composerAgent === 'claude' ? 'Claude Haiku' : 'Codex'} viết message từ diff (tốn ~20–30k token)`}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              {suggesting ? <Spinner size={11} /> : <Sparkles size={12} />} Viết bằng AI
            </button>
          </div>
        </div>
        <div className="mt-1.5 flex gap-1">
          <button
            type="button"
            disabled={!!busy || !total}
            onClick={() => void commit(false)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            <Check size={14} /> Commit{!staged.length && total ? ' tất cả' : ''}
          </button>
          <Popover
            placement="bottom-end"
            width={220}
            trigger={(_o, toggle) => (
              <button type="button" disabled={!!busy} onClick={toggle} className="rounded-md bg-accent px-1.5 text-white hover:opacity-90 disabled:opacity-40">
                <ChevronDown size={14} />
              </button>
            )}
          >
            {(close) => (
              <div className="p-1 text-[13px]">
                <button type="button" disabled={!total} onClick={() => (close(), void commit(true))} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover disabled:opacity-40">
                  <CloudUpload size={14} /> Commit & Push
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    close();
                    if (!confirm(`Sửa lại commit gần nhất${info.lastCommit ? ` "${info.lastCommit.subject}"` : ''}?${info.upstream && !info.ahead ? '\nCommit này đã được push, amend sẽ cần force push.' : ''}`)) return;
                    if (await gitAction('commit', { message: msg, amend: true, all: staged.length === 0 })) {
                      setMsg('');
                      toast('Đã sửa commit gần nhất', 'info');
                    }
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
                >
                  <GitCommitHorizontal size={14} /> Sửa commit gần nhất (amend)
                </button>
              </div>
            )}
          </Popover>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1">
          <button
            type="button"
            disabled={!!busy}
            onClick={async () => {
              if (await gitAction('push')) toast(info.upstream ? 'Đã push' : `Đã publish nhánh ${info.branch}`, 'info');
            }}
            title={info.upstream ? `Push lên ${info.upstream}` : 'Đẩy nhánh này lên remote lần đầu'}
            className={cx('flex items-center justify-center gap-1 rounded-md border px-1 py-1 text-[12px] hover:bg-hover disabled:opacity-40', info.ahead || !info.upstream ? 'border-accent/50 text-accent' : 'border-line text-muted')}
          >
            <ArrowUp size={13} /> {pushLabel}
          </button>
          <button
            type="button"
            disabled={!!busy || !info.upstream}
            onClick={async () => {
              if (await gitAction('pull')) toast('Đã pull', 'info');
            }}
            title="Kéo commit mới từ remote về"
            className={cx('flex items-center justify-center gap-1 rounded-md border px-1 py-1 text-[12px] hover:bg-hover disabled:opacity-40', info.behind ? 'border-warn/60 text-warn' : 'border-line text-muted')}
          >
            <ArrowDown size={13} /> Pull{info.behind ? ` ${info.behind}` : ''}
          </button>
          <button
            type="button"
            disabled={!!busy || !info.remotes.length}
            onClick={() => void gitAction('fetch')}
            title="Kiểm tra remote có gì mới (không đổi code)"
            className="flex items-center justify-center gap-1 rounded-md border border-line px-1 py-1 text-[12px] text-muted hover:bg-hover disabled:opacity-40"
          >
            <RefreshCw size={12} /> Fetch
          </button>
        </div>
        {busy && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
            <Spinner size={12} className="text-accent" /> {busy}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Group
          title="Đã stage"
          files={staged}
          staged
          action={
            <button type="button" title="Bỏ stage tất cả" onClick={() => void gitAction('unstage', { paths: [] })} className="rounded p-0.5 hover:bg-active">
              <Minus size={13} />
            </button>
          }
        />
        <Group
          title="Thay đổi"
          files={changes}
          staged={false}
          action={
            <button type="button" title="Stage tất cả" onClick={() => void gitAction('stage', { paths: [] })} className="rounded p-0.5 hover:bg-active">
              <Plus size={13} />
            </button>
          }
        />
        {!total && (
          <div className="px-4 py-6 text-center text-[12.5px] text-faint">
            Không có thay đổi nào.
            {info.lastCommit && (
              <div className="mt-1 truncate">
                Commit gần nhất: <span className="text-muted">{info.lastCommit.subject}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <History />
    </div>
  );
}

/** Count shown on the Source Control tab */
// project status already includes nested repos; add the extra workspace folders
export const useChangeCount = () =>
  useStore((s) => Object.keys(s.git.files).length + Object.values(s.rootGit).reduce((n, g) => n + Object.keys(g.files).length, 0));

/** Review comments written on diff lines, waiting to go to an agent. */
function NotesBar() {
  const notes = useStore((s) => s.notes);
  if (!notes.length) return null;
  const files = [...new Set(notes.map((n) => n.file))];
  return (
    <div className="mx-2 mb-2 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[12.5px]">
      <div className="flex items-center gap-1.5">
        <MessageSquarePlus size={13} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap" title={`${files.length} file:\n${files.join('\n')}`}>
          {notes.length} nhận xét
        </span>
        <button
          type="button"
          onClick={() => confirm(`Xoá ${notes.length} nhận xét chưa gửi?`) && clearNotes()}
          className="shrink-0 rounded px-1.5 py-0.5 text-faint hover:bg-hover hover:text-fg"
        >
          Xoá
        </button>
        <button type="button" onClick={sendNotes} title="Đưa các nhận xét vào ô chat để gửi cho agent" className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-0.5 font-medium text-white">
          <Send size={11} /> Gửi
        </button>
      </div>
      <div className="mt-1 space-y-0.5">
        {notes.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => openFile(n.file, { diff: true, line: n.line, root: n.root })}
            className="flex w-full items-baseline gap-1.5 rounded px-1 text-left text-[12px] hover:bg-hover"
          >
            <span className="shrink-0 font-mono text-[11px] text-faint">
              {n.file.split('/').pop()}:{n.line}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted">{n.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
