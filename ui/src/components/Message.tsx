import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronRight,
  Copy,
  FileEdit,
  FileSearch,
  FileText,
  Globe,
  ListTodo,
  Terminal,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import type { Block, Turn } from '../../../shared/types.ts';
import { ensurePreview, openFileRef, useStore } from '../store.ts';
import { AGENT_NAME, AgentIcon, EFFORT_LABEL, Elapsed, PERMISSIONS, Spinner, cx, fmtDuration, fmtUsage, modelLabel } from './ui.tsx';

function CodeBlock(props: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);
  const child = (props.children as React.ReactElement<{ className?: string }>) || null;
  const lang = /language-(\w+)/.exec(child?.props?.className || '')?.[1];
  return (
    <div className="group relative">
      <div className="absolute right-2 top-1.5 flex items-center gap-2 text-[11px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
        {lang && <span>{lang}</span>}
        <button
          type="button"
          className="rounded p-1 hover:bg-hover hover:text-fg"
          onClick={(e) => {
            const code = (e.currentTarget.closest('.group')?.querySelector('pre')?.textContent || '').trimEnd();
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre {...props} />
    </div>
  );
}

/** Inline code that looks like a file path: "src/a.tsx", "a.tsx:12", "./x/y.md" */
const FILE_LIKE = /^(?:\/|\.{1,2}\/|~\/)?(?:[\w@()[\]~.-]+\/)*[\w@()[\]-][\w@()[\].-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?::\d+(?::\d+)?|#L\d+)?$/;

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx('prose-chat', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: CodeBlock,
          a: ({ node: _n, href = '', children, ...p }) => {
            if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(href))
              return <a {...p} href={href} onClick={(e) => (e.preventDefault(), ensurePreview(href.replace(/\/\/(127\.0\.0\.1|0\.0\.0\.0)/, '//localhost'), true))}>{children}</a>;
            if (/^(https?:|mailto:)/i.test(href)) return <a {...p} href={href} target="_blank" rel="noreferrer">{children}</a>;
            // anything else is a file reference written by the agent
            return (
              <a {...p} href={href} title={`Mở ${href} trong editor`} onClick={(e) => (e.preventDefault(), void openFileRef(href || String(children)))}>
                {children}
              </a>
            );
          },
          code: ({ node: _n, className, children, ...p }) => {
            const text = String(children ?? '');
            if (!className && !text.includes('\n') && FILE_LIKE.test(text))
              return (
                <code {...p} role="link" title={`Mở ${text} trong editor`} onClick={() => void openFileRef(text)} className="file-ref">
                  {children}
                </code>
              );
            return <code {...p} className={className}>{children}</code>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function toolIcon(name: string) {
  const n = name.toLowerCase();
  if (n === 'bash') return Terminal;
  if (n === 'read') return FileText;
  if (n === 'edit' || n === 'write' || n === 'multiedit' || n === 'notebookedit') return FileEdit;
  if (n === 'grep' || n === 'glob') return FileSearch;
  if (n.startsWith('web')) return Globe;
  if (n.startsWith('todo')) return ListTodo;
  return Wrench;
}

function ToolRow({ b }: { b: Extract<Block, { type: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(b.name);
  const project = useStore((s) => s.project) || '';
  const input = b.input.startsWith(project + '/') ? b.input.slice(project.length + 1) : b.input;
  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left text-muted hover:text-fg"
      >
        <ChevronRight size={13} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
        <Icon size={14} className="shrink-0" />
        <span className="shrink-0 font-medium text-fg/85">{b.name}</span>
        <span className="min-w-0 truncate font-mono text-[12px]">{input.split('\n')[0]}</span>
        <span className="ml-auto shrink-0">
          {b.status === 'running' ? <Spinner size={12} /> : b.status === 'error' ? <X size={13} className="text-err" /> : <Check size={13} className="text-ok opacity-60" />}
        </span>
      </button>
      {open && (
        <div className="my-1 ml-5 overflow-hidden rounded-lg border border-line bg-code">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-b border-line px-3 py-2 font-mono text-[12px] text-fg/90">{input}</pre>
          <pre className={cx('max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12px]', b.status === 'error' ? 'text-err' : 'text-muted')}>
            {b.output || (b.status === 'running' ? 'Đang chạy…' : '(không có output)')}
          </pre>
        </div>
      )}
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[13px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 py-0.5 text-muted hover:text-fg">
        <ChevronRight size={13} className={cx('transition-transform', open && 'rotate-90')} />
        <Brain size={14} />
        <span className="italic">Suy nghĩ</span>
        {!open && <span className="max-w-[420px] truncate text-faint">{text.replace(/\s+/g, ' ').slice(0, 90)}</span>}
      </button>
      {open && <div className="my-1 ml-5 whitespace-pre-wrap border-l-2 border-line pl-3 text-[13px] italic leading-relaxed text-muted">{text}</div>}
    </div>
  );
}

export function TurnHeader({ t }: { t: Turn }) {
  const catalog = useStore((s) => s.catalog);
  if (!t.agent) return null;
  const perm = PERMISSIONS.find((p) => p.id === t.permission);
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
      <AgentIcon agent={t.agent} size={16} />
      <span className="font-semibold">{AGENT_NAME[t.agent]}</span>
      <span className="text-muted">· {modelLabel(catalog, t.agent, t.model)}</span>
      {t.effort && <span className="text-faint">· {EFFORT_LABEL[t.effort] || t.effort}</span>}
      {(t.roleName || t.nodeLabel) && (
        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-px text-[11.5px] text-muted">
          {t.nodeId ? <Workflow size={11} /> : t.roleIcon}
          {t.nodeLabel || t.roleName}
        </span>
      )}
      {perm && <span className="text-[11.5px] text-faint">{perm.short}</span>}
    </div>
  );
}

export const TurnView = memo(function TurnView({ t, draft }: { t: Turn; draft?: string }) {
  if (t.role === 'user') {
    if (t.nodeId || t.text?.startsWith('▶️') || t.text?.startsWith('✏️') || t.text?.startsWith('💬')) return <PipelineNote t={t} />;
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-bubble px-4 py-2.5 text-[15px] leading-relaxed">{t.text}</div>
      </div>
    );
  }
  const running = t.status === 'running';
  const empty = !t.blocks.length && !draft;
  return (
    <div className="group">
      <TurnHeader t={t} />
      <div className="space-y-1.5">
        {t.blocks.map((b) =>
          b.type === 'text' ? (
            <Markdown key={b.id} text={b.text} className="py-0.5" />
          ) : b.type === 'thinking' ? (
            <Thinking key={b.id} text={b.text} />
          ) : b.type === 'tool' ? (
            <ToolRow key={b.id} b={b} />
          ) : (
            <div key={b.id} className="flex items-start gap-2 rounded-lg border border-err/30 bg-err/5 px-3 py-2 text-[13px] text-err">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap break-words">{b.text}</span>
            </div>
          ),
        )}
        {draft && <Markdown text={draft} className="caret py-0.5" />}
      </div>
      <div className="mt-2 flex h-5 items-center gap-3 text-[11.5px] text-faint">
        {running ? (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <Spinner size={12} className="text-accent" />
            {empty ? 'Đang khởi động…' : 'Đang làm…'} <Elapsed since={t.createdAt} />
          </span>
        ) : (
          <>
            {t.status === 'stopped' && <span className="text-warn">Đã dừng</span>}
            {t.status === 'error' && <span className="text-err">Lỗi</span>}
            {t.durationMs !== undefined && <span>{fmtDuration(t.durationMs)}</span>}
            {t.usage && <span title="Token vào (gồm cache) · token ra">{fmtUsage(t.usage)}</span>}
          </>
        )}
      </div>
    </div>
  );
});

function PipelineNote({ t }: { t: Turn }) {
  const [open, setOpen] = useState(false);
  const firstLine = (t.text || '').split('\n')[0].replace(/\*\*/g, '');
  const isPrompt = !!t.nodeId && !/^(✏️|💬)/.test(t.text || '');
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-xl border border-dashed border-line-strong px-3 py-1.5 text-[12.5px] text-muted">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex max-w-full items-center gap-1.5 text-left hover:text-fg">
          <Workflow size={13} className="shrink-0 text-accent" />
          <span className="truncate">{isPrompt ? `Pipeline giao cho bước ${t.nodeLabel}` : firstLine}</span>
          <ChevronRight size={13} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
        </button>
        {open && <div className="mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap border-t border-line pt-1.5 text-[13px] text-fg/85">{t.text}</div>}
      </div>
    </div>
  );
}
