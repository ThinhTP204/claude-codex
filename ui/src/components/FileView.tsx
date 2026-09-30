import { useEffect, useRef, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Columns2, RotateCcw, Save } from 'lucide-react';
import '../monaco.ts';
import { api, qs } from '../api.ts';
import { safe, toast, useStore } from '../store.ts';
import { FileIcon } from './Explorer.tsx';
import { Spinner, cx } from './ui.tsx';
import { useIsDark } from '../theme.ts';

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', mdx: 'markdown', css: 'css', scss: 'scss', less: 'less',
  html: 'html', vue: 'html', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  swift: 'swift', rb: 'ruby', php: 'php', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp',
  sh: 'shell', zsh: 'shell', bash: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  sql: 'sql', xml: 'xml', svg: 'xml', dockerfile: 'dockerfile', graphql: 'graphql',
};

function langOf(path: string): string {
  const name = path.split('/').pop()!.toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  return LANG[name.split('.').pop() || ''] || 'plaintext';
}

interface FileData {
  content: string;
  binary: boolean;
  tooLarge: boolean;
  size: number;
  head?: string | null;
}

export function FileView({ path, diff: openInDiff }: { path: string; diff?: boolean }) {
  const project = useStore((s) => s.project);
  const fsVersion = useStore((s) => s.fsVersion);
  const touched = useStore((s) => s.touched[path]);
  const gitCode = useStore((s) => s.git.files[path]);
  const dark = useIsDark();
  const [data, setData] = useState<FileData>();
  const [value, setValue] = useState('');
  const [diff, setDiff] = useState(!!openInDiff);
  useEffect(() => setDiff(!!openInDiff), [openInDiff]);
  const [saving, setSaving] = useState(false);
  const dirty = !!data && value !== data.content;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const load = async () => {
    if (!project) return;
    const d = await api<FileData>('GET', `/fs/read${qs({ project, path, head: '1' })}`).catch((e) => {
      toast(e.message);
      return undefined;
    });
    if (d) {
      setData(d);
      setValue(d.content);
    }
  };

  useEffect(() => {
    void load();
  }, [project, path]);

  // reload when an agent changes this file (unless the user has unsaved edits)
  useEffect(() => {
    if (touched && !dirtyRef.current) void load();
  }, [touched, fsVersion]);

  const save = async () => {
    if (!project || !dirty) return;
    setSaving(true);
    const ok = await safe(api('PUT', `/fs/write${qs({ project })}`, { path, content: value }));
    setSaving(false);
    if (ok) setData((d) => d && { ...d, content: value });
  };

  if (!data) return <div className="grid h-full place-items-center text-muted"><Spinner /></div>;
  if (data.binary || data.tooLarge)
    return <div className="grid h-full place-items-center text-muted">{data.tooLarge ? `File quá lớn (${(data.size / 1e6).toFixed(1)} MB)` : 'File nhị phân, không hiển thị được'}</div>;

  const canDiff = data.head !== null && data.head !== undefined && data.head !== data.content;
  const theme = dark ? 'vs-dark' : 'vs';
  const options = {
    fontSize: 13,
    fontFamily: "'SF Mono', Menlo, Monaco, monospace",
    minimap: { enabled: true, scale: 1 },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    renderWhitespace: 'selection' as const,
    automaticLayout: true,
    padding: { top: 8 },
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-[12.5px] text-muted">
        <FileIcon name={path} size={14} />
        <span className="truncate">
          {path.split('/').map((seg, i, a) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 text-faint">›</span>}
              <span className={cx(i === a.length - 1 && 'text-fg')}>{seg}</span>
            </span>
          ))}
        </span>
        {gitCode && <span className="rounded bg-warn/15 px-1.5 text-[11px] font-semibold text-warn">{gitCode}</span>}
        <div className="ml-auto flex items-center gap-1">
          {canDiff && (
            <button type="button" onClick={() => setDiff((d) => !d)} className={cx('inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-hover hover:text-fg', diff && 'bg-hover text-fg')} title="So sánh với git HEAD">
              <Columns2 size={13} /> Diff
            </button>
          )}
          {dirty && (
            <>
              <button type="button" onClick={() => setValue(data.content)} className="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-hover hover:text-fg" title="Bỏ thay đổi">
                <RotateCcw size={13} />
              </button>
              <button type="button" onClick={save} className="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-white" title="Lưu (⌘S)">
                {saving ? <Spinner size={12} /> : <Save size={13} />} Lưu
              </button>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {diff && canDiff ? (
          <DiffEditor
            original={data.head ?? ''}
            modified={value}
            language={langOf(path)}
            theme={theme}
            options={{ ...options, readOnly: true, renderSideBySide: true, minimap: { enabled: false } }}
          />
        ) : (
          <Editor
            path={path}
            value={value}
            language={langOf(path)}
            theme={theme}
            options={options}
            onChange={(v) => setValue(v ?? '')}
            onMount={(editor, m) => {
              editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => document.dispatchEvent(new CustomEvent('agentdesk-save', { detail: path })));
            }}
          />
        )}
      </div>
      <SaveListener path={path} onSave={save} />
    </div>
  );
}

function SaveListener({ path, onSave }: { path: string; onSave: () => void }) {
  const ref = useRef(onSave);
  ref.current = onSave;
  useEffect(() => {
    const h = (e: Event) => (e as CustomEvent).detail === path && ref.current();
    document.addEventListener('agentdesk-save', h);
    return () => document.removeEventListener('agentdesk-save', h);
  }, [path]);
  return null;
}
